import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 开源仓库的锁文件必须能在没有本机或公司网络配置的环境中安装。
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
for (const [name, value] of Object.entries(lock.packages)) {
  if (!value.resolved) continue
  const url = new URL(value.resolved)
  assert.ok(url.protocol === 'https:' && url.host === 'registry.npmjs.org', `${name} 的下载地址必须使用公共 npm 源`)
}
