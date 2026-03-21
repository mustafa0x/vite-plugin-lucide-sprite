#!/usr/bin/env node

import {run_lucide_sprite_codemod} from './codemod.js'

const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)

function print_help() {
    console.log(`vite-plugin-lucide-sprite codemod

Usage:
  vite-plugin-lucide-sprite [--dry-run]

Options:
  --dry-run   Print planned changes without writing files
  -h, --help  Show this help
`)
}

function main() {
    if (has('-h') || has('--help')) {
        print_help()
        return
    }

    const supported = new Set(['--dry-run', '-h', '--help'])
    const unknown = args.filter(arg => arg.startsWith('-') && !supported.has(arg))
    if (unknown.length > 0) {
        throw new Error(`Unknown option(s): ${unknown.join(', ')}`)
    }

    const result = run_lucide_sprite_codemod({dry_run: has('--dry-run')})

    if (result.changed_files.length === 0) {
        console.log('No changes needed.')
        return
    }

    console.log(`${result.dry_run ? 'Would update' : 'Updated'} ${result.changed_files.length} file(s):`)
    for (const file of result.changed_files) console.log(`- ${file}`)
}

main()
