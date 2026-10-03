import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
try { require.resolve('esbuild'); require.resolve('typescript') }
catch {
  const install = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--include=dev', '--ignore-scripts'], { stdio: 'inherit' })
  if (install.status !== 0) process.exit(install.status ?? 1)
}
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' })
process.exit(build.status ?? 1)
