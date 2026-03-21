# vite-plugin-lucide-sprite

Vite plugin that generates a Lucide SVG sprite (`lucide.svg`) from icon ids exported in a Svelte component.

## Why

This avoids repeating full SVG path markup every time an icon appears in your HTML.

- A typical Lucide SVG file is around `0.4-0.5 KB` raw:
  - measured against `lucide-static@0.577.0`: median `464 B`, average `480 B` across `1951` icons
- With a sprite, each icon usage is usually just a short `<use href="...#id">` reference
- In practice, repeated icon instances often save roughly `~0.4-0.5 KB` each before compression

Exact savings vary by icon, usage count, and gzip/brotli, but a practical rule of thumb is `~0.4-0.5 KB` per repeated icon instance.

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

## Codemod CLI

One command upgrade flow (temporary install + migrate):

```bash
pnpm dlx vite-plugin-lucide-sprite@latest
```

Run with a locally installed package:

```bash
pnpm exec vite-plugin-lucide-sprite --dry-run
pnpm exec vite-plugin-lucide-sprite
pnpm exec vite-plugin-lucide-sprite --force
```

Default source directory is `./src`; pass `--source-dir <dir>` if your app uses another directory.
Default Icon path is `<source_dir>/lib/components/Icon.svelte`.
If `<source_dir>/lib/components` does not exist, pass `--icon-component-path <path>`.
By default, CLI also installs missing dependencies (`vite-plugin-lucide-sprite`, `lucide-static@latest`).
Use `--no-install` to skip that step.

Safety behavior:

- By default, the codemod exits if `git status --porcelain` is not clean.
- Use `--force` to bypass this guard.

What it migrates:

- Replaces mapped `@lucide/svelte` component usages with `<Icon id="...">`
- Updates/cleans `@lucide/svelte` imports (rewritten to `import Icon from '$icon'`)
- Removes `@lucide/svelte` from `dependencies`/`devDependencies`
- Creates `Icon.svelte` if missing
- Updates matching core files (`<source_dir>/css/base.css`, `vite.config.js`, `package.json`, `tsconfig.json`/`jsconfig.json`)

Current component mapping:

- `Check -> check`
- `ChevronDown -> chevron-down`
- `Loader2 -> loader-circle`
- `LoaderCircle -> loader-circle`
- `Moon -> moon`
- `Sun -> sun`
- `Trash -> trash`
- `WifiOff -> wifi-off`
- `X -> x`

## Quick start

`vite.config.js`:

```js
import {defineConfig} from 'vite'
import lucide_sprite_plugin from 'vite-plugin-lucide-sprite'

export default defineConfig({
    plugins: [lucide_sprite_plugin({icon_component_path: 'src/lib/components/Icon.svelte'})],
})
```

`src/lib/components/Icon.svelte` (complete example):

```svelte
<script module>
export const LUCIDE_ICON_IDS = ['check', 'x', 'sun', 'moon']
</script>

<script>
let {id, size = 24, color = 'currentColor', ...rest} = $props()

const sprite_href = $derived(`${import.meta.env.BASE_URL}lucide.svg#${id}`)
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
    minify?: boolean
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
- `minify`:
  - Default: `true`
  - Minifies generated sprite markup (collapses line breaks/indentation)

Example with custom values:

```js
lucide_sprite_plugin({
    icon_component_path: 'src/lib/ui/Icon.svelte',
    icon_ids_export_name: 'APP_LUCIDE_ICONS',
    output_file_name: 'assets/lucide.svg',
    minify: true,
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
  - Sprite markup is minified by default

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
