import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
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
