import { build } from 'esbuild'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
const declarations = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.host.json', '--emitDeclarationOnly'], { stdio: 'inherit' })
if (declarations.status !== 0) process.exit(declarations.status ?? 1)
await build({ entryPoints: ['src/host/index.ts'], outfile: 'dist/host/index.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' })
const client = await build({ entryPoints: ['src/client/index.tsx'], bundle: true, platform: 'browser', format: 'cjs', external: ['react', 'react/jsx-runtime'], target: 'es2022', write: false })
await writeFile('dist/client.js', `window.__ModuleLoader__.load({ id: 'dsh-you-should-know', factory(require) { const module = { exports: {} }; const exports = module.exports;\n${client.outputFiles[0].text}\nreturn module.exports; } });\n`)
