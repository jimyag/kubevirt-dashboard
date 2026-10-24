import { useId, useState } from "react"
import { ChevronDown, Maximize2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/console"
import { DetailValue } from "@/components/detail-parts"
import { humanizeKey, asRecord as schemaRecord } from "@/lib/detail-values"
import { hasReadOnlyValue, immutableSchema, originalArrayItem, initialSchemaValue, resolvedSchema, schemaType, withSchemaField, type StructuralSchema } from "@/lib/crd-schema"
import { t } from "@/lib/i18n"

function SchemaDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 160 || text.includes("\n")
  return <div className="max-w-prose text-xs text-muted-foreground"><p className={`whitespace-pre-line break-words ${expanded ? "" : "line-clamp-2"}`}>{text}</p>{long && <button type="button" className="mt-1 text-primary hover:underline" onClick={() => setExpanded(!expanded)}>{expanded ? t("Show less") : t("Show more")}</button>}</div>
}

function StringMapEntry({ entryKey, value, path, keys, onChange, onRename, onRemove }: {
  entryKey: string; value: string; path: string; keys: string[]; onChange: (value: string) => void; onRename: (key: string) => void; onRemove: () => void
}) {
  const [draftKey, setDraftKey] = useState(entryKey)
  const invalid = !draftKey || (draftKey !== entryKey && keys.includes(draftKey))
  return <div className="flex min-w-0 flex-wrap items-start gap-2">
    <Input className="min-w-0 flex-1 basis-40 font-mono" aria-label={t("Key in {name}", { name: path })} aria-invalid={invalid} value={draftKey} onChange={(event) => setDraftKey(event.target.value)} />
    <textarea rows={Math.min(4, Math.max(1, value.split("\n").length))} className="min-h-9 min-w-0 flex-1 basis-40 resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm" aria-label={t("Value for {name}", { name: `${path}.${entryKey}` })} value={value} onChange={(event) => onChange(event.target.value)} />
    {draftKey !== entryKey && <Button type="button" size="sm" variant="outline" disabled={invalid} onClick={() => onRename(draftKey)}>{t("Rename")}</Button>}
    <Button type="button" size="sm" variant="ghost" aria-label={t("Remove {name}", { name: `${path}.${entryKey}` })} onClick={onRemove}><Trash2 className="size-3.5" /></Button>
  </div>
}

function SchemaArrayItem({ schema, value, originalValue, index, path, onChange, onRemove, removable }: {
  schema: StructuralSchema; value: unknown; originalValue?: unknown; index: number; path: string; onChange: (value: unknown) => void; onRemove: () => void; removable: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const type = schemaType(schema, value)
  const complex = type === "object" || type === "array"
  if (!complex) return <div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><SchemaField schema={schema} value={value} originalValue={originalValue} label={String(index + 1)} path={`${path}[${index}]`} required onChange={onChange} /></div><Button type="button" variant="ghost" size="sm" disabled={!removable} aria-label={t("Remove item {n}", { n: index + 1 })} onClick={onRemove}><Trash2 className="size-3.5" /></Button></div>
  const preview = type === "object"
    ? Object.entries(schemaRecord(value)).filter(([, item]) => item !== null && typeof item !== "object").sort(([a], [b]) => Number(b === "name") - Number(a === "name")).map(([key, item]) => `${key}: ${String(item)}`).join(" · ") || Object.keys(schemaRecord(value)).map(humanizeKey).join(" · ")
    : type === "array" ? t("{n} items", { n: Array.isArray(value) ? value.length : 0 }) : String(value)
  return <div className="min-w-0 rounded-md border bg-card">
    <div className="flex items-center gap-2 px-3 py-2">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("Edit item {n}", { n: index + 1 })} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown className={`size-3.5 shrink-0 ${expanded ? "" : "-rotate-90"}`} /><span className="shrink-0 text-muted-foreground">{index + 1}</span><span className="truncate font-mono text-xs" title={preview}>{preview || t("Empty item")}</span></button>
      <Button type="button" variant="ghost" size="sm" disabled={!removable} aria-label={t("Remove item {n}", { n: index + 1 })} onClick={onRemove}><Trash2 className="size-3.5" /></Button>
    </div>
    {expanded && <div className="border-t p-3"><SchemaField schema={schema} value={value} originalValue={originalValue} label={String(index + 1)} path={`${path}[${index}]`} required unframed={complex} onChange={onChange} /></div>}
  </div>
}

export function SchemaField({ schema: input, value, originalValue, onChange, label, path = label, required = false, unframed = false }: {
  schema: StructuralSchema; value: unknown; originalValue?: unknown; onChange: (value: unknown) => void; label: string; path?: string; required?: boolean; unframed?: boolean
}) {
  const id = useId()
  const [newKey, setNewKey] = useState("")
  const [newType, setNewType] = useState("string")
  const [multiline, setMultiline] = useState(false)
  const schema = resolvedSchema(input)
  const type = schemaType(schema, value)
  const object = schemaRecord(value)
  const entries = Object.entries(schema.properties || {})
  const present = entries.filter(([key]) => object[key] !== undefined)
  const absent = entries.filter(([key, field]) => !field.readOnly && object[key] === undefined)
  const unknown = Object.keys(object).filter((key) => !Object.prototype.hasOwnProperty.call(schema.properties || {}, key))
  const map = typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined
  const canAddKey = !map?.readOnly && (!!map || schema.additionalProperties === true || schema["x-kubernetes-preserve-unknown-fields"] || (!schema.properties && schema.additionalProperties !== false))
  const setField = (key: string, next: unknown) => onChange(withSchemaField(value, key, next))
  const primitive = !["object", "array"].includes(type)
  const freeType = !schema.type && !schema.properties && !schema.items && !schema.additionalProperties && !schema.enum && !schema["x-kubernetes-int-or-string"]
  const protectedValue = hasReadOnlyValue(schema, value, originalValue)
  const remove = !required && value !== undefined && !protectedValue && <Button type="button" size="sm" variant="ghost" aria-label={t("Remove {name}", { name: path })} onClick={() => onChange(undefined)}><Trash2 className="size-3.5" /></Button>
  const title = <div className="flex min-w-0 items-center justify-between gap-2"><label htmlFor={primitive ? id : undefined} title={path} className="min-w-0 break-words text-sm font-medium">{t(humanizeKey(label))}{required && <span className="ml-1 text-muted-foreground">*</span>}{!primitive && <span className="ml-2 break-all font-mono text-xs font-normal text-muted-foreground">{path.replace(/^resource\./, "")}</span>}</label>{remove}</div>
  if (schema.readOnly || (originalValue !== undefined && immutableSchema(schema))) return <div className="min-w-0 space-y-2"><div className="flex items-center gap-2 text-sm font-medium">{t(humanizeKey(label))}<span className="text-xs font-normal text-muted-foreground">{t("Read only")}</span></div><DetailValue value={value} preserveEmpty /></div>
  return <div className={primitive ? "min-w-0 space-y-1.5" : unframed ? "min-w-0 space-y-3" : "min-w-0 space-y-3 border-t pt-3"}>
    {!unframed && title}
    {!unframed && schema.description && <SchemaDescription text={schema.description} />}
    {freeType && <NativeSelect className="w-auto" aria-label={t("Type for {name}", { name: path })} value={value === null ? "null" : type} onChange={(event) => onChange(event.target.value === "null" ? null : initialSchemaValue({ type: event.target.value }))}>{["string", "number", "boolean", "object", "array", ...(schema.nullable ? ["null"] : [])].map((item) => <option key={item}>{item}</option>)}</NativeSelect>}
    {value === undefined ? <Button type="button" variant="outline" size="sm" onClick={() => onChange(initialSchemaValue(schema))}>{t("Set field")}</Button>
      : value === null ? <Button type="button" variant="outline" size="sm" disabled={schema.enum?.every((item) => item === null)} onClick={() => onChange(initialSchemaValue({ ...schema, default: schema.default === null ? undefined : schema.default, enum: schema.enum?.filter((item) => item !== null) }))}>{t("Set value")}</Button>
      : type === "object" && map?.type === "string" && !map.enum && !map.readOnly && !immutableSchema(map) && !schema.properties ? <div className="space-y-2">
        {Object.entries(object).map(([key, item]) => <StringMapEntry key={key} entryKey={key} value={String(item)} path={path} keys={Object.keys(object)} onChange={(next) => setField(key, next)} onRename={(next) => onChange(withSchemaField(withSchemaField(value, key, undefined), next, item))} onRemove={() => setField(key, undefined)} />)}
        <div className="flex gap-2"><Input className="min-w-0 flex-1 font-mono" aria-label={t("New key in {name}", { name: path })} placeholder={t("Key")} value={newKey} onChange={(event) => setNewKey(event.target.value)} /><Button type="button" variant="outline" size="sm" disabled={!newKey || Object.prototype.hasOwnProperty.call(object, newKey)} onClick={() => { setField(newKey, ""); setNewKey("") }}><Plus className="size-3.5" />{t("Add entry")}</Button></div>
      </div> : type === "object" ? <>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">{[...present.map(([key, field]) => ({ key, field })), ...unknown.map((key) => ({ key, field: map || {} }))].map(({ key, field }) => <div key={key} className={["object", "array"].includes(schemaType(field, object[key])) ? "min-w-0 sm:col-span-2" : "min-w-0"}><SchemaField schema={field} label={key} path={`${path}.${key}`} value={object[key]} originalValue={Object.prototype.hasOwnProperty.call(schemaRecord(originalValue), key) ? schemaRecord(originalValue)[key] : undefined} required={schema.required?.includes(key)} onChange={(next) => setField(key, next)} /></div>)}</div>
        {absent.length > 0 && <NativeSelect aria-label={t("Add field to {name}", { name: path })} value="" onChange={(event) => { const key = event.target.value; if (key) setField(key, initialSchemaValue(schema.properties![key])) }}><option value="">{t("Add field")}</option>{absent.map(([key, field]) => <option key={key} value={key}>{t(humanizeKey(key))}{schema.required?.includes(key) ? " *" : ""}{field.type ? ` · ${field.type}` : ""}</option>)}</NativeSelect>}
        {canAddKey && <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" aria-label={t("New key in {name}", { name: path })} placeholder={t("Key")} value={newKey} onChange={(event) => setNewKey(event.target.value)} />{!map && <NativeSelect className="w-auto" aria-label={t("Value type")} value={newType} onChange={(event) => setNewType(event.target.value)}>{["string", "number", "boolean", "object", "array"].map((item) => <option key={item}>{item}</option>)}</NativeSelect>}<Button type="button" variant="outline" size="sm" disabled={!newKey || Object.prototype.hasOwnProperty.call(object, newKey)} onClick={() => { setField(newKey, initialSchemaValue(map || { type: newType })); setNewKey("") }}>{t("Add entry")}</Button></div>}
      </> : type === "array" ? <>
        {(Array.isArray(value) ? value : []).map((item, index, array) => <SchemaArrayItem key={index} schema={schema.items || {}} value={item} originalValue={originalArrayItem(schema, originalValue, item, index)} index={index} path={path} removable={array.length > (schema.minItems || 0) && !hasReadOnlyValue(schema.items || {}, item, originalArrayItem(schema, originalValue, item, index))} onChange={(next) => onChange(array.map((existing, position) => position === index ? next : existing))} onRemove={() => onChange(array.filter((_, position) => position !== index))} />)}
        <Button type="button" variant="outline" size="sm" disabled={schema.maxItems !== undefined && Array.isArray(value) && value.length >= schema.maxItems} onClick={() => onChange([...(Array.isArray(value) ? value : []), initialSchemaValue(schema.items || {})])}><Plus className="size-3.5" />{t("Add item")}</Button>
      </> : schema.enum ? <NativeSelect id={id} value={String(schema.enum.findIndex((item) => JSON.stringify(item) === JSON.stringify(value)))} onChange={(event) => onChange(schema.enum![Number(event.target.value)])}><option value="-1" disabled>{t("Choose a value")}</option>{schema.enum.map((item, index) => <option key={index} value={index}>{String(item)}</option>)}</NativeSelect>
      : type === "boolean" ? <label className="flex items-center gap-2 text-sm"><input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{value ? t("Enabled") : t("Disabled")}</label>
      : <div className="flex min-w-0 gap-2">
        {schema["x-kubernetes-int-or-string"] && <NativeSelect className="w-auto" aria-label={t("Value type")} value={typeof value === "number" ? "integer" : "string"} onChange={(event) => onChange(event.target.value === "integer" ? 0 : String(value))}><option value="string">string</option><option value="integer">integer</option></NativeSelect>}
        {type === "string" && (multiline || String(value).includes("\n") || schema.format === "byte") ? <textarea id={id} className="min-h-24 w-full min-w-0 rounded-md border bg-background px-3 py-2 font-mono text-sm" value={String(value)} onChange={(event) => onChange(event.target.value)} /> : <Input id={id} type={["integer", "number"].includes(type) ? "number" : "text"} step={type === "integer" ? 1 : "any"} min={schema.minimum} max={schema.maximum} value={String(value)} onChange={(event) => onChange(["integer", "number"].includes(type) ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} className="min-w-0 font-mono" />}
        {type === "string" && !multiline && !String(value).includes("\n") && schema.format !== "byte" && <Button type="button" size="icon" variant="ghost" aria-label={t("Expand text field {name}", { name: path })} onClick={() => setMultiline(true)}><Maximize2 className="size-3.5" /></Button>}
      </div>}
    {schema.nullable && value !== null && !protectedValue && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>{t("Set null")}</Button>}
  </div>
}
