import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { diffHunks, foldRanges, highlightYaml, type DiffLine, type YamlTokenKind } from "@/lib/yaml-view"

const tokenClass: Record<YamlTokenKind, string> = {
  key: "text-code-key",
  string: "text-code-string",
  literal: "text-code-literal",
  comment: "text-code-comment italic",
  punct: "text-muted-foreground",
}

/** Shared metrics so the transparent textarea lines up exactly with the highlighted lines. */
const codeText = "font-mono text-[13px] leading-[1.6] whitespace-pre"
const linePx = 13 * 1.6

/**
 * YAML viewer with line numbers, highlighting, search and (read-only) folding. With `onChange` it
 * becomes an editor: a transparent textarea sits over the highlighted lines and both scroll
 * together; folding is off while editing so lines stay aligned.
 */
export function YamlCode({ value, onChange, className }: { value: string; onChange?: (value: string) => void; className?: string }) {
  const editable = Boolean(onChange)
  // Highlighting lags behind typing on very large manifests instead of blocking input.
  const highlighted = useDeferredValue(value)
  const tokens = useMemo(() => highlightYaml(highlighted), [highlighted])
  const lines = useMemo(() => value.split("\n"), [value])
  const ranges = useMemo(() => (editable ? new Map<number, number>() : foldRanges(value)), [value, editable])
  const [folded, setFolded] = useState<Set<number>>(() => new Set())
  const [query, setQuery] = useState("")
  const [current, setCurrent] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? lines.flatMap((line, index) => (line.toLowerCase().includes(needle) ? [index] : [])) : []
  }, [lines, query])
  const matchSet = useMemo(() => new Set(matches), [matches])
  const active = matches.length ? matches[Math.min(current, matches.length - 1)] : -1

  // Lines hidden by folds; a fold that hides the active match is ignored so the match shows.
  const visible = useMemo(() => {
    const hidden = new Set<number>()
    for (const start of folded) {
      const end = ranges.get(start)
      if (end === undefined || (active > start && active <= end)) continue
      for (let line = start + 1; line <= end; line++) hidden.add(line)
    }
    return lines.map((_, index) => index).filter((index) => !hidden.has(index))
  }, [folded, ranges, lines, active])

  useEffect(() => {
    if (active < 0 || !scrollRef.current) return
    const container = scrollRef.current
    const row = visible.indexOf(active)
    const top = row * linePx - container.clientHeight / 3
    container.scrollTo({ top: Math.max(0, top) })
  }, [active, visible])

  const step = (delta: number) => {
    if (!matches.length) return
    setCurrent((index) => (Math.min(index, matches.length - 1) + delta + matches.length) % matches.length)
  }

  const toggle = (line: number) =>
    setFolded((currentFolds) => {
      const next = new Set(currentFolds)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })

  // "Collapse" keeps top-level keys and their direct children visible.
  const collapse = () => setFolded(new Set(Array.from(ranges.keys()).filter((line) => lines[line].length - lines[line].trimStart().length === 2)))

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return
    event.preventDefault()
    // insertText keeps the browser's undo history.
    if (!document.execCommand("insertText", false, "  ")) {
      const target = event.currentTarget
      target.setRangeText("  ", target.selectionStart, target.selectionEnd, "end")
      onChange?.(target.value)
    }
  }

  const onContainerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border bg-card", className)} onKeyDown={onContainerKeyDown}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCurrent(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                step(event.shiftKey ? -1 : 1)
              } else if (event.key === "Escape") {
                setQuery("")
              }
            }}
            placeholder={t("Search")}
            aria-label={t("Search in manifest")}
            className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        {query.trim() && <span className="text-xs text-muted-foreground tabular-nums">{matches.length ? `${Math.min(current, matches.length - 1) + 1}/${matches.length}` : t("No matches")}</span>}
        <Button size="icon" variant="ghost" className="size-7" disabled={!matches.length} onClick={() => step(-1)} aria-label={t("Previous match")}><ChevronUp className="size-4" /></Button>
        <Button size="icon" variant="ghost" className="size-7" disabled={!matches.length} onClick={() => step(1)} aria-label={t("Next match")}><ChevronDown className="size-4" /></Button>
        {!editable && ranges.size > 0 && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={collapse}><ChevronsDownUp className="size-3.5" />{t("Collapse")}</Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => setFolded(new Set())}><ChevronsUpDown className="size-3.5" />{t("Expand all")}</Button>
          </div>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" onClick={() => textareaRef.current?.focus()}>
        <div className="flex min-w-max py-3">
          <div aria-hidden className={cn(codeText, "sticky left-0 z-10 shrink-0 border-r bg-card pr-1 pl-2 text-right text-muted-foreground/70 select-none")}>
            {visible.map((line) => (
              <div key={line} className="flex items-center justify-end gap-0.5">
                <span className="min-w-[3ch]">{line + 1}</span>
                {ranges.has(line) ? (
                  <button type="button" onClick={(event) => { event.stopPropagation(); toggle(line) }} className="rounded text-muted-foreground hover:text-foreground" aria-label={folded.has(line) ? t("Expand") : t("Collapse")}>
                    {folded.has(line) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                  </button>
                ) : <span className="w-3" />}
              </div>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div aria-hidden={editable} className={cn(codeText, "px-4 text-foreground")}>
              {visible.map((line) => (
                <div key={line} className={cn(line === active ? "bg-primary/15" : matchSet.has(line) && "bg-primary/7")}>
                  {(tokens[line] || [{ text: lines[line] }]).map((token, i) => (token.kind ? <span key={i} className={tokenClass[token.kind]}>{token.text}</span> : token.text))}
                  {!lines[line] && " "}
                  {folded.has(line) && ranges.has(line) && !(active > line && active <= ranges.get(line)!) && (
                    <button type="button" onClick={() => toggle(line)} className="ml-2 rounded border bg-muted/60 px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                      {t("{count} lines", { count: ranges.get(line)! - line })}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editable && (
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => onChange?.(event.target.value)}
                onKeyDown={onTextareaKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                wrap="off"
                aria-label="YAML"
                className={cn(codeText, "absolute inset-0 m-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent px-4 py-0 text-transparent caret-foreground outline-none selection:bg-primary/25")}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const diffRowClass: Record<DiffLine["type"], string> = {
  same: "",
  add: "bg-green-500/10 text-green-800 dark:text-green-300",
  del: "bg-red-500/10 text-red-800 dark:text-red-300",
}

/** Changed lines with a little context, like `git diff`. */
export function YamlDiff({ lines, className }: { lines: DiffLine[]; className?: string }) {
  const hunks = useMemo(() => diffHunks(lines), [lines])
  return (
    <div className={cn("overflow-auto rounded-md border bg-card", className)}>
      <table className={cn(codeText, "w-full border-collapse text-[12px]")}>
        <tbody>
          {hunks.map((line, index) => line === null ? (
            <tr key={index} className="bg-muted/50 text-muted-foreground"><td colSpan={3} className="px-3 py-0.5">⋯</td></tr>
          ) : (
            <tr key={index} className={diffRowClass[line.type]}>
              <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">{line.oldNo ?? ""}</td>
              <td className="w-10 px-2 text-right text-muted-foreground/70 select-none">{line.newNo ?? ""}</td>
              <td className="px-2"><span className="select-none">{line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}</span>{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
