import { useState } from "react"
import * as YAML from "js-yaml"
import { toast } from "sonner"
import { Copy, Download, Pencil, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog, ErrorNote } from "@/components/console"
import { YamlCode, YamlDiff } from "@/components/yaml-editor"
import { requestJson } from "@/lib/kube"
import { toKubectlYaml } from "@/lib/manifest"
import { lineDiff, type DiffLine } from "@/lib/yaml-view"
import { t } from "@/lib/i18n"

type Identity = { apiVersion?: unknown; kind?: unknown; metadata?: { name?: unknown; namespace?: unknown } }

const identityOf = (object: unknown) => {
  const record = (object || {}) as Identity
  return { apiVersion: record.apiVersion, kind: record.kind, name: record.metadata?.name, namespace: record.metadata?.namespace }
}

/**
 * Manifest tab: highlighted `kubectl get -o yaml` output, with an editor that replaces the object
 * (PUT, like `kubectl edit`) after showing the diff for confirmation. The resourceVersion in the
 * YAML makes the server reject the update if the object changed since editing started.
 */
export function ManifestPanel({ object, url, onSaved }: { object: unknown; url?: string; onSaved?: () => void }) {
  const current = toKubectlYaml(object)
  // The YAML the edit started from; the live object may keep refreshing underneath.
  const [base, setBase] = useState<{ yaml: string; object: unknown } | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<{ object: Record<string, unknown>; diff: DiffLine[] } | null>(null)
  // Set when the server rejected the save because the object changed after editing started.
  const [conflict, setConflict] = useState(false)
  const editing = base !== null
  const name = String(identityOf(object).name || "manifest")
  const kind = String(identityOf(object).kind || "")

  const startEdit = () => {
    setBase({ yaml: current, object })
    setDraft(current)
    setError("")
    setConflict(false)
  }

  const cancel = () => {
    setBase(null)
    setError("")
    setConflict(false)
  }

  const review = () => {
    if (!base) return
    setError("")
    let parsed: unknown
    try {
      parsed = YAML.load(draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Invalid YAML"))
      return
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("The manifest must be a single object."))
      return
    }
    const before = identityOf(base.object)
    const after = identityOf(parsed)
    if (before.apiVersion !== after.apiVersion || before.kind !== after.kind || before.name !== after.name || before.namespace !== after.namespace) {
      setError(t("apiVersion, kind, name and namespace cannot be changed here."))
      return
    }
    const diff = lineDiff(base.yaml, draft)
    if (!diff.some((line) => line.type !== "same")) {
      setError(t("No changes to save."))
      return
    }
    setPending({ object: parsed as Record<string, unknown>, diff })
  }

  const save = async () => {
    if (!pending || !url) return
    try {
      await requestJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.object) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Optimistic concurrency: the resourceVersion in the edited YAML is no longer current.
      if (/has been modified|conflict/i.test(message)) {
        setPending(null)
        setConflict(true)
        onSaved?.()
        return
      }
      throw err
    }
    toast.success(t("{kind} {name} updated", { kind, name }))
    setBase(null)
    setPending(null)
    onSaved?.()
  }

  // Start over from the latest object, keeping a copy of the rejected edit on the clipboard.
  const restartFromLatest = () => {
    navigator.clipboard.writeText(draft).catch(() => undefined)
    toast.info(t("Your edited YAML was copied to the clipboard."))
    setBase({ yaml: current, object })
    setDraft(current)
    setConflict(false)
    setError("")
  }

  const download = () => {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([current], { type: "text/yaml" }))
    link.download = `${name}.yaml`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const added = pending?.diff.filter((line) => line.type === "add").length || 0
  const removed = pending?.diff.filter((line) => line.type === "del").length || 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {editing ? t("Editing. Saving replaces the object, like kubectl edit.") : <span className="font-mono">kubectl get {kind.toLowerCase() || "resource"} {name} -o yaml</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setDraft(base.yaml)} className="gap-1.5"><RotateCcw className="size-3.5" />{t("Reset")}</Button>
              <Button size="sm" variant="outline" onClick={cancel}>{t("Cancel")}</Button>
              <Button size="sm" onClick={review}>{t("Review and save")}</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={!current} onClick={() => navigator.clipboard.writeText(current).then(() => toast.success(t("Copied")))} className="gap-1.5"><Copy className="size-3.5" />{t("Copy")}</Button>
              <Button size="sm" variant="outline" disabled={!current} onClick={download} className="gap-1.5"><Download className="size-3.5" />{t("Download")}</Button>
              {url && <Button size="sm" variant="outline" disabled={!current} onClick={startEdit} className="gap-1.5"><Pencil className="size-3.5" />{t("Edit")}</Button>}
            </>
          )}
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {conflict && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <span>{t("{kind} {name} was changed by someone else after you started editing, so your changes were not applied.", { kind, name })}</span>
          <Button size="sm" variant="outline" onClick={restartFromLatest}>{t("Edit the latest version")}</Button>
        </div>
      )}
      <YamlCode
        value={editing ? draft : current}
        onChange={editing ? setDraft : undefined}
        className="h-[calc(100dvh-280px)] min-h-[360px]"
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("Apply changes to {kind} {name}?", { kind, name })}
        description={t("{added} lines added, {removed} removed. The object is replaced with the edited manifest.", { added, removed })}
        confirmLabel={t("Apply")}
        className="sm:max-w-3xl"
        onConfirm={save}
      >
        {pending && <YamlDiff lines={pending.diff} className="max-h-[55dvh]" />}
      </ConfirmDialog>
    </div>
  )
}
