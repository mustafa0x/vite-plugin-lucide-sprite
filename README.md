# vite-plugin-lucide-sprite

Vite plugin that generates `lucide.svg` from `lucide-static` using icon ids exported from a Svelte component.

## Requirements

- `lucide-static`
- `svelte` (compiler is used to parse the component)
- `vite`

## Source of truth

Your icon component must export `LUCIDE_ICON_IDS` from `<script module>`.

```svelte
<script module>
export const LUCIDE_ICON_IDS = ['check', 'x']
</script>
```

## Install

```bash
pnpm add -D vite-plugin-lucide-sprite lucide-static
```

## Usage

```js
import {defineConfig} from 'vite'
import lucide_sprite_plugin from 'vite-plugin-lucide-sprite'

export default defineConfig({
    plugins: [lucide_sprite_plugin()],
})
```

## Options

- `icon_component_path` default: `'src/components/Icon.svelte'`
- `icon_ids_export_name` default: `'LUCIDE_ICON_IDS'`
- `output_file_name` default: `'lucide.svg'`

## Behavior

- Dev: serves generated sprite at `/lucide.svg`
- Build: emits `lucide.svg` as an asset
- Caches generation in memory and invalidates when the icon component file changes
