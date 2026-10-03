export interface Settings {
  enabled: boolean
  modelMode: 'follow' | 'custom'
  provider: string
  model: string
  checkEvery: number
  pollIntervalMs: number
  presenceLeaseMs: number
}
export const defaults: Settings = {
  enabled: false, modelMode: 'follow', provider: '', model: '', checkEvery: 6,
  pollIntervalMs: 2000, presenceLeaseMs: 20_000,
}
