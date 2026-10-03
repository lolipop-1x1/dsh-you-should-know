import { describe, expect, it } from 'vitest'
import { markAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { isMainRequest } from '../src/host/request.js'

describe('主请求身份', () => {
  const message = Object.freeze({ role: 'user' as const, content: [{ type: 'text' as const, text: 'task' }] })
  const session = { id: 's', deriveMessages: () => [message] } as Session
  const request = (): GenerateOptions => ({ provider: 'main', model: 'main', messages: [message] })

  it('识别当前 SDK 标记的 LOOP 请求', () => {
    expect(isMainRequest(markAgentLoopRequest(request()), session)).toBe(true)
  })

  it('另一份 SDK 的标记不可见时，冻结的完整会话消息仍能识别', () => {
    const foreignRequests = new WeakSet()
    const options = Object.freeze({ ...request(), messages: Object.freeze([message]) }) as GenerateOptions
    foreignRequests.add(options)
    expect(foreignRequests.has(options)).toBe(true)
    expect(isMainRequest(options, session, 's')).toBe(true)
    expect(isMainRequest(options, session)).toBe(false)
    expect(isMainRequest(options, session, 'other')).toBe(false)
  })

  it('拒绝旁路追加、非冻结请求和内容相同的消息副本', () => {
    expect(isMainRequest(request(), session)).toBe(false)
    expect(isMainRequest(Object.freeze({ ...request(), messages: [message] }), session)).toBe(false)
    const copied = Object.freeze({ ...request(), messages: Object.freeze([structuredClone(message)]) }) as GenerateOptions
    expect(isMainRequest(copied, session, 's')).toBe(false)
    const observer = Object.freeze({ ...request(), messages: Object.freeze([message, message]) }) as GenerateOptions
    expect(isMainRequest(observer, session, 's')).toBe(false)
  })
})
