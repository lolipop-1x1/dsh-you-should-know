import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createAssistantMessage, createToolResultMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Settings } from '../core/config.js'

/** 保留主请求前缀，观察响应和工具拒绝结果只存在于本次旁路调用。 */
export async function generate(ctx: Context, snapshot: GenerateOptions, prompt: string, settings: Settings, signal: AbortSignal): Promise<string> {
  const options: GenerateOptions = {
    ...snapshot,
    messages: [...snapshot.messages, { role: 'user', content: [{ type: 'text', text: prompt }] }],
    signal,
  }
  if (settings.modelMode === 'custom') {
    if (!settings.provider || !settings.model) throw new Error('请先选择独立观察模型的提供方和模型。')
    options.provider = settings.provider
    options.model = settings.model
    delete options.reasoningEffort
    delete options.temperature
    delete options.maxTokens
    delete options.stop
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted()
    const result = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) {
      signal.throwIfAborted()
      result.push(chunk)
    }
    if (result.finish?.kind !== 'stop' && result.finish?.kind !== 'tool-calls') {
      throw new Error('观察模型未正常完成回答。')
    }
    const blocks = result.blocks()
    const calls = blocks.filter(block => block.type === 'tool-call')
    if (!calls.length) return blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
    options.messages.push(createAssistantMessage({
      content: blocks, source: { provider: options.provider, model: options.model, replayState: result.replayState },
    }))
    // 工具声明可以复用前缀，但任何工具请求都只获得拒绝结果，绝不交给工具服务。
    for (const call of calls) options.messages.push(createToolResultMessage({
      callId: call.id, isError: true,
      content: [{ type: 'text', text: '观察者禁止使用工具。请只根据已有上下文给出文字回答。' }],
    }))
  }
  throw new Error('观察模型在两次生成内没有给出文字回答。')
}
