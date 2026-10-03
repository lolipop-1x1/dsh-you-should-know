export type Language = 'zh-CN' | 'en-US'
export interface Settings {
  enabled: boolean
  language: 'auto' | Language
  modelMode: 'follow' | 'custom'
  provider: string
  model: string
  checkEvery: number
  maxChecksPerTurn: number
  pollIntervalMs: number
  presenceLeaseMs: number
}
export const defaults: Settings = {
  enabled: true, language: 'auto', modelMode: 'follow', provider: '', model: '', checkEvery: 6,
  maxChecksPerTurn: 0, pollIntervalMs: 2000, presenceLeaseMs: 20_000,
}

export function languageOf(setting: Settings['language'] = 'auto', locale = 'en-US'): Language {
  return setting === 'auto' ? /^zh(?:-|$)/iu.test(locale) ? 'zh-CN' : 'en-US' : setting
}
