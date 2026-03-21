import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import path from 'node:path'

export type RunLucideSpriteCodemodOptions = {
    root_dir?: string
    dry_run?: boolean
    source_dir?: string
}

export type RunLucideSpriteCodemodResult = {
    changed_files: string[]
    dry_run: boolean
}

const lucide_component_to_id: Record<string, string> = {
    Check: 'check',
    ChevronDown: 'chevron-down',
    Loader2: 'loader-circle',
    LoaderCircle: 'loader-circle',
    Moon: 'moon',
    Sun: 'sun',
    Trash: 'trash',
    WifiOff: 'wifi-off',
    X: 'x',
}

type State = {
    root_dir: string
    dry_run: boolean
    source_dir: string
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

function get_icon_import_path(state: State, file_path: string): string {
    const target = path.join(state.root_dir, `${state.source_dir}/components/Icon.svelte`)
    let relative = normalize_path(path.relative(path.dirname(file_path), target))
    if (!relative.startsWith('.')) relative = `./${relative}`
    return relative
}

function replace_lucide_components(state: State, source: string, names_to_replace: string[]) {
    let output = source
    let changed = false

    for (const name of names_to_replace) {
        const icon_id = lucide_component_to_id[name]
        if (!icon_id) continue

        const self_closing = new RegExp(`<${name}(\\s[^>]*?)?\\s*\\/\\s*>`, 'g')
        output = output.replace(self_closing, (_match, attrs = '') => {
            changed = true
            state.found_lucide_ids.add(icon_id)
            return `<Icon id="${icon_id}"${attrs} />`
        })

        const paired = new RegExp(`<${name}(\\s[^>]*?)?>([\\s\\S]*?)<\\/${name}>`, 'g')
        output = output.replace(paired, (_match, attrs = '', inner = '') => {
            changed = true
            state.found_lucide_ids.add(icon_id)
            return `<Icon id="${icon_id}"${attrs}>${inner}</Icon>`
        })
    }

    return {output, changed}
}

function remove_lucide_import_specifiers(source: string, names_to_remove: Set<string>) {
    const import_regex = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@lucide\/svelte['"]\s*;?\s*\n?/m
    const match = source.match(import_regex)
    if (!match) return {output: source, removed_any: false}

    const full_import = match[0]
    const specifier_text = match[1]
    const specifiers = specifier_text
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

    const kept_specifiers = specifiers.filter(spec => !names_to_remove.has(spec))
    const removed_any = kept_specifiers.length !== specifiers.length
    if (!removed_any) return {output: source, removed_any: false}

    if (kept_specifiers.length === 0) {
        return {output: source.replace(full_import, ''), removed_any: true}
    }

    const replacement = `import {${kept_specifiers.join(', ')}} from '@lucide/svelte'\n`
    return {output: source.replace(full_import, replacement), removed_any: true}
}

function ensure_icon_import(source: string, import_path: string): string {
    if (source.includes(`from '${import_path}'`) || source.includes(`from "${import_path}"`)) return source

    const script_block_regex = /<script(\s[^>]*)?>/
    const script_match = source.match(script_block_regex)
    if (!script_match) return `<script>\nimport Icon from '${import_path}'\n</script>\n\n${source}`

    const start_index = script_match.index ?? 0
    const insert_index = start_index + script_match[0].length
    return `${source.slice(0, insert_index)}\nimport Icon from '${import_path}'${source.slice(insert_index)}`
}

function migrate_svelte_files(state: State): void {
    const src_dir = path.join(state.root_dir, state.source_dir)
    if (!existsSync(src_dir)) return

    const files = get_svelte_files(src_dir).filter(
        file => normalize_path(file) !== normalize_path(path.join(state.root_dir, `${state.source_dir}/components/Icon.svelte`)),
    )
    for (const file_path of files) {
        const relative_path = normalize_path(path.relative(state.root_dir, file_path))
        update_text_file(state, relative_path, before => {
            const import_match = before.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]@lucide\/svelte['"]\s*;?\s*\n?/m)
            if (!import_match) return before

            const names = import_match[1]
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            const names_to_replace = names.filter(name => lucide_component_to_id[name])
            if (names_to_replace.length === 0) return before

            const {output: replaced_markup, changed} = replace_lucide_components(state, before, names_to_replace)
            if (!changed) return before

            const {output: without_lucide_import} = remove_lucide_import_specifiers(
                replaced_markup,
                new Set(names_to_replace),
            )

            return ensure_icon_import(without_lucide_import, get_icon_import_path(state, file_path))
        })
    }
}

function to_lucide_icon_ids_array(ids: string[]): string {
    if (ids.length === 0) return 'export const LUCIDE_ICON_IDS = []'
    return `export const LUCIDE_ICON_IDS = [\n${ids.map(id => `    '${id}',`).join('\n')}\n]`
}

function migrate_icon_component(state: State): void {
    const relative_path = `${state.source_dir}/components/Icon.svelte`
    const before = read_text_file(state, relative_path)
    if (before == null) return

    const existing_ids = new Set<string>()
    const existing_block_regex = /export const LUCIDE_ICON_IDS\s*=\s*\[[\s\S]*?\]/m
    const existing_block_match = before.match(/export const LUCIDE_ICON_IDS\s*=\s*\[([\s\S]*?)\]/m)
    if (existing_block_match) {
        const matches = existing_block_match[1].matchAll(/'([^']+)'/g)
        for (const match of matches) existing_ids.add(match[1])
    }

    for (const id of existing_ids) state.found_lucide_ids.add(id)

    const icon_ids = [...state.found_lucide_ids].sort()
    const ids_block = to_lucide_icon_ids_array(icon_ids)

    const is_already_migrated =
        before.includes('const sprite_href = $derived') && before.includes('LUCIDE_ICON_IDS.includes(id)')
    if (is_already_migrated) {
        if (!existing_block_regex.test(before)) return
        const next = before.replace(existing_block_regex, ids_block)
        if (next !== before) {
            state.changed_files.push(relative_path)
            if (!state.dry_run) write_text_file(state, relative_path, next)
        }
        return
    }

    const next = `<svg
    class={['icon', \`icon-\${id}\`, is_lucide && 'icon-lucide', class_name]}
    style:width={size_css}
    style:height={size_css}
    {...is_lucide
        ? {
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: color,
              'stroke-width': computed_stroke_width,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
          }
        : {}}
    {...rest}
>
    <use href={sprite_href}></use>
</svg>

<script module>
${ids_block}
</script>

<script>
let {
    id,
    class: class_name = '',
    size = undefined,
    color = 'currentColor',
    strokeWidth = 2,
    absoluteStrokeWidth = false,
    ...rest
} = $props()

const is_lucide = $derived(LUCIDE_ICON_IDS.includes(id))
const sprite_name = $derived(is_lucide ? 'lucide.svg' : 'icons.svg')
const sprite_href = $derived(\`\${import.meta.env.BASE_URL}\${sprite_name}#\${id}\`)
const size_css = $derived.by(() => {
    if (size == null) return undefined
    if (typeof size === 'number') return \`\${size}px\`

    const trimmed_size = String(size).trim()
    return /^\\d+(?:\\.\\d+)?$/.test(trimmed_size) ? \`\${trimmed_size}px\` : trimmed_size
})
const numeric_size = $derived(Number(size))
const computed_stroke_width = $derived(
    is_lucide && absoluteStrokeWidth && Number.isFinite(numeric_size) && numeric_size > 0
        ? (Number(strokeWidth) * 24) / numeric_size
        : strokeWidth,
)
</script>
`

    if (next !== before) {
        state.changed_files.push(relative_path)
        if (!state.dry_run) write_text_file(state, relative_path, next)
    }
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
        if (!next.includes(import_line.trim())) {
            next = next.replace(
                /import lucide_sprite_plugin from ['"].*?vite-plugin-lucide-sprite.*?['"]\n?/g,
                '',
            )
            next = next.replace(
                /import pkg from '\.\/package\.json' with \{type: 'json'\}\n/,
                match => `${match}${import_line}`,
            )
        }
        if (!next.includes('lucide_sprite_plugin(),')) {
            next = next.replace(/plugins:\s*\[\n/, match => `${match}        lucide_sprite_plugin(),\n`)
        }
        return next
    })
}

function migrate_build_script(state: State): void {
    update_text_file(state, 'build.js', before => {
        let next = before
        next = next.replace(
            "import {existsSync as exists, readFileSync, writeFileSync as write} from 'fs'",
            "import {cpSync, existsSync as exists, readFileSync, writeFileSync as write} from 'fs'",
        )

        const old_icon_block =
            /const icon_repls = \[[\s\S]*?write\('dist-native\/index\.html', pg_native \+ icons\)\n\nexec\(`cp -LR public\/\* dist-native`, \{shell: true\}\)\n?/
        if (old_icon_block.test(next)) {
            next = next.replace(
                old_icon_block,
                "write('dist/index.html', pg)\nwrite('dist-native/index.html', pg_native)\n\ncpSync('public', 'dist', {recursive: true})\ncpSync('public', 'dist-native', {recursive: true})\n",
            )
        }

        if (next.includes("exec(`cp -LR public/* dist-native`, {shell: true})")) {
            next = next.replace(
                "exec(`cp -LR public/* dist-native`, {shell: true})",
                "cpSync('public', 'dist', {recursive: true})\ncpSync('public', 'dist-native', {recursive: true})",
            )
        }

        return next
    })
}

function migrate_package_json(state: State): void {
    const relative_path = 'package.json'
    const before = read_text_file(state, relative_path)
    if (before == null) return
    const pkg = JSON.parse(before) as Record<string, any>

    pkg.devDependencies ||= {}
    delete pkg.devDependencies['@lucide/svelte']
    pkg.devDependencies['lucide-static'] ||= '^0.562.0'
    pkg.devDependencies['vite-plugin-lucide-sprite'] ||= '^0.1.0'

    if (pkg.scripts) {
        delete pkg.scripts.prebuild
        delete pkg.scripts.predev
    }

    const after = `${JSON.stringify(pkg, null, 2)}\n`
    if (after === before) return
    state.changed_files.push(relative_path)
    if (!state.dry_run) write_text_file(state, relative_path, after)
}

function run_all_migrations(state: State): void {
    migrate_svelte_files(state)
    migrate_icon_component(state)
    migrate_css(state)
    migrate_vite_config(state)
    migrate_build_script(state)
    migrate_package_json(state)
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

    const state: State = {
        root_dir,
        dry_run: !!user.dry_run,
        source_dir,
        changed_files: [],
        found_lucide_ids: new Set<string>(),
    }

    run_all_migrations(state)
    return {
        changed_files: state.changed_files,
        dry_run: state.dry_run,
    }
}
