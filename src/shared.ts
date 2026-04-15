import type {Plugin} from 'vite'

import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {parse as parse_svelte} from 'svelte/compiler'

const require = createRequire(import.meta.url)
const DEFAULT_SET_PREFIX = 'le'
const normalize_path = (value: string) => value.split(path.sep).join('/')

type PackageSetName = 'lucide' | 'simple-icons'

export type IconSetInput = PackageSetName | string | {type: PackageSetName} | {type: 'sprite'; path: string}

export type IconSpritePluginOptions = {
    icon_component_path?: string
    icon_ids_export_name?: string
    output_file_name?: string
    minify?: boolean
    sets?: Record<string, IconSetInput>
}

type ResolvedSet = {
    prefix: string
    type: PackageSetName | 'sprite'
    path?: string
}

type SpriteData = {
    icon_count: number
    sprite: string
}

type LocalSymbol = {
    attrs: string
    inner_svg: string
}

type CreateSpritePluginOptions = {
    name: string
    icon_component_path: string
    icon_ids_export_name: string
    output_file_name: string
    minify: boolean
    sets: Record<string, IconSetInput>
}

function get_icons_dir(type: PackageSetName): string {
    try {
        if (type === 'lucide') return path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons')
        return path.join(path.dirname(require.resolve('simple-icons')), 'icons')
    } catch {
        throw new Error(
            type === 'lucide'
                ? 'Could not resolve lucide-static. Install lucide-static in your app before using this plugin.'
                : 'Could not resolve simple-icons. Install simple-icons in your app before using this plugin.',
        )
    }
}

function read_icon_ids(icon_component_path: string, icon_ids_export_name: string): string[] {
    const source = readFileSync(icon_component_path, 'utf8')
    const ast = parse_svelte(source, {filename: icon_component_path})
    const module_body = ast.module?.content?.body ?? []
    let icon_ids_expression: any = null

    for (const statement of module_body) {
        if (statement.type !== 'ExportNamedDeclaration') continue
        if (!statement.declaration || statement.declaration.type !== 'VariableDeclaration') continue

        for (const declaration of statement.declaration.declarations) {
            if (declaration.id.type !== 'Identifier') continue
            if (declaration.id.name !== icon_ids_export_name) continue
            icon_ids_expression = declaration.init
        }
    }

    if (!icon_ids_expression) {
        throw new Error(
            `${path.basename(icon_component_path)} must export ${icon_ids_export_name} from <script module>.`,
        )
    }

    if (icon_ids_expression.type !== 'ArrayExpression') {
        throw new Error(`${icon_ids_export_name} in ${path.basename(icon_component_path)} must be an array literal.`)
    }

    return icon_ids_expression.elements.map((element: any, index: number) => {
        if (!element) {
            throw new Error(`${icon_ids_export_name}[${index}] in ${path.basename(icon_component_path)} cannot be empty.`)
        }

        const is_literal_string = element.type === 'Literal' && typeof element.value === 'string'
        const is_string_literal = element.type === 'StringLiteral' && typeof element.value === 'string'

        if (!is_literal_string && !is_string_literal) {
            throw new Error(
                `${icon_ids_export_name}[${index}] in ${path.basename(icon_component_path)} must be a string literal.`,
            )
        }

        return element.value
    })
}

function parse_icon_id(icon_id: string): {prefix: string; name: string} {
    const slash_index = icon_id.indexOf('/')
    if (slash_index === -1) return {prefix: DEFAULT_SET_PREFIX, name: icon_id}

    const prefix = icon_id.slice(0, slash_index)
    const name = icon_id.slice(slash_index + 1)

    if (!prefix || !name) {
        throw new Error(`Invalid icon id "${icon_id}". Expected "<set>/<icon>" or a bare Lucide id.`)
    }

    return {prefix, name}
}

function to_symbol_id(icon_id: string): string {
    return icon_id.replaceAll('/', '-')
}

function minify_svg(svg: string): string {
    return svg.replace(/\n\s*/g, ' ').replace(/>\s+</g, '><').trim()
}

function render_symbol(id: string, attrs: string, inner_svg: string): string {
    return `    <symbol id="${id}"${attrs}>\n      ${inner_svg.trim()}\n    </symbol>`
}

function read_svg_file(svg_path: string, strip_title: boolean): LocalSymbol {
    const svg = readFileSync(svg_path, 'utf8')
    const view_box = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
    let inner_svg = svg
        .replace(/^[\s\S]*?<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '')
        .trim()

    if (strip_title) inner_svg = inner_svg.replace(/<title>[\s\S]*?<\/title>/g, '').trim()
    if (!inner_svg) throw new Error(`No SVG content found in ${svg_path}`)

    return {
        attrs: ` viewBox="${view_box}"`,
        inner_svg,
    }
}

function read_local_symbols(sprite_path: string): Map<string, LocalSymbol> {
    const sprite = readFileSync(sprite_path, 'utf8')
    const symbols = new Map<string, LocalSymbol>()

    for (const match of sprite.matchAll(/<symbol\b([\s\S]*?)>([\s\S]*?)<\/symbol>/g)) {
        const attrs = match[1] ?? ''
        const id = attrs.match(/\bid=(['"])(.*?)\1/)?.[2]
        const inner_svg = (match[2] ?? '').trim()
        if (!id || !inner_svg) continue

        symbols.set(id, {
            attrs: attrs.replace(/\s*\bid=(['"])(.*?)\1/, ''),
            inner_svg,
        })
    }

    return symbols
}

function resolve_sets(sets: Record<string, IconSetInput> | undefined, root_path: string): ResolvedSet[] {
    if (!sets || Object.keys(sets).length === 0) throw new Error('icon_sprite_plugin requires at least one set.')

    return Object.entries(sets).map(([prefix, input]) => {
        if (!prefix) throw new Error('Icon set prefixes cannot be empty.')
        if (prefix.includes('/')) throw new Error(`Icon set prefix "${prefix}" cannot contain "/".`)

        if (input === 'lucide' || (typeof input === 'object' && input.type === 'lucide')) {
            return {prefix, type: 'lucide' as const}
        }

        if (input === 'simple-icons' || (typeof input === 'object' && input.type === 'simple-icons')) {
            return {prefix, type: 'simple-icons' as const}
        }

        if (typeof input === 'string') {
            return {
                prefix,
                type: 'sprite' as const,
                path: path.resolve(root_path, input),
            }
        }

        if (typeof input === 'object' && input.type === 'sprite' && typeof input.path === 'string' && input.path) {
            return {
                prefix,
                type: 'sprite' as const,
                path: path.resolve(root_path, input.path),
            }
        }

        throw new Error(
            `Invalid icon set config for "${prefix}". Use "lucide", "simple-icons", a sprite path string, or {type: 'sprite', path: '...'}`
        )
    })
}

function get_watched_files(icon_component_path: string, sets: ResolvedSet[]): string[] {
    return [icon_component_path, ...sets.filter(set => set.type === 'sprite').map(set => set.path as string)]
}

function build_svg_sprite(
    icon_component_path: string,
    icon_ids_export_name: string,
    sets: ResolvedSet[],
    minify: boolean,
): SpriteData {
    const icon_ids = [...new Set(read_icon_ids(icon_component_path, icon_ids_export_name))].sort()
    const sets_by_prefix = new Map(sets.map(set => [set.prefix, set]))
    const requested_by_prefix = new Map<string, Set<string>>()

    for (const icon_id of icon_ids) {
        const {prefix, name} = parse_icon_id(icon_id)
        if (!sets_by_prefix.has(prefix)) throw new Error(`No icon set configured for "${prefix || icon_id}".`)
        if (!requested_by_prefix.has(prefix)) requested_by_prefix.set(prefix, new Set())
        requested_by_prefix.get(prefix)?.add(name)
    }

    const symbols: string[] = []

    for (const set of sets) {
        const requested_ids = [...(requested_by_prefix.get(set.prefix) ?? new Set())].sort()
        if (requested_ids.length === 0) continue

        if (set.type === 'sprite') {
            const local_symbols = read_local_symbols(set.path as string)

            for (const icon_name of requested_ids) {
                const local_symbol = local_symbols.get(icon_name)
                const full_icon_id = `${set.prefix}/${icon_name}`
                if (!local_symbol) throw new Error(`Local icon "${full_icon_id}" was not found in ${set.path}.`)
                symbols.push(render_symbol(to_symbol_id(full_icon_id), local_symbol.attrs, local_symbol.inner_svg))
            }

            continue
        }

        const icons_dir = get_icons_dir(set.type)
        const strip_title = set.type === 'simple-icons'

        for (const icon_name of requested_ids) {
            const svg_path = path.join(icons_dir, `${icon_name}.svg`)
            const full_icon_id = `${set.prefix}/${icon_name}`

            try {
                const icon_svg = read_svg_file(svg_path, strip_title)
                symbols.push(render_symbol(to_symbol_id(full_icon_id), icon_svg.attrs, icon_svg.inner_svg))
            } catch {
                throw new Error(
                    set.type === 'lucide'
                        ? `Lucide icon "${icon_name}" was not found.`
                        : `Simple Icon "${icon_name}" was not found.`,
                )
            }
        }
    }

    const sprite = `<?xml version="1.0" encoding="UTF-8"?>
<svg style="display: none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs>
${symbols.join('\n')}
  </defs>
</svg>
`

    return {
        icon_count: icon_ids.length,
        sprite: minify ? minify_svg(sprite) : sprite,
    }
}

export function create_sprite_plugin(user: CreateSpritePluginOptions): Plugin {
    const output_file_name = String(user.output_file_name).replace(/^\/+/, '')

    let root_path = process.cwd()
    let base_path = '/'
    let icon_component_path = path.resolve(root_path, user.icon_component_path)
    let sets = resolve_sets(user.sets, root_path)
    let watched_files = get_watched_files(icon_component_path, sets).map(normalize_path)
    let cache: SpriteData | null = null

    const refresh = () => {
        icon_component_path = path.resolve(root_path, user.icon_component_path)
        sets = resolve_sets(user.sets, root_path)
        watched_files = get_watched_files(icon_component_path, sets).map(normalize_path)
    }

    const ensure_sprite = (): SpriteData => {
        if (cache) return cache

        cache = build_svg_sprite(icon_component_path, user.icon_ids_export_name, sets, user.minify)
        return cache
    }

    return {
        name: user.name,
        configResolved(config: any) {
            root_path = config.root
            base_path = config.base.endsWith('/') ? config.base : `${config.base}/`
            refresh()
        },
        buildStart() {
            refresh()

            for (const file_path of get_watched_files(icon_component_path, sets)) {
                this.addWatchFile(file_path)
            }

            cache = null
        },
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: any) => {
                const request_path = (req.url || '').split('?')[0]
                const output_path = `${base_path}${output_file_name}`
                if (request_path !== `/${output_file_name}` && request_path !== output_path) return next()

                return Promise.resolve()
                    .then(() => ensure_sprite())
                    .then(({sprite}) => {
                        res.statusCode = 200
                        res.setHeader('Content-Type', 'image/svg+xml')
                        res.setHeader('Cache-Control', 'no-cache')
                        res.end(sprite)
                    })
                    .catch(next)
            })
        },
        handleHotUpdate(ctx: any) {
            if (watched_files.includes(normalize_path(ctx.file))) cache = null
        },
        generateBundle() {
            const {icon_count, sprite} = ensure_sprite()
            this.emitFile({type: 'asset', fileName: output_file_name, source: sprite})
            this.info(`Generated ${output_file_name} with ${icon_count} icons.`)
        },
    }
}
