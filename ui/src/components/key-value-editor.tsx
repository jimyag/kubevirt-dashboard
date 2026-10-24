import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n"

export type KeyValueEntry = { id: string; key: string; value: string }

export function KeyValueEditor({ title, addLabel, rows, onChange, multiline = false }: {
  title: string; addLabel: string; rows: KeyValueEntry[]; onChange: (rows: KeyValueEntry[]) => void; multiline?: boolean
}) {
  const update = (id: string, field: "key" | "value", value: string) => onChange(rows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  return <section className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium">{t(title)}</h4><Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, { id: crypto.randomUUID(), key: "", value: "" }])}><Plus className="size-3.5" />{t(addLabel)}</Button></div>
    {rows.length > 0 && <div className="space-y-2 rounded-md border p-3">
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-3 text-xs text-muted-foreground sm:grid"><span>{t("Key")}</span><span>{t("Value")}</span><span /></div>
      {rows.map((row, index) => <div key={row.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] sm:gap-3">
        <Input autoFocus={!row.key} aria-label={t("{section} key {n}", { section: t(title), n: index + 1 })} placeholder={t("Key")} className="min-w-0 font-mono" value={row.key} aria-invalid={!row.key || rows.some((other) => other.id !== row.id && other.key === row.key)} onChange={(event) => update(row.id, "key", event.target.value)} />
        {multiline ? <textarea rows={Math.min(4, Math.max(1, row.value.split("\n").length))} aria-label={t("{section} value {n}", { section: t(title), n: index + 1 })} placeholder={t("Value")} className="col-start-1 min-h-9 w-full min-w-0 resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm sm:col-start-auto" value={row.value} onChange={(event) => update(row.id, "value", event.target.value)} /> : <Input aria-label={t("{section} value {n}", { section: t(title), n: index + 1 })} placeholder={t("Value")} className="col-start-1 min-w-0 font-mono sm:col-start-auto" value={row.value} onChange={(event) => update(row.id, "value", event.target.value)} />}
        <Button type="button" variant="ghost" size="sm" className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto" aria-label={t("Remove {section} row {n}", { section: t(title), n: index + 1 })} onClick={() => onChange(rows.filter((other) => other.id !== row.id))}><Trash2 className="size-3.5" /></Button>
      </div>)}
    </div>}
  </section>
}
