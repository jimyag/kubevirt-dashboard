/** YAML syntax highlighting and line diffs for the manifest viewer and editor. */

export type YamlTokenKind = "key" | "string" | "literal" | "comment" | "punct"
export type YamlToken = { text: string; kind?: YamlTokenKind }

const literalPattern = /^(true|false|null|~|[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?|0x[0-9a-fA-F]+)$/
const keyPattern = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{[][^#]*?)(:)(?=\s|$)/
const blockPattern = /^[|>][-+]?\d*$/

/** Splits a plain or quoted value from a trailing " # comment". */
const valueTokens = (value: string): YamlToken[] => {
  if (!value) return []
  const quoted = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')(.*)$/.exec(value)
  if (quoted) return [{ text: quoted[1], kind: "string" }, ...commentTokens(quoted[2])]
  const hash = value.search(/\s#/)
  const body = hash >= 0 ? value.slice(0, hash) : value
  const rest = hash >= 0 ? value.slice(hash) : ""
  const trimmed = body.trimEnd()
  const trailing = body.slice(trimmed.length)
  let kind: YamlTokenKind = "string"
  if (literalPattern.test(trimmed)) kind = "literal"
  else if (trimmed === "{}" || trimmed === "[]" || blockPattern.test(trimmed)) kind = "punct"
  return [{ text: trimmed, kind }, ...(trailing ? [{ text: trailing }] : []), ...commentTokens(rest)]
}

const commentTokens = (text: string): YamlToken[] => {
  if (!text) return []
  const hash = text.indexOf("#")
  if (hash < 0) return [{ text }]
  return [...(hash > 0 ? [{ text: text.slice(0, hash) }] : []), { text: text.slice(hash), kind: "comment" as const }]
}

/** Tokens per line. Tracks block scalars (`key: |`) so their content reads as one string. */
export const highlightYaml = (source: string): YamlToken[][] => {
  const lines = source.split("\n")
  const result: YamlToken[][] = []
  let blockIndent = -1
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    if (blockIndent >= 0) {
      if (line.trim() === "" || indent > blockIndent) {
        result.push([{ text: line, kind: "string" }])
        continue
      }
      blockIndent = -1
    }
    const tokens: YamlToken[] = []
    const lead = /^(\s*)((?:- +)*)/.exec(line)!
    if (lead[1]) tokens.push({ text: lead[1] })
    if (lead[2]) tokens.push({ text: lead[2], kind: "punct" })
    let rest = line.slice(lead[0].length)
    const ownIndent = lead[0].length
    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "comment" })
      result.push(tokens)
      continue
    }
    const key = keyPattern.exec(rest)
    if (key) {
      tokens.push({ text: key[1], kind: "key" }, { text: key[2], kind: "punct" })
      rest = rest.slice(key[0].length)
      const space = /^\s*/.exec(rest)![0]
      if (space) tokens.push({ text: space })
      rest = rest.slice(space.length)
      if (blockPattern.test(rest.replace(/\s+#.*$/, "").trim())) blockIndent = ownIndent
    } else if (blockPattern.test(rest.trim())) {
      blockIndent = indent
    }
    tokens.push(...valueTokens(rest))
    result.push(tokens)
  }
  return result
}

export type DiffLine = { type: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number }

/** Line diff via LCS after trimming the common prefix and suffix, which keeps typical edits small. */
export const lineDiff = (before: string, after: string): DiffLine[] => {
  const a = before.split("\n")
  const b = after.split("\n")
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle: DiffLine[] = []
  if (midA.length * midB.length > 4_000_000) {
    // Too large to align line by line; show the changed block as removed then added.
    midA.forEach((text) => middle.push({ type: "del", text }))
    midB.forEach((text) => middle.push({ type: "add", text }))
  } else {
    const n = midA.length
    const m = midB.length
    const table = new Uint32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * (m + 1) + j] = midA[i] === midB[j] ? table[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        middle.push({ type: "same", text: midA[i] })
        i++
        j++
      } else if (i < n && (j >= m || table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1])) {
        // Removals before additions, as git prints them.
        middle.push({ type: "del", text: midA[i] })
        i++
      } else {
        middle.push({ type: "add", text: midB[j] })
        j++
      }
    }
  }
  const lines: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ type: "same" as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ type: "same" as const, text })),
  ]
  let oldNo = 0
  let newNo = 0
  for (const line of lines) {
    if (line.type !== "add") line.oldNo = ++oldNo
    if (line.type !== "del") line.newNo = ++newNo
  }
  return lines
}

/** Changed lines with `context` lines around them; `null` marks a skipped gap. */
export const diffHunks = (lines: DiffLine[], context = 3): Array<DiffLine | null> => {
  const keep = new Array(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.type === "same") return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep[k] = true
  })
  const out: Array<DiffLine | null> = []
  lines.forEach((line, index) => {
    if (keep[index]) out.push(line)
    else if (out.length && out[out.length - 1] !== null) out.push(null)
  })
  if (out[out.length - 1] === null) out.pop()
  return out
}

/**
 * Foldable blocks: start line index -> last line index of its children. A line opens a block when
 * the following lines are indented deeper, or when it is a bare `key:` followed by list items at
 * the same indent (kubectl style, `- ` not indented under its key).
 */
export const foldRanges = (source: string): Map<number, number> => {
  const lines = source.split("\n")
  const indentOf = (line: string) => line.length - line.trimStart().length
  const ranges = new Map<number, number>()
  lines.forEach((line, start) => {
    if (!line.trim()) return
    const indent = indentOf(line)
    const bareKey = /:\s*(?:[|>][-+]?\d*)?\s*$/.test(line)
    let end = start
    for (let j = start + 1; j < lines.length; j++) {
      const next = lines[j]
      if (!next.trim()) continue
      const nextIndent = indentOf(next)
      if (nextIndent > indent || (bareKey && nextIndent === indent && next.trimStart().startsWith("- "))) end = j
      else break
    }
    if (end > start) ranges.set(start, end)
  })
  return ranges
}
