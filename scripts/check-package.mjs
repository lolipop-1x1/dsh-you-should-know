import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { boot, evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
assert.equal(evaluatePluginCompatibility(manifest, {}, getDshRuntimeVersion()), undefined, '安装包必须兼容验证所用的 SDK')
const client = await readFile('dist/client.js', 'utf8')
let registration
vm.runInNewContext(client, { window: { __ModuleLoader__: { load: value => { registration = value } } } })
assert.equal(registration.id, 'dsh-you-should-know')
const react = await import('react')
const jsx = await import('react/jsx-runtime')
const exports = registration.factory(name => {
  if (name === 'react') return react
  if (name === 'react/jsx-runtime') return jsx
  throw new Error(`客户端引用了非宿主模块：${name}`)
})
assert.equal(typeof exports.apply, 'function')
const host = await import('../dist/host/index.js')
assert.equal(typeof host.apply, 'function')
assert.ok(host.Config['~standard'])
// 使用真实 Loader、配置 schema 和存储后端组装，不启动 Web 服务或调用模型。
const root = await mkdtemp(join(tmpdir(), 'dsh-ysk-package-'))
const require = createRequire(import.meta.url)
let context
try {
  const path = join(root, 'cordis.yml')
  await writeFile(path, '[]\n')
  const modules = ['dsh-llm', 'dsh-agent', 'dsh-storage', 'dsh-storage-json', 'dsh-storage-domain']
  const entries = modules.map(id => ({ id, name: require.resolve(`@deepseek-ai/${id}`),
    ...(id === 'dsh-storage-json' ? { config: { root: join(root, 'storage') } } : {}),
    ...(id === 'dsh-storage-domain' ? { config: { backend: 'json' } } : {}),
  }))
  entries.push({ id: 'dsh-you-should-know', name: fileURLToPath(new URL('../dist/host/index.js', import.meta.url)) })
  context = await boot('ysk-package-check', path, [{ insert: entries }])
  assert.ok(context.storageDomain.get('you_should_know'), '插件必须实际打开自身存储域')
  await context.fiber.dispose()
  assert.equal(context.get('storageDomain'), undefined, '卸载应撤回存储域服务')
  console.log(`DSH ${getDshRuntimeVersion()} 的兼容检查、原生插件加载、卸载和客户端入口检查通过。`)
} finally {
  await context?.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
