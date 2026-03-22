import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {parse as parse_jsonc, type ParseError} from 'jsonc-parser'

export type RunLucideSpriteCodemodOptions = {
    root_dir?: string
    dry_run?: boolean
    source_dir?: string
    icon_component_path?: string
}

export type RunLucideSpriteCodemodResult = {
    changed_files: string[]
    dry_run: boolean
}

const lucide_component_to_id_override: Record<string, string> = {
    Loader2: 'loader-circle',
    LoaderCircle: 'loader-circle',
}

type State = {
    root_dir: string
    dry_run: boolean
    source_dir: string
    icon_component_path: string
    changed_files: string[]
    found_lucide_ids: Set<string>
}

function normalize_path(value: string): string {
    return value.split(path.sep).join('/')
}

function read_text_file(state: State, relative_path: string): string | null {
    const absolute_path = path.join(state.root_dir, relative_path)
    if (!existsSync(absolute_path)) return null
    return readFileSync(absolute_path, 'utf8')
}

function write_text_file(state: State, relative_path: string, content: string): void {
    const absolute_path = path.join(state.root_dir, relative_path)
    mkdirSync(path.dirname(absolute_path), {recursive: true})
    writeFileSync(absolute_path, content)
}

function update_text_file(state: State, relative_path: string, updater: (before: string) => string): void {
    const before = read_text_file(state, relative_path)
    if (before == null) return
    const after = updater(before)
    if (after === before) return
    state.changed_files.push(relative_path)
    if (!state.dry_run) write_text_file(state, relative_path, after)
}

function get_svelte_files(dir_path: string): string[] {
    const entries = readdirSync(dir_path)
    const results: string[] = []

    for (const entry of entries) {
        const full_path = path.join(dir_path, entry)
        const stats = statSync(full_path)
        if (stats.isDirectory()) {
            results.push(...get_svelte_files(full_path))
            continue
        }
        if (entry.endsWith('.svelte')) results.push(full_path)
    }

    return results
}

function escape_regex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function strip_lucide_imports(source: string): string {
    return source
        .replace(/import\s*\{[^}]*\}\s*from\s*['"]@lucide\/svelte['"]\s*;?\s*\n?/g, '')
        .replace(/import\s+[A-Za-z_$][\w$]*\s+from\s+['"]@lucide\/svelte\/icons\/[^'"]+['"]\s*;?\s*\n?/g, '')
}

function strip_comments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function identifier_is_used_outside_lucide_imports(source: string, identifier: string): boolean {
    const without_imports = strip_comments(strip_lucide_imports(source))
    return new RegExp(`\\b${escape_regex(identifier)}\\b`).test(without_imports)
}

function lucide_component_to_id(component_name: string): string | null {
    const normalized = component_name.endsWith('Icon') ? component_name.slice(0, -4) : component_name
    const override = lucide_component_to_id_override[normalized]
    if (override) return override
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(normalized)) return null
    return normalized
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Za-z])([0-9])/g, '$1-$2')
        .replace(/([0-9])([A-Za-z])/g, '$1-$2')
        .toLowerCase()
}

function replace_lucide_component(state: State, source: string, component_name: string, icon_id: string) {
    let output = source
    let changed = false
    const escaped_name = escape_regex(component_name)

    const self_closing = new RegExp(`<${escaped_name}(\\s[^>]*?)?\\s*\\/\\s*>`, 'g')
    output = output.replace(self_closing, (_match, attrs = '') => {
        changed = true
        state.found_lucide_ids.add(icon_id)
        return `<Icon id="${icon_id}"${attrs} />`
    })

    const paired = new RegExp(`<${escaped_name}(\\s[^>]*?)?>([\\s\\S]*?)<\\/${escaped_name}>`, 'g')
    output = output.replace(paired, (_match, attrs = '', inner = '') => {
        changed = true
        state.found_lucide_ids.add(icon_id)
        return `<Icon id="${icon_id}"${attrs}>${inner}</Icon>`
    })

    return {output, changed}
}

function replace_lucide_object_value(state: State, source: string, component_name: string, icon_id: string) {
    let output = source
    let changed = false
    const escaped_name = escape_regex(component_name)
    const object_value = new RegExp(
        `([,{]\\s*(?:[A-Za-z_$][\\w$]*|['"][^'"]+['"]|\\[[^\\]]+\\])\\s*:\\s*)${escaped_name}\\b`,
        'g',
    )
    output = output.replace(object_value, (_match, prefix = '') => {
        changed = true
        state.found_lucide_ids.add(icon_id)
        return `${prefix}'${icon_id}'`
    })
    return {output, changed}
}

function replace_lucide_component_props_type(source: string, component_name: string) {
    let output = source
    let changed = false
    const escaped_name = escape_regex(component_name)
    const component_props_regex = new RegExp(`ComponentProps<\\s*typeof\\s+${escaped_name}\\s*>`, 'g')
    output = output.replace(component_props_regex, () => {
        changed = true
        return "Omit<ComponentProps<typeof Icon>, 'id'>"
    })
    return {output, changed}
}

function parse_named_lucide_specifier(specifier: string): {imported: string; local: string} | null {
    const match = specifier.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
    if (!match) return null
    return {
        imported: match[1],
        local: match[2] ?? match[1],
    }
}

function migrate_named_lucide_imports(state: State, source: string) {
    let output = source
    const matches = [...output.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@lucide\/svelte['"]\s*;?\s*\n?/g)]
    let changed_any = false

    for (const match of matches) {
        const full_import = match[0]
        const specifier_text = match[1]
        const raw_specifiers = specifier_text
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)

        const remove_specifiers = new Set<string>()
        for (const raw_specifier of raw_specifiers) {
            const parsed = parse_named_lucide_specifier(raw_specifier)
            if (!parsed) continue
            const icon_id = lucide_component_to_id(parsed.imported)
            if (!icon_id) continue
            const markup_replaced = replace_lucide_component(state, output, parsed.local, icon_id)
            output = markup_replaced.output
            const object_replaced = replace_lucide_object_value(state, output, parsed.local, icon_id)
            output = object_replaced.output
            const type_replaced = replace_lucide_component_props_type(output, parsed.local)
            output = type_replaced.output
            if (!markup_replaced.changed && !object_replaced.changed && !type_replaced.changed) continue
            changed_any = true
            if (!identifier_is_used_outside_lucide_imports(output, parsed.local)) {
                remove_specifiers.add(raw_specifier)
            }
        }

        if (remove_specifiers.size === 0) continue
        const kept_specifiers = raw_specifiers.filter(specifier => !remove_specifiers.has(specifier))
        if (kept_specifiers.length === 0) {
            output = output.replace(full_import, '')
            continue
        }
        const replacement = `import {${kept_specifiers.join(', ')}} from '@lucide/svelte'\n`
        output = output.replace(full_import, replacement)
    }

    return {output, changed: changed_any}
}

function migrate_subpath_lucide_imports(state: State, source: string) {
    let output = source
    const matches = [...output.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]@lucide\/svelte\/icons\/([^'"]+)['"]\s*;?\s*\n?/g)]
    let changed_any = false

    for (const match of matches) {
        const full_import = match[0]
        const local_name = match[1]
        const icon_id = normalize_path(match[2]).split('/').pop()?.replace(/\.[a-z]+$/i, '') ?? ''
        if (!icon_id) continue
        const markup_replaced = replace_lucide_component(state, output, local_name, icon_id)
        output = markup_replaced.output
        const object_replaced = replace_lucide_object_value(state, output, local_name, icon_id)
        output = object_replaced.output
        const type_replaced = replace_lucide_component_props_type(output, local_name)
        output = type_replaced.output
        if (!markup_replaced.changed && !object_replaced.changed && !type_replaced.changed) continue
        changed_any = true
        if (!identifier_is_used_outside_lucide_imports(output, local_name)) {
            output = output.replace(full_import, '')
        }
    }

    return {output, changed: changed_any}
}

function migrate_dynamic_icon_tags(source: string) {
    let output = source
    let changed = false
    const dynamic_icon_regex = /<Icon(\s[^>]*?)?\s*\/>/g
    output = output.replace(dynamic_icon_regex, (match, attrs = '') => {
        if (/\bid\s*=/.test(attrs)) return match
        changed = true
        return `{#if typeof Icon === 'string'}
    <SpriteIcon id={Icon}${attrs} />
{:else}
    {@const DynamicIcon = Icon}
    <DynamicIcon${attrs} />
{/if}`
    })
    return {output, changed}
}

function migrate_deprecated_dynamic_icon_component(source: string) {
    let output = source
    let changed = false
    const deprecated_regex = /<svelte:component\s+this=\{Icon\}(\s[^>]*?)?\s*\/>/g
    output = output.replace(deprecated_regex, (_match, attrs = '') => {
        changed = true
        return `{@const DynamicIcon = Icon}
    <DynamicIcon${attrs} />`
    })
    return {output, changed}
}

function migrate_icons_lookup_map(state: State, source: string) {
    if (!source.includes('{@const Icon = icons[')) return {output: source, changed: false}

    const icons_map_regex = /\b(?:const|let|var)\s+icons\s*=\s*\{([\s\S]*?)\}/m
    const match = source.match(icons_map_regex)
    if (!match) return {output: source, changed: false}

    const body = match[1]
    let body_changed = false
    const next_body = body.replace(/(:\s*)([A-Za-z_$][\w$]*)\b/g, (segment, prefix = '', value = '') => {
        const icon_id = lucide_component_to_id(value)
        if (!icon_id) return segment
        body_changed = true
        state.found_lucide_ids.add(icon_id)
        return `${prefix}'${icon_id}'`
    })
    if (!body_changed) return {output: source, changed: false}

    return {output: source.replace(body, next_body), changed: true}
}

function ensure_default_import(source: string, import_path: string, local_name: string): string {
    const import_regex = new RegExp(
        `import\\s+${escape_regex(local_name)}\\s+from\\s+['"]${escape_regex(import_path)}['"]`,
    )
    if (import_regex.test(source)) return source

    const script_block_regex = /<script(\s[^>]*)?>/
    const script_match = source.match(script_block_regex)
    if (!script_match) return `<script>\nimport ${local_name} from '${import_path}'\n</script>\n\n${source}`

    const start_index = script_match.index ?? 0
    const insert_index = start_index + script_match[0].length
    return `${source.slice(0, insert_index)}\nimport ${local_name} from '${import_path}'${source.slice(insert_index)}`
}

function migrate_svelte_files(state: State): void {
    const src_dir = path.join(state.root_dir, state.source_dir)
    if (!existsSync(src_dir)) return

    const files = get_svelte_files(src_dir).filter(
        file => normalize_path(file) !== normalize_path(path.join(state.root_dir, state.icon_component_path)),
    )
    for (const file_path of files) {
        const relative_path = normalize_path(path.relative(state.root_dir, file_path))
        update_text_file(state, relative_path, before => {
            const named_result = migrate_named_lucide_imports(state, before)
            const subpath_result = migrate_subpath_lucide_imports(state, named_result.output)
            const map_result = migrate_icons_lookup_map(state, subpath_result.output)
            const dynamic_result = migrate_dynamic_icon_tags(map_result.output)
            const deprecated_result = migrate_deprecated_dynamic_icon_component(dynamic_result.output)
            if (
                !named_result.changed &&
                !subpath_result.changed &&
                !map_result.changed &&
                !dynamic_result.changed &&
                !deprecated_result.changed
            ) {
                return before
            }

            let next = deprecated_result.output
            if (named_result.changed || subpath_result.changed) {
                next = ensure_default_import(next, '$icon', 'Icon')
            }
            if (dynamic_result.changed) {
                next = ensure_default_import(next, '$icon', 'SpriteIcon')
            }
            return next
        })
    }
}

function to_lucide_icon_ids_array(ids: string[]): string {
    if (ids.length === 0) return 'export const LUCIDE_ICON_IDS = /** @type {const} */ ([])'
    return `export const LUCIDE_ICON_IDS = /** @type {const} */ ([\n${ids.map(id => `    '${id}',`).join('\n')}\n])`
}

function create_icon_component(state: State): void {
    const relative_path = state.icon_component_path
    if (read_text_file(state, relative_path) != null) return

    const icon_ids = [...state.found_lucide_ids].sort()
    const content = `<script module>
${to_lucide_icon_ids_array(icon_ids)}
</script>

<script>
/** @type {{
    id: typeof LUCIDE_ICON_IDS[number]
    class?: string
    size?: number | string
    color?: string
    strokeWidth?: number
    absoluteStrokeWidth?: boolean
    [x: string]: any
}} */
let {
    id,
    class: class_name = '',
    size = undefined,
    color = 'currentColor',
    strokeWidth = 2,
    absoluteStrokeWidth = false,
    ...rest
} = $props()

const sprite_href = $derived(\`\${import.meta.env.BASE_URL}lucide.svg#\${id}\`)
const size_css = $derived.by(() => {
    if (size == null) return undefined
    if (typeof size === 'number') return \`\${size}px\`

    const trimmed_size = String(size).trim()
    return /^\\d+(?:\\.\\d+)?$/.test(trimmed_size) ? \`\${trimmed_size}px\` : trimmed_size
})
const numeric_size = $derived(Number(size))
const computed_stroke_width = $derived(
    absoluteStrokeWidth && Number.isFinite(numeric_size) && numeric_size > 0
        ? (Number(strokeWidth) * 24) / numeric_size
        : strokeWidth,
)
</script>

<svg
    class={['icon', \`icon-\${id}\`, 'icon-lucide', class_name]}
    style:width={size_css}
    style:height={size_css}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width={computed_stroke_width}
    stroke-linecap="round"
    stroke-linejoin="round"
    {...rest}
>
    <use href={sprite_href}></use>
</svg>
`

    state.changed_files.push(relative_path)
    if (!state.dry_run) write_text_file(state, relative_path, content)
}

function migrate_css(state: State): void {
    update_text_file(state, `${state.source_dir}/css/base.css`, before => {
        if (before.includes('.icon-lucide {')) return before
        const block = `.icon-lucide {\n  color: inherit;\n  fill: none;\n}\n\n`
        if (before.includes('/* Search */')) return before.replace('/* Search */', `${block}/* Search */`)
        return `${before.trimEnd()}\n\n${block}`
    })
}

function migrate_vite_config(state: State): void {
    update_text_file(state, 'vite.config.js', before => {
        let next = before
        const import_line = "import lucide_sprite_plugin from 'vite-plugin-lucide-sprite'\n"
        const plugin_call =
            state.icon_component_path === 'src/components/Icon.svelte'
                ? 'lucide_sprite_plugin(),'
                : `lucide_sprite_plugin({icon_component_path: '${state.icon_component_path}'}),`
        if (!next.includes(import_line.trim())) {
            next = next.replace(
                /import lucide_sprite_plugin from ['"].*?vite-plugin-lucide-sprite.*?['"]\n?/g,
                '',
            )
            next = `${import_line}${next}`
        }
        if (next.includes('lucide_sprite_plugin(')) {
            next = next.replace(/lucide_sprite_plugin\([^)]*\),/g, plugin_call)
        } else {
            next = next.replace(/plugins:\s*\[\n/, match => `${match}        ${plugin_call}\n`)
        }
        if (!/\$icon\s*:/.test(next)) {
            const icon_component_path = state.icon_component_path.replace(/^\/+/, '')
            next = next.replace(
                /alias:\s*\{\n/,
                match => `${match}            $icon: '/${icon_component_path}',\n`,
            )
        }
        return next
    })
}

function migrate_tsconfig_alias(state: State, relative_path: string): void {
    const before = read_text_file(state, relative_path)
    if (before == null) return

    const parse_errors: ParseError[] = []
    const config = parse_jsonc(before, parse_errors, {
        allowTrailingComma: true,
        disallowComments: false,
    }) as Record<string, any>
    if (parse_errors.length > 0 || !config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error(`Could not parse ${relative_path}.`)
    }
    const prev_base_url = config.compilerOptions?.baseUrl
    const prev_alias = config.compilerOptions?.paths?.$icon

    config.compilerOptions ||= {}
    config.compilerOptions.baseUrl ||= '.'
    config.compilerOptions.paths ||= {}
    config.compilerOptions.paths.$icon = [normalize_path(state.icon_component_path)]

    if (
        prev_base_url === config.compilerOptions.baseUrl &&
        JSON.stringify(prev_alias) === JSON.stringify(config.compilerOptions.paths.$icon)
    ) {
        return
    }

    const after = `${JSON.stringify(config, null, 2)}\n`
    if (after === before) return
    state.changed_files.push(relative_path)
    if (!state.dry_run) write_text_file(state, relative_path, after)
}

function migrate_package_json(state: State): void {
    const relative_path = 'package.json'
    const before = read_text_file(state, relative_path)
    if (before == null) return
    const pkg = JSON.parse(before) as Record<string, any>

    pkg.devDependencies ||= {}
    if (pkg.dependencies) delete pkg.dependencies['@lucide/svelte']
    if (pkg.dependencies && Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies
    delete pkg.devDependencies['@lucide/svelte']
    pkg.devDependencies['lucide-static'] ||= 'latest'

    const after = `${JSON.stringify(pkg, null, 2)}\n`
    if (after === before) return
    state.changed_files.push(relative_path)
    if (!state.dry_run) write_text_file(state, relative_path, after)
}

function run_all_migrations(state: State): void {
    migrate_svelte_files(state)
    create_icon_component(state)
    migrate_css(state)
    migrate_vite_config(state)
    migrate_tsconfig_alias(state, 'tsconfig.json')
    migrate_tsconfig_alias(state, 'jsconfig.json')
    migrate_package_json(state)
}

function resolve_icon_component_path(root_dir: string, source_dir: string, preferred?: string): string {
    if (preferred) return normalize_path(preferred)

    const default_path = normalize_path(`${source_dir}/lib/components/Icon.svelte`)
    const default_dir = path.dirname(path.join(root_dir, default_path))
    if (existsSync(default_dir)) return default_path

    throw new Error(
        `Default Icon path "${default_path}" is not available. Pass --icon-component-path <path>.`,
    )
}

export function run_lucide_sprite_codemod(
    user: RunLucideSpriteCodemodOptions = {},
): RunLucideSpriteCodemodResult {
    const root_dir = user.root_dir ?? process.cwd()
    const source_dir = normalize_path(user.source_dir ?? 'src')
    if (!existsSync(path.join(root_dir, source_dir))) {
        const message = user.source_dir
            ? `--source-dir "${source_dir}" was not found`
            : 'Default source directory "./src" was not found. Pass --source-dir <dir>.'
        throw new Error(message)
    }
    const icon_component_path = resolve_icon_component_path(root_dir, source_dir, user.icon_component_path)

    const state: State = {
        root_dir,
        dry_run: !!user.dry_run,
        source_dir,
        icon_component_path,
        changed_files: [],
        found_lucide_ids: new Set<string>(),
    }

    run_all_migrations(state)
    return {
        changed_files: state.changed_files,
        dry_run: state.dry_run,
    }
}
