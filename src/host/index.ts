import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { emptyState, stateSchema } from '../core/state.js'
import { Engine } from './engine.js'
import { generate } from './generate.js'
import { isMainRequest } from './request.js'
import type { Config as LiveConfig } from './config.js'
export { Config } from './config.js'

export const name = 'you-should-know'
export const inject = ['llm', 'agents', 'storageDomain']
const spec = defineDomain({
  name: 'you_should_know', version: 1, tables: {},
  global: { schema: stateSchema, initial: emptyState() },
})
const requestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  clientId: z.string().min(1).max(128).optional(),
  visible: z.boolean().optional(),
  locale: z.string().min(1).max(64).optional(),
  viewId: z.string().max(128).optional(),
  action: z.enum(['expand', 'known', 'dismiss', 'helpful', 'irrelevant', 'unclear', 'chat', 'chat-confirm']).optional(),
}).strict()
const topicsRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('clear'), list: z.enum(['seen', 'known']) }).strict(),
])

class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new RequestError('请使用 JSON 请求。', 415)
  }
  const reader = request.body?.getReader()
  if (!reader) throw new RequestError('请求缺少内容。')
  let text = ''
  let size = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) { await reader.cancel(); throw new RequestError('请求过大。', 413) }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { reader.releaseLock() }
}

export async function apply(ctx: Context, config: LiveConfig): Promise<void> {
  const initial = config.get()
  if (initial.modelMode === 'custom' && (!initial.provider || !initial.model)) throw new Error('独立观察模型必须同时配置提供方和模型。')
  const domain = await ctx.storageDomain.open(spec)
  const engine = new Engine(domain.global.get(), {
    settings: () => config.get(), save: state => domain.global.set(state), now: Date.now,
    generate: (snapshot, prompt, settings, signal) => ctx.agents.withoutInitiator(() => generate(ctx, snapshot, prompt, settings, signal)),
    error: () => console.warn('[You Should Know] 观察或状态保存失败，请检查模型与存储配置。'),
  })
  ctx.effect(() => async () => { await engine.dispose(); await domain.close() })
  const frames = new Map<string, { turn: number; step: number }>()
  ctx.on('session/event', (session, event) => {
    const id = session.id
    if (session.header.origin === 'subagent') return
    // LOOP 在步骤开始后提交用户消息，按消息事件计数，避免把上轮输入算到新提醒上。
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      engine.beginTurn(id, frames.get(id)?.turn ?? 0, 1, false)
    }
    if (event.type === 'step/start') {
      frames.set(id, event.data)
      if (event.data.step === 1) {
        engine.beginTurn(id, event.data.turn, 0)
      }
    }
  })
  ctx.on('llm/stream', (options, next) => {
    const id = options.sessionId
    const frame = id ? frames.get(id) : undefined
    const session = id ? ctx.agents.get(SessionId(id))?.session : undefined
    if (id && frame && session && session.header.origin !== 'subagent'
      && isMainRequest(options, session, ctx.agents.currentInitiator()?.id)) {
      engine.capture(id, frame.turn, frame.step, options)
    }
    return next()
  })
  ctx.on('session/disposed', session => {
    frames.delete(session.id)
    engine.endSession(session.id)
  })
  ctx.inject(['connection'], child => {
    child.connection.fetch.register({
      path: '/api/you-should-know/topics', methods: ['POST'], requestBody: 'streaming',
      fetch: async request => {
        try {
          const input = topicsRequestSchema.parse(await body(request))
          const topics = input.action === 'clear' ? await engine.clearTopics(input.list) : await engine.topics()
          return Response.json(topics, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status })
          if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: '请求字段无效。' }, { status: 400 })
          return Response.json({ error: '无法处理主题记录请求。' }, { status: 500 })
        }
      },
    })
    child.connection.fetch.register({
      path: '/api/you-should-know', methods: ['POST'], requestBody: 'streaming',
      fetch: async request => {
        try {
          const input = requestSchema.parse(await body(request))
          if (!ctx.agents.get(SessionId(input.sessionId))) return Response.json({ error: '会话不存在。' }, { status: 404 })
          if (input.clientId && input.visible !== undefined) engine.presenceUpdate(input.sessionId, input.clientId, input.visible, input.locale)
          let accepted: boolean | undefined
          if (input.action) {
            if (!input.viewId) return Response.json({ error: '请求缺少提醒标识。' }, { status: 400 })
            accepted = await engine.action(input.sessionId, input.viewId, input.action)
          }
          return Response.json({ ...await engine.read(input.sessionId), accepted }, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status })
          if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: '请求字段无效。' }, { status: 400 })
          return Response.json({ error: '无法处理提醒请求。' }, { status: 500 })
        }
      },
    })
  })
}
