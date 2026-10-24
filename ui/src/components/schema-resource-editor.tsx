import { useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ConfirmDialog, ErrorNote } from "@/components/console"
import { SchemaField } from "@/components/schema-fields"
import { KeyValueEditor, type KeyValueEntry } from "@/components/key-value-editor"
import { YamlDiff } from "@/components/yaml-editor"
import { initialSchemaValue, schemaIssues, withSchemaField, type StructuralSchema } from "@/lib/crd-schema"
import { requestJson } from "@/lib/kube"
import { toKubectlYaml } from "@/lib/manifest"
import { lineDiff } from "@/lib/yaml-view"
import { t } from "@/lib/i18n"
import { hiddenAnnotations, asRecord as schemaRecord } from "@/lib/detail-values"
import type { KubeResource, ResourceConfig } from "@/components/resource-management"

function editableResourceSchema(schema: StructuralSchema, resource?: KubeResource): StructuralSchema {
  const properties = { ...schema.properties }
  for (const key of ["apiVersion", "kind", "metadata", "status"]) delete properties[key]
  if (resource && ["OvnSnatRule", "OvnDnatRule", "OvnFip"].includes(resource.kind || "")) {
    for (const key of Object.keys(properties)) properties[key] = { ...properties[key], readOnly: true }
  }
  // Kube-OVN controllers reject changing the binding and rules of shared policies.
  if (resource?.kind === "QoSPolicy" && properties.spec) {
    const spec = { ...properties.spec, properties: { ...properties.spec.properties } }
    for (const key of ["bindingType", "shared", ...(resource.spec?.shared === true || resource.status?.shared === true ? ["bandwidthLimitRules"] : [])]) {
      if (spec.properties![key]) spec.properties![key] = { ...spec.properties![key], readOnly: true }
    }
    properties.spec = spec
  }
  return { ...schema, properties, required: schema.required?.filter((key) => Object.prototype.hasOwnProperty.call(properties, key)) }
}

export function SchemaResourceEditor({ config, schema, resource, onSaved, defaultNamespace = "default" }: {
  config: ResourceConfig; schema: StructuralSchema; resource?: KubeResource; onSaved: (resource: KubeResource) => void; defaultNamespace?: string
}) {
  const [open, setOpen] = useState(false)
  const [fieldsDraft, setDraft] = useState<Record<string, unknown>>({})
  const [labels, setLabels] = useState<KeyValueEntry[]>([])
  const [annotations, setAnnotations] = useState<KeyValueEntry[]>([])
  const [showManagedAnnotations, setShowManagedAnnotations] = useState(false)
  const [base, setBase] = useState<Record<string, unknown>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const fields = editableResourceSchema(schema, resource)
  const editing = !!resource
  const metadataBase = schemaRecord(fieldsDraft.metadata)
  const draft: Record<string, unknown> = { ...fieldsDraft, metadata: { ...metadataBase,
    labels: labels.length ? Object.fromEntries(labels.map((row) => [row.key, row.value])) : undefined,
    annotations: annotations.length ? Object.fromEntries(annotations.map((row) => [row.key, row.value])) : undefined,
  } }
  const metadata = schemaRecord(draft.metadata)
  const apiVersion = config.listPath.split("/").slice(2, 4).join("/")
  const url = `/apis/${editing ? resource.apiVersion : apiVersion}${config.namespaced ? `/namespaces/${encodeURIComponent(String(metadata.namespace || ""))}` : ""}/${config.id}${editing ? `/${encodeURIComponent(resource.metadata.name)}` : ""}`
  const options = { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }
  const start = () => {
    const next = resource ? structuredClone(resource) : { ...schemaRecord(initialSchemaValue(fields)), apiVersion, kind: config.kind, metadata: { name: "", ...(config.namespaced ? { namespace: defaultNamespace } : {}) } }
    if (!resource && fields.properties?.spec && next.spec === undefined) next.spec = schemaRecord(initialSchemaValue(fields.properties.spec))
    setDraft(next); setBase(structuredClone(next)); setError(""); setReviewing(false); setShowManagedAnnotations(false)
    setLabels(Object.entries(schemaRecord(schemaRecord(next.metadata).labels)).map(([key, value]) => ({ id: crypto.randomUUID(), key, value: String(value) })))
    setAnnotations(Object.entries(schemaRecord(schemaRecord(next.metadata).annotations)).map(([key, value]) => ({ id: crypto.randomUUID(), key, value: String(value) })))
  }
  const review = async () => {
    setError("")
    const issues = schemaIssues(fields, draft)
    for (const [section, rows] of [["Labels", labels], ["Annotations", annotations]] as const) {
      if (rows.some((row) => !row.key) || new Set(rows.map((row) => row.key)).size !== rows.length) issues.unshift({ path: t(section), message: "Keys must be nonempty and unique." })
    }
    if (!metadata.name || (config.namespaced && !metadata.namespace)) issues.unshift({ path: "metadata", message: "Name and namespace are required." })
    if (issues.length) { setError(issues.map((issue) => `${issue.path}: ${t(issue.message, issue.values)}`).join("\n")); return }
    setBusy(true)
    try { await requestJson(`${url}?dryRun=All`, options); setReviewing(true) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { if (next) start(); setOpen(next) } }}>
      <DialogTrigger asChild><Button variant={editing ? "outline" : "default"} size="sm">{editing ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}{editing ? t("Edit {v0}", { v0: config.kind }) : t("Create {v0}", { v0: config.kind })}</Button></DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
        <DialogHeader><DialogTitle>{editing ? t("Edit {v0}", { v0: config.kind }) : t("Create {v0}", { v0: config.kind })}</DialogTitle><DialogDescription><span className="font-mono">{editing ? resource.apiVersion : apiVersion}</span></DialogDescription></DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto px-1 pb-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("Metadata")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">{t("Name")}<Input value={String(metadata.name || "")} disabled={editing} onChange={(event) => setDraft(withSchemaField(draft, "metadata", { ...metadata, name: event.target.value }))} /></label>
              {config.namespaced && <label className="space-y-1.5 text-sm">{t("Namespace")}<Input disabled={editing} value={String(metadata.namespace || "")} onChange={(event) => setDraft(withSchemaField(draft, "metadata", { ...metadata, namespace: event.target.value }))} /></label>}
            </div>
            <KeyValueEditor title="Labels" addLabel="Add label" rows={labels} onChange={setLabels} />
            <KeyValueEditor title="Annotations" addLabel="Add annotation" rows={showManagedAnnotations ? annotations : annotations.filter((row) => !hiddenAnnotations.has(row.key))} onChange={(rows) => setAnnotations(showManagedAnnotations ? rows : [...annotations.filter((row) => hiddenAnnotations.has(row.key)), ...rows])} multiline />
            {annotations.some((row) => hiddenAnnotations.has(row.key)) && <Button type="button" variant="ghost" size="sm" onClick={() => setShowManagedAnnotations(!showManagedAnnotations)}>{showManagedAnnotations ? t("Hide system annotations") : t("Show system annotations")}</Button>}
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("Resource fields")}</h3>
            <SchemaField schema={fields} label="resource" unframed value={Object.fromEntries(Object.keys(fields.properties || {}).filter((key) => draft[key] !== undefined).map((key) => [key, draft[key]]))} required onChange={(next) => { let result = draft; for (const key of Object.keys(fields.properties || {})) result = withSchemaField(result, key, schemaRecord(next)[key]); setDraft(result) }} />
          </section>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t("Cancel")}</Button><Button disabled={busy || (editing && JSON.stringify(base) === JSON.stringify(draft))} onClick={review}>{busy ? t("Validating...") : t("Review changes")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={reviewing} onOpenChange={setReviewing} title={t("Save changes?")} confirmLabel={editing ? t("Save") : t("Create")} className="sm:max-w-4xl" onConfirm={async () => { const saved = await requestJson(url, options); setOpen(false); onSaved(saved as KubeResource) }}>
      <YamlDiff lines={lineDiff(editing ? toKubectlYaml(base) : "", toKubectlYaml(draft))} className="max-h-[55dvh]" />
    </ConfirmDialog>
  </>
}
