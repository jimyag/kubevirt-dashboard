export function keyValueText(value: unknown): string {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  return Object.entries(record).map(([key, next]) => {
    const text = String(next ?? "")
    const encoded = /[\r\n]/.test(text) || text.startsWith('"') || text.trim() !== text ? JSON.stringify(text) : text
    return `${key}=${encoded}`
  }).join("\n")
}

export function parseKeyValueText(value: string | boolean | undefined, decodeQuoted = true): Record<string, string> {
  return Object.fromEntries(String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [key, ...rest] = line.split("=")
    const text = rest.join("=").trim()
    let decoded = text
    if (decodeQuoted && text.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed === "string") decoded = parsed
      } catch { /* Incomplete quoted input remains a literal value. */ }
    }
    return [key.trim(), decoded]
  }).filter(([key]) => key))
}

export function parseSpecFields(value: string | boolean | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parseKeyValueText(value, false)).map(([key, text]) => {
    try { return [key, JSON.parse(text)] } catch { return [key, text] }
  }))
}
