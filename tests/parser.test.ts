import { describe, expect, it } from 'vitest'
import { parseProposal } from '../src/core/parser.js'

describe('提醒协议边界', () => {
  it.each(['none-based retries require a guard', 'none-of-these guarantees apply'])('普通内容 %s 不应当成为 none 协议', line => {
    expect(parseProposal(`learn: ${line}`)).toMatchObject({ kind: 'line', line: `${line}.` })
  })
  it('支持 learn 字段后的续行内容', () => {
    expect(parseProposal('learn:\n消息可能重复投递\ntag: Heads up\nexplain: 应以业务ID去重。')).toEqual({
      kind: 'line', line: '消息可能重复投递.', tag: 'Heads up', explanation: '应以业务ID去重。',
    })
  })
  it.each(['none', 'NONE.', 'none. No useful issue.', '"none"', ''])('不展示明确的 none 或空内容 %s', line => {
    expect(parseProposal(`learn: ${line}\ntag: Heads up`)).toEqual({ kind: 'none' })
  })
  it('接受 CRLF、引用、Markdown、行内分类和精确字符边界', () => {
    expect(parseProposal('> **learn:** 缓存更新有延迟. tag: Heads up\r\n> **explain:** 更新后旧值可能仍可见。')).toMatchObject({
      kind: 'line', line: '缓存更新有延迟.', tag: 'Heads up', explanation: '更新后旧值可能仍可见。',
    })
    expect(parseProposal(`learn: ${'x'.repeat(239)}`)).toMatchObject({ kind: 'line' })
    expect(parseProposal(`learn: ${'x'.repeat(240)}`)).toEqual({ kind: 'invalid' })
  })
  it.each(['。', '！', '？'])('中文结束标点 %s 不重复追加句点', end => {
    expect(parseProposal(`learn: 缓存更新有延迟${end}`)).toMatchObject({ kind: 'line', line: `缓存更新有延迟${end}` })
  })
})
