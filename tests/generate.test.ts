import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { defaults } from '../src/core/config.js'
import { generate } from '../src/host/generate.js'

class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('forbidden'), name: 'read_file', arguments: '{"path":"private"}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'text-delta', index: 0, text: 'learn: A useful observation.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
describe('Harness 原生模型调用', () => {
  async function fixture(chunks: StreamChunk[][]) {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(LlmRuntime)
    const execute = vi.fn()
    ctx.provide('tools', { execute } as never)
    const requests: GenerateOptions[] = []
    class Scripted extends LlmAdapter {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push({ ...options, messages: structuredClone(options.messages) })
        yield* chunks[requests.length - 1] ?? []
      }
    }
    ctx.llm.registerAdapter(['main', 'custom'], new Scripted())
    const snapshot: GenerateOptions = { provider: 'main', model: 'main', messages: [{ role: 'user', content: [{ type: 'text', text: 'task' }] }],
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }],
    }
    return { ctx, snapshot, requests, execute }
  }
  it('多工具调用逐一拒绝，第二次仍调用工具时停止且从不执行', async () => {
    const calls: StreamChunk[] = ['first', 'second'].map((id, index) => ({ type: 'block-end', index,
      block: { type: 'tool-call', id: ToolCallId(id), name: 'read_file', arguments: '{}' },
    }))
    calls.push({ type: 'finish', reason: { kind: 'tool-calls' } })
    const f = await fixture([calls, calls])
    await expect(generate(f.ctx, f.snapshot, 'observe', defaults, new AbortController().signal)).rejects.toThrow('两次生成')
    expect(f.requests).toHaveLength(2)
    const denials = f.requests[1]!.messages.filter(message => message.role === 'tool')
    expect(denials).toHaveLength(2)
    expect(denials.map(message => message.role === 'tool' && message.isError)).toEqual([true, true])
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.snapshot.messages).toHaveLength(1)
  })
  it('汇总两次回答中的文本，第二次仍请求工具也不丢弃已有文本', async () => {
    const call: StreamChunk = { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('denied'), name: 'read_file', arguments: '{}' } }
    const first: StreamChunk[] = [{ type: 'text-delta', index: 0, text: 'learn: A useful observation.' }, call, { type: 'finish', reason: { kind: 'tool-calls' } }]
    const second: StreamChunk[] = [{ type: 'text-delta', index: 0, text: 'explain: An important consequence.' }, call, { type: 'finish', reason: { kind: 'tool-calls' } }]
    const f = await fixture([first, second])
    expect(await generate(f.ctx, f.snapshot, 'observe', defaults, new AbortController().signal)).toBe('learn: A useful observation.\nexplain: An important consequence.')
    expect(f.requests).toHaveLength(2)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('独立模型切换保留消息和工具前缀，移除不适用的主模型参数', async () => {
    const f = await fixture([[{ type: 'text-delta', index: 0, text: 'learn: none' }, { type: 'finish', reason: { kind: 'stop' } }]])
    Object.assign(f.snapshot, { reasoningEffort: 'default', temperature: 0.2, maxTokens: 1000, stop: ['stop'] })
    await generate(f.ctx, f.snapshot, 'observe', { ...defaults, modelMode: 'custom', provider: 'custom', model: 'other' }, new AbortController().signal)
    expect(f.requests[0]).toMatchObject({ provider: 'custom', model: 'other', tools: f.snapshot.tools })
    for (const key of ['reasoningEffort', 'temperature', 'maxTokens', 'stop']) expect(f.requests[0]).not.toHaveProperty(key)
    expect(f.requests[0]?.messages[0]).toEqual(f.snapshot.messages[0])
    expect(f.snapshot.provider).toBe('main')
  })
  it('截断回答不接受为有效提醒，预先取消的请求不调用适配器', async () => {
    const f = await fixture([[{ type: 'text-delta', index: 0, text: 'learn: Incomplete' }, { type: 'finish', reason: { kind: 'max-tokens' } }]])
    await expect(generate(f.ctx, f.snapshot, 'observe', defaults, new AbortController().signal)).rejects.toThrow('未正常完成')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(generate(f.ctx, f.snapshot, 'observe', defaults, controller.signal)).rejects.toThrow('cancelled')
    expect(f.requests).toHaveLength(1)
  })
  it('保留完整请求前缀，同模型生成，最多两次且所有工具只收到拒绝结果', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(LlmRuntime)
    const adapter = new Adapter()
    ctx.llm.registerAdapter(['main'], adapter)
    const messages: GenerateOptions['messages'] = [{ role: 'user', content: [{ type: 'text', text: 'original task' }] }]
    const snapshot: GenerateOptions = { provider: 'main', model: 'same-model', system: 'same system', messages,
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }] }
    const result = await generate(ctx, snapshot, 'observe only', defaults, new AbortController().signal)
    expect(result).toBe('learn: A useful observation.')
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]?.provider).toBe('main')
    expect(adapter.requests[0]?.model).toBe('same-model')
    expect(adapter.requests[0]?.system).toBe('same system')
    expect(adapter.requests[0]?.messages[0]?.content).toEqual(messages[0]?.content)
    expect(snapshot.messages).toHaveLength(1)
    const denial = adapter.requests[1]?.messages.find(message => message.role === 'tool')
    expect(denial?.role).toBe('tool')
    expect(denial && 'isError' in denial ? denial.isError : false).toBe(true)
  })
})
