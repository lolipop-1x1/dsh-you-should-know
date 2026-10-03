import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { defaults, type Settings } from '../core/config.js'

export type Config = Volatile<Settings>
export const Config = Schema.object({
  enabled: Schema.boolean().default(defaults.enabled).description('自动观察'),
  language: Schema.union(['auto', 'zh-CN', 'en-US']).default(defaults.language).description('语言：跟随系统、中文或 English'),
  modelMode: Schema.union(['follow', 'custom']).default('follow').description('观察模型：跟随主会话或独立选择'),
  provider: Schema.string().default('').description('独立观察模型的提供方'),
  model: Schema.string().default('').description('独立观察模型的模型标识'),
  checkEvery: Schema.number().min(1).step(1).default(6).description('每隔多少步骤索引检查一次'),
  pollIntervalMs: Schema.number().min(500).max(10_000).step(1).default(2000).description('客户端状态刷新间隔（毫秒）'),
  presenceLeaseMs: Schema.number().min(20_000).max(120_000).step(1).default(20_000).description('客户端可展示状态的租期（毫秒）'),
}).volatile()
