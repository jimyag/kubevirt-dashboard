import { useDeferredValue, useMemo, useRef, type KeyboardEvent } from "react"

import { cn } from "@/lib/utils"
import { diffHunks, highlightYaml, type DiffLine, type YamlTokenKind } from "@/lib/yaml-view"

const tokenClass: Record<YamlTokenKind, string> = {
  key: "text-code-key",
  string: "text-code-string",
  literal: "text-code-literal",
  comment: "text-code-comment italic",
  punct: "text-muted-foreground",
}

/** Shared metrics so the transparent textarea lines up exactly with the highlighted text. */
const codeText = "font-mono text-[13px] leading-[1.6] whitespace-pre"

function HighlightedLines({ source }: { source: string }) {
  const lines = useMemo(() => highlightYaml(source), [source])
  return (
    <>
      {lines.map((tokens, index) => (
        <span key={index}>
          {tokens.map((token, i) => (token.kind ? <span key={i} className={tokenClass[token.kind]}>{token.text}</span> : token.text))}
          {"\n"}
        </span>
      ))}
    </>
  )
}

/**
 * YAML viewer with line numbers and highlighting. With `onChange` it becomes an editor: a
 * transparent textarea sits over the highlighted text and both scroll together.
 */
export function YamlCode({ value, onChange, className }: { value: string; onChange?: (value: string) => void; className?: string }) {
  // Highlighting lags behind typing on very large manifests instead of blocking input.
  const highlighted = useDeferredValue(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineCount = value.split("\n").length

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return
    event.preventDefault()
    // insertText keeps the browser's undo history.
    if (!document.execCommand("insertText", false, "  ")) {
      const target = event.currentTarget
      target.setRangeText("  ", target.selectionStart, target.selectionEnd, "end")
      onChange?.(target.value)
    }
  }

  return (
    <div className={cn("overflow-auto rounded-lg border bg-card", className)} onClick={() => textareaRef.current?.focus()}>
      <div className="flex min-w-max">
        <div aria-hidden className={cn(codeText, "sticky left-0 z-10 shrink-0 border-r bg-muted/40 px-3 py-3 text-right text-muted-foreground/70 select-none")}>
          {Array.from({ length: lineCount }, (_, index) => `${index + 1}\n`).join("")}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre aria-hidden={Boolean(onChange)} className={cn(codeText, "m-0 px-4 py-3 text-foreground")}>
            <HighlightedLines source={highlighted} />
          </pre>
          {onChange && (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              aria-label="YAML"
              className={cn(codeText, "absolute inset-0 m-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent px-4 py-3 text-transparent caret-foreground outline-none selection:bg-primary/25")}
            />
          )}
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
