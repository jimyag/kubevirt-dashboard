import { useState, type ComponentProps, type ComponentType, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Check, ChevronRight, Inbox } from "lucide-react"

import { cn } from "@/lib/utils"
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
  if (["error", "fail", "crash", "false", "unschedulable", "notready", "degraded", "lost"].some((key) => lower.includes(key))) return "danger"
  if (["running", "succeeded", "ready", "bound", "true", "active", "available", "healthy", "installed"].some((key) => lower.includes(key))) return "success"
  if (["start", "progress", "migrat", "import", "pending", "provision", "stopping", "terminat", "waiting", "paused", "clon", "cordon"].some((key) => lower.includes(key))) return "warning"
  if (lower.includes("stopped") || lower.includes("halted")) return "neutral"
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
      {label || status || "Unknown"}
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
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  children?: ReactNode
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
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setError(""); onOpenChange(next) } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {error && <ErrorNote>{error}</ErrorNote>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
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

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  minWidth = 760,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  minWidth?: number
}) {
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
                <TableCell colSpan={columns.length}>{empty ?? <EmptyState title="No resources found" />}</TableCell>
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
