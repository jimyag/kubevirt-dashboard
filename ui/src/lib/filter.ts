import { useDeferredValue, useMemo, useState } from "react"

/**
 * Table filtering shared by list pages. A query is free text plus optional `field:value` tokens:
 *
 *   web status:running node:node-1 -ns:kube-system ip:"10.0.0.1"
 *
 * Free words must appear in any field; `field:value` must appear in that field; a leading `-`
 * negates a token. Matching is case-insensitive substring. A token whose key is not a known
 * field is treated as free text, so values containing ":" (IPv6, ports) still work.
 */

export type FilterField<T> = {
  /** Token key, e.g. "status". */
  key: string
  /** Column label shown in suggestions. */
  label: string
  /** Value(s) shown in the column for this row. */
  value: (row: T) => string | number | undefined | null | Array<string | number | undefined | null>
  /** Extra accepted keys, e.g. "ns" for namespace. */
  aliases?: string[]
}

type Token = { key?: string; value: string; negate: boolean }

const tokenPattern = /(-?)(?:([A-Za-z][\w.-]*):)?(?:"([^"]*)"?|(\S*))/g

export const parseQuery = (query: string): Token[] => {
  const tokens: Token[] = []
  for (const match of query.matchAll(tokenPattern)) {
    const [, minus, key, quoted, bare] = match
    const value = (quoted ?? bare ?? "").toLowerCase()
    if (!value && !key) continue
    tokens.push({ key: key?.toLowerCase(), value, negate: minus === "-" })
  }
  return tokens
}

const normalize = (raw: ReturnType<FilterField<unknown>["value"]>): string[] =>
  (Array.isArray(raw) ? raw : [raw]).filter((item) => item !== undefined && item !== null && item !== "").map((item) => String(item).toLowerCase())

const fieldIndex = <T,>(fields: FilterField<T>[]) => {
  const byKey = new Map<string, number>()
  fields.forEach((field, index) => {
    for (const key of [field.key, ...(field.aliases || [])]) byKey.set(key.toLowerCase(), index)
  })
  return byKey
}

/**
 * Filters rows by query. Field values are lowercased once per `rows` change, and the query is
 * deferred so typing stays responsive on large lists.
 */
export function useFilteredRows<T>(rows: T[], fields: FilterField<T>[], query: string) {
  const deferred = useDeferredValue(query)
  const byKey = useMemo(() => fieldIndex(fields), [fields])
  const index = useMemo(
    () => rows.map((row) => {
      const values = fields.map((field) => normalize(field.value(row)))
      return { row, values, all: values.flat().join("\n") }
    }),
    [rows, fields],
  )
  return useMemo(() => {
    const tokens = parseQuery(deferred)
    if (tokens.length === 0) return rows
    return index
      .filter((entry) => tokens.every((token) => {
        const fieldPosition = token.key !== undefined ? byKey.get(token.key) : undefined
        let hit: boolean
        if (fieldPosition !== undefined) {
          // A bare "field:" is still being typed and filters nothing.
          if (token.value === "") return true
          hit = entry.values[fieldPosition].some((value) => value.includes(token.value))
        } else {
          const text = token.key !== undefined ? `${token.key}:${token.value}` : token.value
          hit = entry.all.includes(text)
        }
        return token.negate ? !hit : hit
      }))
      .map((entry) => entry.row)
  }, [index, byKey, deferred, rows])
}

/** Distinct values of one field, most common first, for suggestions. */
export const distinctValues = <T,>(rows: T[], field: FilterField<T>, limit = 50) => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const raw = field.value(row)
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (item === undefined || item === null || item === "") continue
      const text = String(item)
      counts.set(text, (counts.get(text) || 0) + 1)
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([value]) => value)
}

/** Distinct values of the field with `key` (empty key: none), recomputed only when rows change. */
export function useDistinctValues<T>(rows: T[], fields: FilterField<T>[], key: string) {
  return useMemo(() => {
    const field = fields.find((item) => item.key === key)
    return field ? distinctValues(rows, field) : []
  }, [rows, fields, key])
}

/** Quotes a value for a `field:value` token when needed. */
export const tokenValue = (value: string) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, "")}"` : value)

/**
 * Typed namespace filter: an exact namespace scopes the API request (less data); partial text
 * lists all namespaces and filters by substring locally.
 */
export const namespaceScope = (text: string, namespaces: string[]) => {
  const trimmed = text.trim()
  if (!trimmed || trimmed === "all") return { scope: "all", match: () => true }
  if (namespaces.includes(trimmed)) return { scope: trimmed, match: (ns?: string) => ns === trimmed }
  const needle = trimmed.toLowerCase()
  return { scope: "all", match: (ns?: string) => (ns || "").toLowerCase().includes(needle) }
}

export type Paging = { page: number; pageCount: number; pageSize: number; total: number; onPage: (page: number) => void }

/** Client-side paging so long lists render one page of rows at a time; pair with <Pager>. */
export function usePaged<T>(rows: T[], pageSize = 100): Paging & { rows: T[] } {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  return {
    rows: pageCount > 1 ? rows.slice(current * pageSize, (current + 1) * pageSize) : rows,
    page: current,
    pageCount,
    pageSize,
    total: rows.length,
    onPage: setPage,
  }
}
