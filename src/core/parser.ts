export type Proposal = { kind: 'none' } | { kind: 'invalid' }
  | { kind: 'line'; line: string; tag: 'You should know' | 'Heads up'; explanation?: string }

const clean = (text: string) => text
  .replace(/(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c)/gu, '')
  .replace(/(?:\u001b[P^_X]|[\u0090\u0098\u009e\u009f])[\s\S]*?(?:\u001b\\|\u009c)/gu, '')
  .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu, '')
  .replace(/\u001b[ -/]*[@-Z\\-_]/gu, '')
  .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
const plain = (text: string) => clean(text).replace(/^\s*>\s?/u, '').trim()
  .replace(/^(\*\*|__)(learn\s*:|tag\s*[:—–-]|explain\s*:)\1/iu, '$2')
  .replace(/^(?:\*\*([\s\S]+)\*\*|__([\s\S]+)__)$/u, (_, bold, underline) => bold ?? underline)
const isNone = (text: string) => !text || /^none\s*(?:[.!?()[\]:;,-]|$)/iu.test(text)
const unquote = (text: string) => {
  const value = text.trim().replace(/\.+$/u, '')
  for (const [start, end] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['`', '`']]) {
    if (start && end && value.startsWith(start) && value.endsWith(end)
      && !value.slice(1, -1).includes(end)) return value.slice(1, -1).trim().replace(/\.+$/u, '')
  }
  return value
}

export function parseProposal(text: string): Proposal {
  const lines = text.split('\n').map(line => plain(line).replace(/^[-*•]\s+/u, ''))
  const first = lines.findIndex(line => /^learn\s*:/iu.test(line))
  if (first < 0) return { kind: 'invalid' }
  const explain = lines.findIndex((line, index) => index > first && /^explain:/iu.test(line))
  const header = explain < 0 ? lines : lines.slice(0, explain)
  const tagLine = header.find(value => /^tag\s*[:—–-]/iu.test(value))
  for (let start = first; start < header.length; start += 1) {
    if (!/^learn\s*:/iu.test(header[start]!)) continue
    let line = header[start]!.replace(/^learn\s*:\s*/iu, '')
    const inlineTag = /[.\s—–-]*tag\s*:\s*(heads[\s-]*up|you should know)\W*$/iu
    if (isNone(unquote(unquote(line).replace(inlineTag, '')))) return { kind: 'none' }
    for (const continuation of header.slice(start + 1)) {
      if (!continuation || /^(learn\s*:|tag\s*[:—–-])/iu.test(continuation) || /\?["'”’`]?$/u.test(line)) break
      line += ` ${continuation}`
    }
    const tagMatch = inlineTag.exec(unquote(line))
    line = unquote(line)
    if (tagMatch) line = unquote(line.slice(0, tagMatch.index))
    if (!/[.!?…。！？]["'”’`)\]]*$/u.test(line)) line += '.'
    if (line.length > 240) continue
    const tagValue = tagLine?.replace(/^tag\s*[:—–-]\s*/iu, '') ?? tagMatch?.[1] ?? ''
    const tag = /^\W*heads[\s-]*up\W*$/iu.test(tagValue) ? 'Heads up' : 'You should know'
    const explanation = explain < 0 ? undefined
      : [lines[explain]!.replace(/^explain:\s*/iu, ''), ...text.split('\n').slice(explain + 1)].join('\n').trim() || undefined
    return { kind: 'line', line, tag, ...(explanation ? { explanation } : {}) }
  }
  return { kind: 'invalid' }
}

export interface ExplanationBlock { title: string; lead: string; sketch: string[]; caption: string }
export function parseExplanation(text: string): ExplanationBlock[] {
  const blocks: ExplanationBlock[] = []
  let block: ExplanationBlock = { title: '', lead: '', sketch: [], caption: '' }
  let code = false
  let hadCode = false
  const crop = (value: string, max: number) => value.slice(0, max).replace(/[\uD800-\uDBFF]$/u, '')
  const paragraph = (value: string) => {
    const normalized = value.split('\n').map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean).join('\n')
    if (normalized.length <= 4000) return normalized
    const prefix = crop(normalized, 3999)
    const boundary = prefix.search(/\s\S*$/u)
    return `${boundary > 2000 ? prefix.slice(0, boundary) : prefix.trimEnd()}…`
  }
  const flush = () => {
    if (block.title || block.lead.trim() || block.sketch.length || block.caption.trim()) {
      blocks.push({ ...block, lead: paragraph(block.lead), caption: paragraph(block.caption) })
    }
    block = { title: '', lead: '', sketch: [], caption: '' }
    hadCode = false
  }
  for (const raw of text.split('\n')) {
    const line = clean(raw).trimEnd()
    if (/^\s*```/u.test(line)) {
      if (!code && hadCode) flush()
      code = !code
      hadCode = true
    } else if (code) {
      if (block.sketch.length < 12) block.sketch.push(crop(line, 120))
    } else if (/^\s*(?:\*\*[^*]+\*\*|#+\s*.+)\s*$/u.test(line)) {
      flush()
      block.title = crop(plain(line.replace(/^\s*#+\s*/u, '')), 120)
    } else if (hadCode) block.caption += `${line}\n`
    else block.lead += `${line}\n`
  }
  flush()
  return blocks.slice(0, 4)
}
