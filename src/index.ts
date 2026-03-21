import type {Plugin} from 'vite'

import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {parse as parse_svelte} from 'svelte/compiler'

const require = createRequire(import.meta.url)
const lucide_static_icons_dir = path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons')
const normalize_path = (value: string) => value.split(path.sep).join('/')

export type LucideSpritePluginOptions = {
    icon_component_path?: string
    icon_ids_export_name?: string
    output_file_name?: string
}

type SpriteData = {
    icon_count: number
    sprite: string
}

function read_lucide_icon_ids(icon_component_path: string, icon_ids_export_name: string): string[] {
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

function build_lucide_sprite(icon_component_path: string, icon_ids_export_name: string): SpriteData {
    const icon_ids = [...new Set(read_lucide_icon_ids(icon_component_path, icon_ids_export_name))].sort()
    const symbols = icon_ids
        .map(icon_id => {
            const svg_path = path.join(lucide_static_icons_dir, `${icon_id}.svg`)
            const svg = readFileSync(svg_path, 'utf8')
            const view_box = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
            const inner = svg
                .replace(/^[\s\S]*?<svg[^>]*>/, '')
                .replace(/<\/svg>\s*$/, '')
                .trim()

            if (!inner) throw new Error(`No SVG content found in ${svg_path}`)

            return `    <symbol id="${icon_id}" viewBox="${view_box}">\n      ${inner}\n    </symbol>`
        })
        .join('\n')

    return {
        icon_count: icon_ids.length,
        sprite: `<?xml version="1.0" encoding="UTF-8"?>
<svg style="display: none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs>
${symbols}
  </defs>
</svg>
`,
    }
}

export default function lucide_sprite_plugin(user: LucideSpritePluginOptions = {}): Plugin {
    const output_file_name = String(user.output_file_name ?? 'lucide.svg').replace(/^\/+/, '')
    const icon_ids_export_name = user.icon_ids_export_name ?? 'LUCIDE_ICON_IDS'
    const icon_component_path = user.icon_component_path ?? 'src/components/Icon.svelte'

    let root_path = process.cwd()
    let base_path = '/'
    let resolved_icon_component_path = path.resolve(root_path, icon_component_path)
    let cached_sprite: string | null = null
    let cached_icon_count = 0
    let icon_component_file_path = normalize_path(resolved_icon_component_path)

    const invalidate_cache = () => {
        cached_sprite = null
        cached_icon_count = 0
    }

    const ensure_sprite = (): SpriteData => {
        if (cached_sprite) return {icon_count: cached_icon_count, sprite: cached_sprite}
        const {icon_count, sprite} = build_lucide_sprite(resolved_icon_component_path, icon_ids_export_name)
        cached_sprite = sprite
        cached_icon_count = icon_count
        return {icon_count, sprite}
    }

    return {
        name: 'lucide_sprite',
        configResolved(config) {
            root_path = config.root
            base_path = config.base.endsWith('/') ? config.base : `${config.base}/`
            resolved_icon_component_path = path.resolve(root_path, icon_component_path)
            icon_component_file_path = normalize_path(resolved_icon_component_path)
        },
        buildStart() {
            this.addWatchFile(resolved_icon_component_path)
            invalidate_cache()
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const request_path = (req.url || '').split('?')[0]
                const output_path = `${base_path}${output_file_name}`

                if (request_path !== `/${output_file_name}` && request_path !== output_path) return next()

                return Promise.resolve(ensure_sprite())
                    .then(({sprite}) => {
                        res.statusCode = 200
                        res.setHeader('Content-Type', 'image/svg+xml')
                        res.setHeader('Cache-Control', 'no-cache')
                        res.end(sprite)
                    })
                    .catch(next)
            })
        },
        handleHotUpdate(ctx) {
            if (normalize_path(ctx.file) === icon_component_file_path) invalidate_cache()
        },
        generateBundle() {
            const {icon_count, sprite} = ensure_sprite()
            this.emitFile({type: 'asset', fileName: output_file_name, source: sprite})
            this.info(`Generated ${output_file_name} with ${icon_count} icons.`)
        },
    }
}
