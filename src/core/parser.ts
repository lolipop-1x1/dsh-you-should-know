export type Proposal = { kind: 'none' } | { kind: 'invalid' }
  | { kind: 'line'; line: string; tag: 'You should know' | 'Heads up'; explanation?: string }

const plain = (text: string) => text.replace(/\*\*|__/gu, '').replace(/^\s*>\s?/u, '').trim()
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
  const start = lines.findIndex(line => /^learn\s*:/iu.test(line))
  if (start < 0) return { kind: 'invalid' }
  const explain = lines.findIndex((line, index) => index > start && /^explain:/iu.test(line))
  const header = explain < 0 ? lines : lines.slice(0, explain)
  let line = header[start]!.replace(/^learn\s*:\s*/iu, '')
  if (!unquote(line) || /^none\s*(?:[.!?()[\]:;,-]|$)/iu.test(unquote(line))) return { kind: 'none' }
  const tagLine = header.find(value => /^tag\s*[:—–-]/iu.test(value))
  for (const continuation of header.slice(start + 1)) {
    if (!continuation || /^(learn|tag)\s*:/iu.test(continuation) || /\?["'”’`]?$/u.test(line)) break
    line += ` ${continuation}`
  }
  const inlineTag = /[.\s—–-]*tag\s*:\s*(heads[\s-]*up|you should know)\W*$/iu.exec(line)
  if (inlineTag) line = line.slice(0, inlineTag.index)
  line = unquote(line)
  if (!line || /^none\s*(?:[.!?()[\]:;,-]|$)/iu.test(line)) return { kind: 'none' }
  if (!/[.!?…]["'”’`)\]]*$/u.test(line)) line += '.'
  if (line.length > 240) return { kind: 'invalid' }
  const tag = /heads[\s-]*up/iu.test(tagLine ?? inlineTag?.[1] ?? '') ? 'Heads up' : 'You should know'
  const explanation = explain < 0 ? undefined
    : [lines[explain]!.replace(/^explain:\s*/iu, ''), ...text.split('\n').slice(explain + 1)].join('\n').trim() || undefined
  return { kind: 'line', line, tag, ...(explanation ? { explanation } : {}) }
}

export interface ExplanationBlock { title: string; lead: string; sketch: string[]; caption: string }
export function parseExplanation(text: string): ExplanationBlock[] {
  const blocks: ExplanationBlock[] = []
  let block: ExplanationBlock = { title: '', lead: '', sketch: [], caption: '' }
  let code = false
  let hadCode = false
  const flush = () => {
    if (block.title || block.lead.trim() || block.sketch.length || block.caption.trim()) {
      blocks.push({ ...block, lead: block.lead.trim().slice(0, 4000), caption: block.caption.trim().slice(0, 4000) })
    }
    block = { title: '', lead: '', sketch: [], caption: '' }
    hadCode = false
  }
  for (const line of text.split('\n')) {
    if (/^\s*```/u.test(line)) {
      if (!code && hadCode) flush()
      code = !code
      hadCode = true
    } else if (code) {
      if (block.sketch.length < 12) block.sketch.push(line.slice(0, 120))
    } else if (/^\s*#{1,6}\s+/u.test(line)) {
      flush()
      block.title = line.replace(/^\s*#{1,6}\s+/u, '').slice(0, 120)
    } else if (hadCode) block.caption += `${line}\n`
    else block.lead += `${line}\n`
  }
  flush()
  return blocks.slice(0, 4)
}
