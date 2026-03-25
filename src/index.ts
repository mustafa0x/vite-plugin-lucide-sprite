import type {Plugin} from 'vite'

import {create_sprite_plugin, type IconSetInput, type IconSpritePluginOptions as SharedOptions} from './shared.js'

export {run_lucide_sprite_codemod} from './codemod.js'
export type {IconSetInput}

export type IconSpritePluginOptions = SharedOptions

export default function icon_sprite_plugin(user: IconSpritePluginOptions = {}): Plugin {
    return create_sprite_plugin({
        name: 'icon_sprite',
        icon_component_path: user.icon_component_path ?? 'src/components/Icon.svelte',
        icon_ids_export_name: user.icon_ids_export_name ?? 'ICON_IDS',
        output_file_name: user.output_file_name ?? 'icons.svg',
        minify: user.minify ?? true,
        sets: user.sets ?? {le: 'lucide'},
    })
}

export {icon_sprite_plugin}
