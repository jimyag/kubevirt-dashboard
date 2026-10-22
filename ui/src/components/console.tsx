import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type KeyboardEvent, type ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"
import { Check, ChevronLeft, ChevronRight, Inbox, Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { findActiveNav, toneClasses } from "@/lib/navigation"
import { tokenValue, useDistinctValues, usePaged, type FilterField, type Paging } from "@/lib/filter"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { t } from "@/lib/i18n"

// --- Page structure ---

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  badge,
}: {
  title: ReactNode
  subtitle?: ReactNode
  breadcrumbs?: Array<{ label: string; to?: string }>
  actions?: ReactNode
  badge?: ReactNode
}) {
  const active = findActiveNav(useLocation().pathname)
  const tone = active ? toneClasses[active.section.tone] : null
  const Icon = active?.item.icon
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex flex-wrap items-center gap-1 text-xs font-medium text-muted-foreground">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3" />}
                {crumb.to ? <Link to={crumb.to} className="hover:text-foreground transition-colors">{crumb.label}</Link> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          {Icon && tone && (
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", tone.soft, tone.text)}>
              <Icon className="size-4" />
            </span>
          )}
          <h1 className="text-xl font-semibold break-all">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Titled block inside a page; lighter than a card for grouping tables and lists. */
export function Section({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

// --- Status ---

export type Tone = "success" | "warning" | "danger" | "neutral" | "info"

const toneForStatus = (status?: string): Tone => {
  const lower = (status || "").toLowerCase()
  if (!lower) return "neutral"
  // Negative states first: "notready" contains "ready".
  if (["error", "fail", "crash", "false", "unschedulable", "notready", "unavailable", "degraded", "lost"].some((key) => lower.includes(key))) return "danger"
  if (["running", "succeeded", "ready", "bound", "true", "active", "available", "healthy", "installed", "deployed"].some((key) => lower.includes(key))) return "success"
  if (["start", "progress", "migrat", "import", "pending", "provision", "stopping", "terminat", "waiting", "paused", "clon", "cordon"].some((key) => lower.includes(key))) return "warning"
  if (lower.includes("stopped") || lower.includes("halted") || lower.includes("superseded")) return "neutral"
  return "info"
}

const dotTone: Record<Tone, string> = {
  success: "bg-green-600 dark:bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-600 dark:bg-red-500",
  neutral: "bg-muted-foreground/50",
  info: "bg-primary",
}

const textTone: Record<Tone, string> = {
  success: "text-foreground",
  warning: "text-foreground",
  danger: "text-red-700 dark:text-red-400",
  neutral: "text-muted-foreground",
  info: "text-foreground",
}

/** Status as a colored dot plus text; tone is inferred from the status text. */
export function StatusDot({ status, label }: { status?: string; label?: string }) {
  const tone = toneForStatus(status)
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-sm whitespace-nowrap", textTone[tone])}>
      <span className={cn("size-2 rounded-full", dotTone[tone])} />
      {label || (status ? t(status) : t("Unknown"))}
    </span>
  )
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex h-48 items-center justify-center gap-2.5">
      <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <Icon className="size-5 text-muted-foreground" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// --- Metrics ---

/** Kept for call sites; tiles and badges are neutral so color stays reserved for state. */
export type TileColor = "blue" | "green" | "purple" | "orange" | "cyan" | "red"

export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  icon: ComponentType<{ className?: string }>
  color?: TileColor
  label: string
  value: ReactNode
  hint?: ReactNode
  to?: string
}) {
  const body = (
    <div className={cn("h-full rounded-lg border bg-card px-4 py-3.5", to && "transition-colors hover:border-foreground/25")}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
  return to ? <Link to={to} className="block">{body}</Link> : body
}

export function IconBadge({ icon: Icon }: { icon: ComponentType<{ className?: string }>; color?: TileColor }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
      <Icon className="size-4" />
    </div>
  )
}

export function UsageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0
  const tone = ratio > 0.9 ? "bg-red-500" : ratio > 0.7 ? "bg-amber-500" : "bg-primary"
  return (
    <div className="flex min-w-[120px] flex-col gap-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 2 : 0)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{label ?? `${used} / ${total}`}</span>
    </div>
  )
}

export function KeyValueGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs text-muted-foreground">{t(item.label)}</dt>
          <dd className="min-w-0 break-all text-foreground">{item.value ?? "N/A"}</dd>
        </div>
      ))}
    </dl>
  )
}

// --- Dialogs and forms ---

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  children?: ReactNode
  /** Extra classes for the dialog, e.g. a wider max width for diffs. */
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const confirm = async () => {
    setBusy(true)
    setError("")
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Request failed"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setError(""); onOpenChange(next) } }}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {error && <ErrorNote>{error}</ErrorNote>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("Cancel")}</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={busy}>
            {busy ? t("Working...") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive break-all">{children}</div>
}

export function FieldRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** Native select styled like shadcn Input, used where option lists are long or dynamic. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", className)}
      {...props}
    />
  )
}

// --- Typeable filters ---

type Suggestion = { value: string; label?: ReactNode; hint?: string }

const inputClass = "h-9 w-full rounded-md border border-input bg-background text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

/** Keyboard and open state for an input with a suggestion list. */
function useSuggestions(count: number) {
  const [open, setOpen] = useState(false)
  const [rawActive, setActive] = useState(-1)
  const active = rawActive < count ? rawActive : -1
  const keyHandler = (pick: (index: number) => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      if (count === 0) return
      setActive(event.key === "ArrowDown" ? (active + 1) % count : (active <= 0 ? count - 1 : active - 1))
    } else if ((event.key === "Enter" || event.key === "Tab") && open && active >= 0 && active < count) {
      event.preventDefault()
      pick(active)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }
  return { open, setOpen: (next: boolean) => { setOpen(next); setActive(-1) }, active, keyHandler }
}

function SuggestionList({ items, active, onPick, footer }: { items: Suggestion[]; active: number; onPick: (index: number) => void; footer?: ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])
  if (items.length === 0 && !footer) return null
  return (
    <div className="absolute top-full left-0 z-50 mt-1 w-max min-w-full max-w-[min(420px,90vw)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
      <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
        {items.map((item, index) => (
          <li
            key={item.value}
            data-index={index}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(index)
            }}
            className={cn("flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm", index === active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60")}
          >
            <span className="min-w-0 truncate">{item.label ?? item.value}</span>
            {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{t(item.hint)}</span>}
          </li>
        ))}
      </ul>
      {footer && <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">{footer}</div>}
    </div>
  )
}

const maxSuggestions = 100

/**
 * Text input with suggestions, used instead of a select for filters: type any text or pick a
 * known value. An empty value means "all".
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<string | Suggestion>
  placeholder?: string
  className?: string
  "aria-label"?: string
}) {
  const normalized = useMemo(() => options.map((option) => typeof option === "string" ? { value: option } : option), [options])
  const items = useMemo(() => {
    const needle = value.trim().toLowerCase()
    // Show everything when the box holds an exact option, so another one can be picked.
    const exact = normalized.some((option) => option.value.toLowerCase() === needle)
    const matches = !needle || exact ? normalized : normalized.filter((option) => option.value.toLowerCase().includes(needle))
    return matches.slice(0, maxSuggestions)
  }, [normalized, value])
  const suggest = useSuggestions(items.length)
  const pick = (index: number) => {
    onChange(items[index].value)
    suggest.setOpen(false)
  }
  return (
    <div className={cn("relative min-w-[160px]", className)}>
      <input
        className={cn(inputClass, "px-3", value && "pr-8")}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={suggest.open}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value)
          suggest.setOpen(true)
        }}
        onFocus={() => suggest.setOpen(true)}
        onBlur={() => suggest.setOpen(false)}
        onKeyDown={suggest.keyHandler(pick)}
      />
      {value && (
        <button type="button" aria-label={t("Clear")} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
      {suggest.open && <SuggestionList items={items} active={suggest.active} onPick={pick} />}
    </div>
  )
}

/**
 * Search box that understands `field:value` tokens for the given fields, suggesting field names
 * and the values present in the rows. See lib/filter.ts for the syntax.
 */
export function FilterInput<T>({
  value,
  onChange,
  fields,
  rows,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  fields: FilterField<T>[]
  rows: T[]
  placeholder?: string
  className?: string
}) {
  // The token being typed is the text after the last space.
  const start = value.search(/\S*$/)
  const token = value.slice(start)
  const negate = token.startsWith("-")
  const bare = negate ? token.slice(1) : token
  const colon = bare.indexOf(":")
  const fieldKey = colon > 0 ? bare.slice(0, colon).toLowerCase() : ""
  const field = fieldKey ? fields.find((item) => item.key === fieldKey || item.aliases?.includes(fieldKey)) : undefined

  // Distinct values are only collected for the field being typed, once per rows change.
  const fieldValues = useDistinctValues(rows, fields, field ? field.key : "")

  const prefix = negate ? "-" : ""
  let items: Suggestion[] = []
  if (field) {
    const partial = bare.slice(colon + 1).replace(/^"/, "").toLowerCase()
    items = fieldValues
      .filter((item) => item.toLowerCase().includes(partial))
      .slice(0, 20)
      .map((item) => ({ value: `${prefix}${field.key}:${tokenValue(item)} `, label: item, hint: t(field.label) }))
  } else if (colon <= 0) {
    const lower = bare.toLowerCase()
    items = fields
      .filter((item) => !lower || item.key.startsWith(lower) || item.label.toLowerCase().startsWith(lower) || item.aliases?.some((alias) => alias.startsWith(lower)))
      .map((item) => ({ value: `${prefix}${item.key}:`, label: <span className="font-mono text-xs">{item.key}:</span>, hint: t(item.label) }))
  }

  const suggest = useSuggestions(items.length)
  const pick = (index: number) => {
    const next = value.slice(0, start) + items[index].value
    onChange(next)
    // Keep the list open after choosing a field so its values show next.
    suggest.setOpen(next.endsWith(":"))
  }

  return (
    <div className={cn("relative w-full md:w-[320px]", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className={cn(inputClass, "pl-9", value ? "pr-8" : "pr-3")}
        value={value}
        placeholder={placeholder ?? t("Filter, e.g. web status:running")}
        aria-label={t("Filter")}
        role="combobox"
        aria-expanded={suggest.open}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value)
          suggest.setOpen(true)
        }}
        onFocus={() => suggest.setOpen(true)}
        onBlur={() => suggest.setOpen(false)}
        onKeyDown={suggest.keyHandler(pick)}
      />
      {value && (
        <button type="button" aria-label={t("Clear filter")} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
      {suggest.open && (items.length > 0 || !token) && (
        <SuggestionList
          items={items}
          active={suggest.active}
          onPick={pick}
          footer={!token && t("Type text, or field:value; prefix - to exclude")}
        />
      )}
    </div>
  )
}

export function ChoiceCard({
  selected,
  onClick,
  title,
  description,
  icon: Icon,
  disabled,
}: {
  selected: boolean
  onClick: () => void
  title: ReactNode
  description?: ReactNode
  icon?: ComponentType<{ className?: string }>
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative flex h-full w-full items-start gap-2.5 rounded-md border bg-card px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary bg-accent/50 shadow-[inset_0_0_0_1px_var(--primary)]" : "hover:border-foreground/25"
      )}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />}
      <div className="min-w-0 flex-1 space-y-0.5 pr-5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {selected && (
        <Check className="absolute top-2.5 right-2.5 size-4 text-primary" strokeWidth={2.5} />
      )}
    </button>
  )
}

/** Horizontal tabs driven by local state, styled to match route-driven tabs. */
export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode; icon?: ComponentType<{ className?: string }> }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
            value === tab.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.icon && <tab.icon className="size-4" />}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// --- Tables ---

export type Column<T> = {
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
}

/** Footer for usePaged; renders nothing when everything fits on one page. */
export function Pager({ page, pageCount, pageSize, total, onPage }: Paging) {
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="tabular-nums">{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}</span>
      <Button variant="ghost" size="icon" className="size-7" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={t("Previous page")}>
        <ChevronLeft className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label={t("Next page")}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

export function DataTable<T>({
  columns,
  rows: allRows,
  rowKey,
  loading,
  empty,
  minWidth = 760,
  pageSize = 100,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  minWidth?: number
  pageSize?: number
}) {
  const { rows, ...paging } = usePaged(allRows, pageSize)
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <Table style={{ minWidth }}>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              {columns.map((column, index) => (
                <TableHead key={index} className={cn("h-9 px-3 text-xs font-medium text-muted-foreground", column.className)}>{column.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length}><LoadingState /></TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length}>{empty ?? <EmptyState title={t("No resources found")} />}</TableCell>
              </TableRow>
            ) : rows.map((row) => (
              <TableRow key={rowKey(row)} className="hover:bg-muted/50">
                {columns.map((column, index) => (
                  <TableCell key={index} className={cn("px-3 py-2", column.className)}>{column.cell(row)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager {...paging} />
    </div>
  )
}

/** Filter row above a table: filters on the left, search on the right. */
export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {right && <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">{right}</div>}
    </div>
  )
}

/** Bordered block with a title bar; the default container for detail page content. */
export function Panel({
  title,
  description,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card", className)}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}
