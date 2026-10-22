import { useState, type ComponentProps, type ComponentType, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Check, ChevronRight, Inbox } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
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
          <h1 className="text-2xl font-semibold tracking-tight break-all">{title}</h1>
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
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
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

const pillTone: Record<Tone, string> = {
  success: "border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400",
  warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400",
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400",
}

const dotTone: Record<Tone, string> = {
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-muted-foreground/50",
  info: "bg-blue-500",
}

/** Status pill with a colored dot; tone is inferred from the status text. */
export function StatusDot({ status, label }: { status?: string; label?: string }) {
  const tone = toneForStatus(status)
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap", pillTone[tone])}>
      <span className={cn("size-1.5 rounded-full", dotTone[tone], tone === "warning" && "animate-pulse")} />
      {label || status || "Unknown"}
    </span>
  )
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex h-64 items-center justify-center gap-2.5">
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
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border bg-muted/50">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// --- Metrics ---

const tileColors = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  purple: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
}

export type TileColor = keyof typeof tileColors

export function StatTile({
  icon: Icon,
  color,
  label,
  value,
  hint,
  to,
}: {
  icon: ComponentType<{ className?: string }>
  color: TileColor
  label: string
  value: ReactNode
  hint?: ReactNode
  to?: string
}) {
  const card = (
    <Card className={cn("h-full gap-0 p-5 shadow-none", to && "transition-colors hover:border-primary/40")}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className={cn("flex size-8 items-center justify-center rounded-lg", tileColors[color])}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-sm text-muted-foreground">{hint}</div>}
    </Card>
  )
  return to ? <Link to={to} className="block">{card}</Link> : card
}

export function IconBadge({ icon: Icon, color }: { icon: ComponentType<{ className?: string }>; color: TileColor }) {
  return (
    <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tileColors[color])}>
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
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
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
  return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive break-all">{children}</div>
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
        "relative flex h-full w-full items-start gap-3 rounded-lg border bg-card p-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary ring-3 ring-primary/15" : "hover:border-foreground/20 hover:bg-muted/40"
      )}
    >
      {Icon && (
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          <Icon className="size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5 pr-5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description && <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {selected && (
        <span className="absolute top-3 right-3 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" strokeWidth={3} />
        </span>
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
            "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            value === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
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
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              {columns.map((column, index) => (
                <TableHead key={index} className={cn("h-10 px-4 text-xs font-medium text-muted-foreground", column.className)}>{column.header}</TableHead>
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
              <TableRow key={rowKey(row)} className="hover:bg-muted/40">
                {columns.map((column, index) => (
                  <TableCell key={index} className={cn("px-4 py-3", column.className)}>{column.cell(row)}</TableCell>
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
