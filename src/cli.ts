#!/usr/bin/env node

import {execFileSync} from 'node:child_process'

import {run_lucide_sprite_codemod} from './codemod.js'

const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)

function print_help() {
    console.log(`vite-plugin-lucide-sprite codemod

Usage:
  vite-plugin-lucide-sprite [--dry-run] [--force]

Options:
  --dry-run   Print planned changes without writing files
  --force     Run even if the git working tree is dirty
  -h, --help  Show this help
`)
}

function ensure_clean_worktree(force: boolean) {
    if (force) return

    try {
        const status = execFileSync('git', ['status', '--porcelain'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        if (status.length > 0) {
            throw new Error('Working tree is dirty. Commit/stash changes or rerun with --force.')
        }
    } catch (error) {
        const is_not_git_repo =
            error instanceof Error &&
            (error.message.includes('not a git repository') ||
                error.message.includes('Command failed: git'))
        if (is_not_git_repo) return
        throw error
    }
}

function main() {
    if (has('-h') || has('--help')) {
        print_help()
        return
    }

    const supported = new Set(['--dry-run', '--force', '-h', '--help'])
    const unknown = args.filter(arg => arg.startsWith('-') && !supported.has(arg))
    if (unknown.length > 0) {
        throw new Error(`Unknown option(s): ${unknown.join(', ')}`)
    }

    ensure_clean_worktree(has('--force'))

    const result = run_lucide_sprite_codemod({dry_run: has('--dry-run')})

    if (result.changed_files.length === 0) {
        console.log('No changes needed.')
        return
    }

    console.log(`${result.dry_run ? 'Would update' : 'Updated'} ${result.changed_files.length} file(s):`)
    for (const file of result.changed_files) console.log(`- ${file}`)
}

main()
