import { isAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

export function isMainRequest(options: GenerateOptions, session: Session, initiatorId?: string): boolean {
  if (isAgentLoopRequest(options)) return true
  // 链接安装可能加载另一份 SDK，WeakSet 标记不共享；核对宿主发起者和 LOOP 冻结的完整消息身份。
  // 旁路请求追加了观察提示且未冻结，不会通过这条检查。
  if (initiatorId !== session.id || !Object.isFrozen(options) || !Object.isFrozen(options.messages)) return false
  const messages = session.deriveMessages()
  return messages.length > 0 && messages.length === options.messages.length
    && messages.every((message, index) => message === options.messages[index])
}
