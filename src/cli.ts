#!/usr/bin/env node

import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'

import {run_lucide_sprite_codemod} from './codemod.js'

const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)

function print_help() {
    console.log(`vite-plugin-lucide-sprite codemod

Usage:
  vite-plugin-lucide-sprite [--dry-run] [--force] [--no-install] [--source-dir <dir>] [--icon-component-path <path>]

Options:
  --dry-run   Print planned changes without writing files
  --force     Run even if the git working tree is dirty
  --no-install  Skip dependency installation step
  --source-dir  Source directory to scan (default: ./src; required if missing)
  --icon-component-path  Path to create/use Icon.svelte
  -h, --help  Show this help
`)
}

function get_self_version(): string {
    const pkg_path = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkg_path, 'utf8')) as {version?: string}
    return pkg.version || 'latest'
}

function detect_package_manager(root_dir: string): {command: string; add_args: string[]} {
    if (existsSync(path.join(root_dir, 'pnpm-lock.yaml'))) return {command: 'pnpm', add_args: ['add', '-D']}
    if (existsSync(path.join(root_dir, 'yarn.lock'))) return {command: 'yarn', add_args: ['add', '-D']}
    if (existsSync(path.join(root_dir, 'bun.lockb')) || existsSync(path.join(root_dir, 'bun.lock'))) {
        return {command: 'bun', add_args: ['add', '-d']}
    }
    return {command: 'npm', add_args: ['install', '-D']}
}

function get_missing_dependencies(root_dir: string): string[] {
    const pkg_path = path.join(root_dir, 'package.json')
    if (!existsSync(pkg_path)) return []
    const pkg = JSON.parse(readFileSync(pkg_path, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
    }
    const dependencies = pkg.dependencies ?? {}
    const dev_dependencies = pkg.devDependencies ?? {}
    const has = (name: string) => !!dependencies[name] || !!dev_dependencies[name]
    const missing: string[] = []
    if (!has('vite-plugin-lucide-sprite')) missing.push(`vite-plugin-lucide-sprite@^${get_self_version()}`)
    if (!has('lucide-static')) missing.push('lucide-static@latest')
    return missing
}

function install_missing_dependencies(root_dir: string, dry_run: boolean): void {
    const missing = get_missing_dependencies(root_dir)
    if (missing.length === 0) return
    if (dry_run) {
        console.log(`Would install dependencies: ${missing.join(', ')}`)
        return
    }
    const {command, add_args} = detect_package_manager(root_dir)
    execFileSync(command, [...add_args, ...missing], {cwd: root_dir, stdio: 'inherit'})
}

function ensure_clean_worktree(force: boolean) {
    if (force) return

    try {
        const status = execFileSync('git', ['status', '--porcelain'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        if (status.length > 0) {
            throw new Error('Uncommitted changes detected. Commit/stash first, or rerun with --force.')
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

    const supported = new Set([
        '--dry-run',
        '--force',
        '--no-install',
        '--source-dir',
        '--icon-component-path',
        '-h',
        '--help',
    ])
    const unknown = args.filter(arg => arg.startsWith('-') && !supported.has(arg))
    if (unknown.length > 0) {
        throw new Error(`Unknown option(s): ${unknown.join(', ')}`)
    }

    const read_option = (flag: string): string | undefined => {
        const index = args.indexOf(flag)
        if (index === -1) return undefined
        const value = args[index + 1]
        if (!value || value.startsWith('-')) throw new Error(`Missing value for ${flag}`)
        return value
    }
    const source_dir = read_option('--source-dir')
    const icon_component_path = read_option('--icon-component-path')

    ensure_clean_worktree(has('--force'))

    const dry_run = has('--dry-run')
    const result = run_lucide_sprite_codemod({dry_run, source_dir, icon_component_path})

    if (result.changed_files.length === 0) {
        console.log('No changes needed.')
    } else {
        console.log(`${result.dry_run ? 'Would update' : 'Updated'} ${result.changed_files.length} file(s):`)
        for (const file of result.changed_files) console.log(`- ${file}`)
    }

    if (!has('--no-install')) install_missing_dependencies(process.cwd(), dry_run)
}

try {
    main()
} catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
}
