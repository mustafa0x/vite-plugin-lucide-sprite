# vite-plugin-lucide-sprite

Vite plugin that generates a Lucide SVG sprite (`lucide.svg`) from icon ids exported in a Svelte component.

## What it does

- Reads icon ids from a `<script module>` export in your component
- Loads SVG files from `lucide-static`
- Generates a single SVG sprite with `<symbol>` entries
- Serves the sprite in dev and emits it in build
- Caches output in memory and invalidates when the icon component file changes

## Requirements

- `vite >= 5`
- `svelte >= 5` (compiler is used for AST parsing)
- `lucide-static` installed in your app

## Install

```bash
pnpm add -D vite-plugin-lucide-sprite lucide-static
```

## Quick start

`vite.config.js`:

```js
import {defineConfig} from 'vite'
import lucide_sprite_plugin from 'vite-plugin-lucide-sprite'

export default defineConfig({
    plugins: [lucide_sprite_plugin()],
})
```

`src/components/Icon.svelte` (complete example):

```svelte
<script module>
export const LUCIDE_ICON_IDS = ['check', 'x', 'sun', 'moon']
</script>

<script>
let {id, size = 24, color = 'currentColor', ...rest} = $props()

const is_lucide = $derived(LUCIDE_ICON_IDS.includes(id))
const sprite_name = $derived(is_lucide ? 'lucide.svg' : 'icons.svg')
const sprite_href = $derived(`${import.meta.env.BASE_URL}${sprite_name}#${id}`)
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    {...rest}
>
    <use href={sprite_href}></use>
</svg>
```

Use it in app code:

```svelte
<Icon id="check" />
```

If you are rendering `<use>` directly (without an `Icon` wrapper), define the href in script first:

```svelte
<script>
const sprite_href = `${import.meta.env.BASE_URL}lucide.svg#check`
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <use href={sprite_href}></use>
</svg>
```

## Options

```ts
type LucideSpritePluginOptions = {
    icon_component_path?: string
    icon_ids_export_name?: string
    output_file_name?: string
}
```

- `icon_component_path`:
  - Default: `'src/components/Icon.svelte'`
  - Path to the Svelte component that exports icon ids
- `icon_ids_export_name`:
  - Default: `'LUCIDE_ICON_IDS'`
  - Name of the `<script module>` export to read
- `output_file_name`:
  - Default: `'lucide.svg'`
  - Output file name (served in dev and emitted in build)

Example with custom values:

```js
lucide_sprite_plugin({
    icon_component_path: 'src/lib/ui/Icon.svelte',
    icon_ids_export_name: 'APP_LUCIDE_ICONS',
    output_file_name: 'assets/lucide.svg',
})
```

## Rules for the icon export

The plugin intentionally keeps parsing simple and strict:

- Export must exist in `<script module>`
- Export value must be an array literal
- Every item must be a string literal

Accepted:

```svelte
<script module>
export const LUCIDE_ICON_IDS = ['check', 'x']
</script>
```

Rejected:

```svelte
<script module>
const base = ['check']
export const LUCIDE_ICON_IDS = [...base, dynamic_icon]
</script>
```

## Dev and build behavior

- Dev:
  - Middleware responds to `/lucide.svg` (or your custom `output_file_name`)
  - Regeneration is lazy (on first request after invalidation)
- Build:
  - Emits the sprite as an asset through Rollup/Vite (`generateBundle`)
- Caching:
  - Cached in memory
  - Invalidated when the configured icon component file changes
- Output details:
  - IDs are deduplicated with `Set`
  - IDs are sorted before generation

## Troubleshooting

- `must export LUCIDE_ICON_IDS from <script module>`:
  - Add the export in `<script module>`, not instance `<script>`
- `must be an array literal`:
  - Use a direct array literal instead of computed values
- `must be a string literal`:
  - Use plain strings (not variables, expressions, or function calls)
- `Lucide icon "..." was not found`:
  - Ensure the icon id exists in your installed `lucide-static` version

## TypeScript

The package is authored in TypeScript and ships:

- `dist/index.js`
- `dist/index.d.ts`
