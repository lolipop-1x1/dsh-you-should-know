import { describe, expect, it } from 'vitest'
import { parseExplanation, parseProposal } from '../src/core/parser.js'

describe('提醒协议边界', () => {
  it.each(['nonetheless retries require a guard', 'nonequivalent guarantees apply'])('普通内容 %s 不应当成为 none 协议', line => {
    expect(parseProposal(`learn: ${line}`)).toMatchObject({ kind: 'line', line: `${line}.` })
  })
  it('支持 learn 字段后的续行内容', () => {
    expect(parseProposal('learn: 消息可能\n重复投递\ntag: Heads up\nexplain: 应以业务ID去重。')).toEqual({
      kind: 'line', line: '消息可能 重复投递.', tag: 'Heads up', explanation: '应以业务ID去重。',
    })
  })
  it.each(['none', 'NONE.', 'none. No useful issue.', '"none"', ''])('不展示明确的 none 或空内容 %s', line => {
    expect(parseProposal(`learn: ${line}\ntag: Heads up`)).toEqual({ kind: 'none' })
  })
  it.each(['none:', 'none (nothing)', 'none-based advice', 'none; no topic', 'none, no topic', 'none-of-these'])('兼容 none 后的协议分隔符：%s', line => {
    expect(parseProposal(`learn: ${line}`)).toEqual({ kind: 'none' })
  })
  it('空 learn 优先判定为无提醒，不拼接后续文本', () => {
    expect(parseProposal('learn:\nUnexpected continuation.')).toEqual({ kind: 'none' })
  })
  it('首个候选超长时继续解析后续有效候选', () => {
    expect(parseProposal(`learn: ${'x'.repeat(241)}\n\nlearn: Valid second topic.\ntag: Heads up`)).toMatchObject({
      kind: 'line', line: 'Valid second topic.', tag: 'Heads up',
    })
  })
  it('粗体标题单独渲染，清除控制字符并保持示意代码', () => {
    expect(parseExplanation('**缓存影响**\n\u001b[31m旧值仍可见。\u001b[0m\n```\n旧值 -> 新值\n```\n刷新后生效。')).toEqual([
      { title: '缓存影响', lead: '旧值仍可见。', sketch: ['旧值 -> 新值'], caption: '刷新后生效。' },
    ])
  })
  it('保留代码标识符中的双下划线，只剥离协议的强调标记', () => {
    expect(parseProposal('**learn:** Python 的 __init__ 负责初始化。')).toMatchObject({
      kind: 'line', line: 'Python 的 __init__ 负责初始化。',
    })
    expect(parseExplanation('**初始化入口**\n```\n__init__()\n__LINE__\n```')[0]?.sketch).toEqual(['__init__()', '__LINE__'])
  })
  it.each(['\u009b31m风险\u009b0m', '\u001b]8;;https://example.test\u0007风险\u001b]8;;\u001b\\', '\u009d8;;https://example.test\u009c风险\u009d8;;\u009c'])('完整移除终端控制序列：%j', text => {
    expect(parseProposal(`learn: ${text}`)).toMatchObject({ kind: 'line', line: '风险.' })
    expect(parseExplanation(text)[0]?.lead).toBe('风险')
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
