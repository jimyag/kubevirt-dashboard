import { useState, type ComponentProps, type ComponentType, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { ChevronRight, Inbox } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
          <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3.5" />}
                {crumb.to ? <Link to={crumb.to} className="hover:text-primary transition-colors">{crumb.label}</Link> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold break-all">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export type Tone = "success" | "warning" | "danger" | "neutral" | "info"

const toneForStatus = (status?: string): Tone => {
  const lower = (status || "").toLowerCase()
  if (!lower) return "neutral"
  if (["running", "succeeded", "ready", "bound", "true", "active", "available", "healthy"].some((key) => lower.includes(key))) return "success"
  if (["error", "fail", "crash", "false", "unschedulable", "notready", "degraded", "lost"].some((key) => lower.includes(key))) return "danger"
  if (["start", "progress", "migrat", "import", "pending", "provision", "stopping", "terminat", "waiting", "paused", "clon"].some((key) => lower.includes(key))) return "warning"
  if (lower.includes("stopped") || lower.includes("halted")) return "neutral"
  return "info"
}

const dotTone: Record<Tone, string> = {
  success: "bg-green-500",
  warning: "bg-yellow-500",
  danger: "bg-red-500",
  neutral: "bg-muted-foreground/40",
  info: "bg-blue-500",
}

export function StatusDot({ status, label }: { status?: string; label?: string }) {
  const tone = toneForStatus(status)
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", dotTone[tone], tone === "warning" && "animate-pulse")} />
      <span className={cn(tone === "neutral" ? "text-muted-foreground" : "text-foreground")}>{label || status || "Unknown"}</span>
    </span>
  )
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center h-64 gap-2">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
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
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="rounded-lg bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

const tileColors = {
  blue: "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
  green: "bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400",
  purple: "bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400",
  orange: "bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400",
  cyan: "bg-cyan-50 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400",
  red: "bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400",
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
    <Card className={cn("h-full", to && "transition-colors hover:bg-muted/50")}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", tileColors[color])}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
            {hint && <div className="text-sm text-muted-foreground">{hint}</div>}
          </div>
        </div>
      </CardHeader>
    </Card>
  )
  return to ? <Link to={to} className="block">{card}</Link> : card
}

export function IconBadge({ icon: Icon, color }: { icon: ComponentType<{ className?: string }>; color: TileColor }) {
  return (
    <div className={cn("p-2 rounded-lg shrink-0", tileColors[color])}>
      <Icon className="size-4" />
    </div>
  )
}

export function UsageBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0
  const tone = ratio > 0.9 ? "bg-red-500" : ratio > 0.7 ? "bg-yellow-500" : "bg-primary"
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{label ?? `${used} / ${total}`}</span>
    </div>
  )
}

export function KeyValueGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-all font-medium text-foreground">{item.value ?? "N/A"}</dd>
        </div>
      ))}
    </dl>
  )
}

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
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground break-all">{error}</div>}
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
      className={cn("h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)}
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
      className={cn(
        "flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
      )}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />}
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
    </button>
  )
}

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
          <TableHeader className="bg-muted">
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={index} className={cn("h-9 px-3 text-xs font-semibold", column.className)}>{column.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length}><LoadingState /></TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
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

export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {right && <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">{right}</div>}
    </div>
  )
}
