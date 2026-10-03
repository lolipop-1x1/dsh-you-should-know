import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { emptyState, stateSchema } from '../core/state.js'
import { Engine } from './engine.js'
import { generate } from './generate.js'
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
  viewId: z.string().max(128).optional(),
  action: z.enum(['expand', 'known', 'dismiss', 'helpful', 'irrelevant', 'unclear', 'chat', 'chat-confirm']).optional(),
}).strict()

async function body(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('请使用 JSON 请求。')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('请求缺少内容。')
  let text = ''
  let size = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8192) { await reader.cancel(); throw new Error('请求过大。') }
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
    generate: (snapshot, prompt, settings, signal) => generate(ctx, snapshot, prompt, settings, signal),
    error: () => console.warn('[You Should Know] 观察或状态保存失败，请检查模型与存储配置。'),
  })
  ctx.effect(() => async () => { await engine.dispose(); await domain.close() })
  const frames = new Map<string, { turn: number; step: number }>()
  const inputs = new Map<string, number>()
  const primary = (id: string) => ctx.agents.get(SessionId(id))?.session.header.origin !== 'subagent'
  ctx.on('session/event', (session, event) => {
    const id = session.id
    if (session.header.origin === 'subagent') return
    if (event.type === 'user/message' && event.data.source.kind === 'user') inputs.set(id, (inputs.get(id) ?? 0) + 1)
    if (event.type === 'step/start') {
      frames.set(id, event.data)
      if (event.data.step === 1) {
        engine.beginTurn(id, event.data.turn, inputs.get(id) ?? 0)
        inputs.delete(id)
      }
    }
  })
  ctx.on('llm/stream', (options, next) => {
    const id = options.sessionId
    const frame = id ? frames.get(id) : undefined
    if (id && frame && isAgentLoopRequest(options) && primary(id)) engine.capture(id, frame.turn, frame.step, options)
    return next()
  })
  ctx.on('session/disposed', session => {
    frames.delete(session.id)
    inputs.delete(session.id)
    engine.endSession(session.id)
  })
  ctx.inject(['connection'], child => {
    child.connection.fetch.register({
      path: '/api/you-should-know', methods: ['POST'], requestBody: 'streaming',
      fetch: async request => {
        try {
          const input = requestSchema.parse(await body(request))
          if (!ctx.agents.get(SessionId(input.sessionId))) return Response.json({ error: '会话不存在。' }, { status: 404 })
          if (input.clientId && input.visible !== undefined) engine.presenceUpdate(input.sessionId, input.clientId, input.visible)
          let accepted: boolean | undefined
          if (input.action) {
            if (!input.viewId) return Response.json({ error: '请求缺少提醒标识。' }, { status: 400 })
            accepted = await engine.action(input.sessionId, input.viewId, input.action)
          }
          return Response.json({ ...await engine.read(input.sessionId), accepted }, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: '请求字段无效。' }, { status: 400 })
          return Response.json({ error: '无法处理提醒请求。' }, { status: 500 })
        }
      },
    })
  })
}
