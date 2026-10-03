import { readFileSync } from 'node:fs'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('Harness 安装兼容契约', () => {
  it.each(['0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1-alpha.1', '0.2.1', '0.2.9'])('允许范围内的 %s，无需版本豁免', version => {
    expect(evaluatePluginCompatibility(manifest, {}, version)).toBeUndefined()
  })
  it.each(['0.1.9', '0.2.0-rc.1', '0.3.0-alpha.1', '0.3.0', '1.0.0'])('拒绝最低版本之前或下一个主次版本 %s', version => {
    const issue = evaluatePluginCompatibility(manifest, {}, version)
    expect(issue?.exempted).toBe(false)
    expect(Object.keys(issue?.peers ?? {})).toHaveLength(5)
  })
})
