# vite-plugin-lucide-sprite

One Vite plugin that builds one SVG sprite from multiple icon sets.

It reads icon ids from a `<script module>` export in your Svelte `Icon.svelte`, loads only the icons you listed, serves the sprite in dev, and emits it in build.

## Install

For Lucide + Simple Icons + a local sprite:

```bash
pnpm add -D vite-plugin-lucide-sprite lucide-static simple-icons
```

Install only the icon packages you actually use.

## Usage

`vite.config.js`:

```js
import {defineConfig} from 'vite'
import icon_sprite_plugin from 'vite-plugin-lucide-sprite'

export default defineConfig({
    plugins: [
        icon_sprite_plugin({
            sets: {
                le: 'lucide',
                si: 'simple-icons',
                i: 'public/icons.svg',
            },
        }),
    ],
})
```

`src/components/Icon.svelte`:

```svelte
<script module>
export const ICON_IDS = /** @type {const} */ ([
    'check',
    'chevron-down',
    'si/whatsapp',
    'i/share',
])
</script>

<script>
let {id, size = 24, color = 'currentColor', ...rest} = $props()

const full_id = $derived(id.includes('/') ? id : `le/${id}`)
const is_lucide = $derived(full_id.startsWith('le/'))
const sprite_href = $derived(`${import.meta.env.BASE_URL}icons.svg#${full_id.split('/').join('-')}`)
</script>

<svg
    width={size}
    height={size}
    {...(is_lucide
        ? {
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: color,
              'stroke-width': 2,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
          }
        : {fill: 'currentColor'})}
    {...rest}
>
    <use href={sprite_href}></use>
</svg>
```

Use it like this:

```svelte
<Icon id="chevron-down" />
<Icon id="si/whatsapp" class="text-green-500" />
<Icon id="i/share" />
```

## Set config

`sets` is a record where the key is the prefix you want in your icon ids.

```ts
type IconSetInput =
    | 'lucide'
    | 'simple-icons'
    | string
    | {type: 'lucide' | 'simple-icons'}
    | {type: 'sprite'; path: string}
```

Examples:

```js
sets: {
    le: 'lucide',
    si: 'simple-icons',
    i: 'public/icons.svg',
}
```

The sprite-file form expects an SVG that already contains `<symbol>` elements, like your local `icons.svg`.

Bare ids default to the `le` set, so `check` means `le/check`.

## Options

```ts
type IconSpritePluginOptions = {
    icon_component_path?: string
    icon_ids_export_name?: string
    output_file_name?: string
    minify?: boolean
    sets?: Record<string, IconSetInput>
}
```

Defaults:

- `icon_component_path`: `'src/components/Icon.svelte'`
- `icon_ids_export_name`: `'ICON_IDS'`
- `output_file_name`: `'icons.svg'`
- `minify`: `true`
- `sets`: `{le: 'lucide'}`

## Local `public/icons.svg`

If you use `public/icons.svg` as an input set and also emit `icons.svg`, the dev server path is fine.

For build output, either:

- keep `publicDir: false` for build, or
- use a different `output_file_name`

That avoids your source `public/icons.svg` fighting with the generated output file.

## Codemod CLI

The CLI still migrates Lucide component usage and generates an `Icon.svelte` that uses `ICON_IDS` with `icons.svg`.

```bash
pnpm dlx vite-plugin-lucide-sprite@latest
pnpm exec vite-plugin-lucide-sprite --dry-run
pnpm exec vite-plugin-lucide-sprite
```
