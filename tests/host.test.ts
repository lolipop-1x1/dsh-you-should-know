import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { defaults, type Settings } from '../src/core/config.js'
import { emptyState } from '../src/core/state.js'
import { apply } from '../src/host/index.js'

async function fixture(pending = false, settings: Partial<Settings> = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  let state = emptyState()
  const close = vi.fn(async () => {})
  ctx.provide('storageDomain', { open: async () => ({
    global: { get: () => state, set: async next => { state = structuredClone(next) } }, close,
  }) } as never)
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  ctx.provide('connection', { fetch: { register: value => { routes.set(value.path, value.fetch); return () => routes.delete(value.path) } } } as never)
  const agents = await Promise.all(['main', 'child'].map(async id => {
    const initial = Session.create(SessionId(id))
    const session = id === 'child' ? Session.create(initial.id, [], { ...initial.header, origin: 'subagent' }) : initial
    const agent = { id: session.id, session, ctx, options: {}, status: 'idle', inbox: {},
      send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
      runMaintenance: task => task(new AbortController().signal), whenIdle: async () => {},
    } as Agent
    await ctx.agents.register(agent)
    return agent
  }))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const requests: { observer: boolean; initiator?: string }[] = []
  const prompts: string[] = []
  class Adapter extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const observer = options.messages.length > 1
      requests.push({ observer, initiator: ctx.agents.currentInitiator()?.id })
      if (observer) prompts.push(options.messages.at(-1)!.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
      if (observer && pending) await gate
      yield { type: 'text-delta', index: 0, text: observer ? 'learn: A useful host observation.\nexplain: A relevant consequence.' : 'done' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['test'], new Adapter())
  const fiber = await ctx.plugin({ name: 'ysk-test', inject: ['llm', 'agents', 'storageDomain'],
    apply: child => apply(child, { get: () => ({ ...defaults, enabled: true, ...settings }) } as never),
  })
  const api = async (input: unknown, headers = { 'content-type': 'application/json' }, path = '/api/you-should-know') => routes.get(path)!(new Request(`http://host${path}`, {
    method: 'POST', headers, body: typeof input === 'string' ? input : JSON.stringify(input),
  }))
  const read = async () => (await api({ sessionId: 'main' })).json()
  const topics = async (input: unknown = { action: 'read' }) => api(input, { 'content-type': 'application/json' }, '/api/you-should-know/topics')
  const flush = async () => { await read(); await new Promise(resolve => setTimeout(resolve, 0)); await read() }
  const run = async (agent: Agent, step: number) => {
    const event = agent.session.append('step/start', { turn: 1, step })
    ctx.emit('session/event', agent.session, event)
    if (!agent.session.deriveMessages().length) {
      const message = createUserMessage({ content: [{ type: 'text', text: 'test task' }], source: { kind: 'user' } })
      const event = agent.session.append('user/message', message, { surfaceOp: 'append' })
      ctx.emit('session/event', agent.session, event)
    }
    // 模拟由另一份 SDK 标记的 LOOP，请求无本模块标记，但共享宿主会话消息身份。
    const options = Object.freeze({ provider: 'test', model: 'test', sessionId: agent.id,
      messages: Object.freeze(agent.session.deriveMessages()),
    }) as GenerateOptions
    await ctx.agents.withInitiator(agent, async () => { for await (const _ of ctx.llm.stream(options)) {} })
  }
  return { ctx, fiber, agents, api, topics, read, run, requests, prompts, release, flush, close, state: () => state }
}

describe('Host 原生事件和接口', () => {
  it('全局主题接口不依赖当前会话；分别清空并保留当前提醒', async () => {
    const f = await fixture()
    expect(await (await f.topics()).json()).toEqual({ seen: [], known: [] })
    await f.api({ sessionId: 'main', clientId: 'browser', visible: true })
    await f.run(f.agents[0]!, 7)
    await f.flush()
    const view = (await f.read()).view
    expect(await (await f.topics()).json()).toEqual({ seen: [view.line], known: [] })
    expect(await (await f.topics({ action: 'clear', list: 'seen' })).json()).toEqual({ seen: [], known: [] })
    expect((await f.read()).view.id).toBe(view.id)
    await f.api({ sessionId: 'main', viewId: view.id, action: 'known' })
    expect(await (await f.topics()).json()).toEqual({ seen: [], known: [view.line] })
    expect(await (await f.topics({ action: 'clear', list: 'known' })).json()).toEqual({ seen: [], known: [] })
  })
  it.each([
    {}, { action: 'clear' }, { action: 'clear', list: 'all' },
    { action: 'read', list: 'seen' }, { action: 'clear', list: 'seen', extra: true },
  ])('主题接口拒绝无效或含多余字段的操作 %j', async input => {
    const f = await fixture()
    expect((await f.topics(input)).status).toBe(400)
  })
  it('主循环七步触发，旁路清除发起者，慢观察不阻塞且不递归', async () => {
    const f = await fixture(true)
    await f.api({ sessionId: 'main', clientId: 'browser', visible: true })
    await f.run(f.agents[0]!, 1)
    await f.run(f.agents[0]!, 6)
    await f.flush()
    expect(f.requests.filter(request => request.observer)).toHaveLength(0)
    await f.run(f.agents[0]!, 7)
    await f.flush()
    expect(f.requests.filter(request => request.observer)).toEqual([{ observer: true, initiator: undefined }])
    expect((await f.read()).view).toBeUndefined()
    f.release()
    await f.flush()
    expect((await f.read()).view?.kind).toBe('offer')
    expect(f.requests.filter(request => request.observer)).toHaveLength(1)
  })
  it('子会话不观察，卸载撤回接口并关闭存储域', async () => {
    const f = await fixture()
    await f.api({ sessionId: 'child', clientId: 'browser', visible: true })
    await f.run(f.agents[1]!, 7)
    await f.flush()
    expect(f.requests.filter(request => request.observer)).toHaveLength(0)
    await f.fiber.dispose()
    expect(f.close).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['{', 400],
    [{ sessionId: 'main', unknown: true }, 400],
    [{ sessionId: 'main', action: 'invalid' }, 400],
    [{ sessionId: 'x'.repeat(257) }, 400],
    [{ sessionId: 'missing' }, 404],
    [{ sessionId: 'main', action: 'known' }, 400],
    [{ sessionId: 'main', locale: '' }, 400],
    [{ sessionId: 'main', locale: 'x'.repeat(65) }, 400],
    [{ sessionId: 'main', locale: 123 }, 400],
  ])('拒绝非法请求 %j', async (input, status) => {
    const f = await fixture()
    expect((await f.api(input)).status).toBe(status)
    expect(f.state().seen).toEqual([])
  })
  it.each([
    ['auto', 'zh-CN', 'zh-CN', '使用简体中文'],
    ['auto', 'en-US', 'en-US', 'Write in English.'],
    ['en-US', 'zh-CN', 'en-US', 'Write in English.'],
    ['zh-CN', 'en-US', 'zh-CN', '使用简体中文'],
  ] as const)('原生接口传递语言：设置 %s，客户端 %s，结果 %s', async (language, locale, expected, prompt) => {
    const f = await fixture(false, { language })
    expect((await f.api({ sessionId: 'main', clientId: 'browser', visible: true, locale })).status).toBe(200)
    await f.run(f.agents[0]!, 7)
    await f.flush()
    expect(f.prompts[0]).toContain(prompt)
    expect((await f.read()).view?.language).toBe(expected)
  })
  it('过期提醒ID返回 accepted false，不清空当前提醒', async () => {
    const f = await fixture()
    await f.api({ sessionId: 'main', clientId: 'browser', visible: true })
    await f.run(f.agents[0]!, 7)
    await f.flush()
    const view = (await f.read()).view
    const response = await f.api({ sessionId: 'main', action: 'known', viewId: 'stale' })
    expect(await response.json()).toMatchObject({ accepted: false, view: { id: view.id } })
  })
  it('错误内容类型和过大请求返回客户端错误', async () => {
    const f = await fixture()
    expect((await f.api({ sessionId: 'main' }, {})).status).toBe(415)
    expect((await f.api(JSON.stringify({ sessionId: 'main', padding: 'x'.repeat(8192) }))).status).toBe(413)
  })
  it('新轮次没有用户消息时，不把上轮的输入计入新提醒忽略次数', async () => {
    const f = await fixture()
    await f.api({ sessionId: 'main', clientId: 'browser', visible: true })
    await f.run(f.agents[0]!, 7)
    await f.flush()
    const session = f.agents[0]!.session
    const next = session.append('step/start', { turn: 2, step: 1 })
    f.ctx.emit('session/event', session, next)
    expect((await f.read()).view?.promptsSurvived).toBe(0)
    const input = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'new user message' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    f.ctx.emit('session/event', session, input)
    expect((await f.read()).view?.promptsSurvived).toBe(1)
  })
})
