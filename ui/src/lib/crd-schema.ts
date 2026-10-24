import { asRecord as schemaRecord } from "./detail-values"

export type StructuralSchema = {
  type?: string
  title?: string
  description?: string
  format?: string
  nullable?: boolean
  readOnly?: boolean
  default?: unknown
  enum?: unknown[]
  properties?: Record<string, StructuralSchema>
  required?: string[]
  items?: StructuralSchema
  additionalProperties?: boolean | StructuralSchema
  oneOf?: StructuralSchema[]
  anyOf?: StructuralSchema[]
  allOf?: StructuralSchema[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: boolean
  exclusiveMaximum?: boolean
  multipleOf?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  minProperties?: number
  maxProperties?: number
  "x-kubernetes-int-or-string"?: boolean
  "x-kubernetes-preserve-unknown-fields"?: boolean
  "x-kubernetes-list-type"?: string
  "x-kubernetes-list-map-keys"?: string[]
  "x-kubernetes-validations"?: Array<{ rule: string; message?: string }>
}

export function resolvedSchema(schema: StructuralSchema): StructuralSchema {
  return (schema.allOf || []).reduce<StructuralSchema>((current, part) => {
    const next = resolvedSchema(part)
    return { ...current, ...next, properties: { ...current.properties, ...next.properties }, required: [...new Set([...(current.required || []), ...(next.required || [])])] }
  }, schema)
}

export function schemaType(schema: StructuralSchema, value?: unknown): string {
  if (schema["x-kubernetes-int-or-string"]) return typeof value === "number" ? "integer" : "string"
  if (schema.type) return schema.type
  if (schema.properties || schema.additionalProperties) return "object"
  if (schema.items) return "array"
  if (Array.isArray(value)) return "array"
  if (value !== null && typeof value === "object") return "object"
  return typeof value === "boolean" || typeof value === "number" ? typeof value : "string"
}

/** Only materialize defaults or required fields; optional object trees can be very large. */
export function initialSchemaValue(input: StructuralSchema): unknown {
  const schema = resolvedSchema(input)
  if (schema.default !== undefined) return structuredClone(schema.default)
  if (schema.enum?.length) return structuredClone(schema.enum[0])
  const type = schemaType(schema)
  if (type === "object") return Object.fromEntries(Object.entries(schema.properties || {})
    .filter(([key, field]) => !field.readOnly && (schema.required?.includes(key) || field.default !== undefined))
    .map(([key, field]) => [key, initialSchemaValue(field)]))
  if (type === "array") return Array.from({ length: schema.minItems || 0 }, () => initialSchemaValue(schema.items || {}))
  if (type === "boolean") return false
  if (type === "integer" || type === "number") return schema.minimum ?? 0
  return ""
}

export function withSchemaField(value: unknown, key: string, next: unknown): Record<string, unknown> {
  const result = { ...schemaRecord(value), [key]: next }
  if (next === undefined) delete result[key]
  return result
}

/** Other CEL expressions remain authoritative on the API server. */
export const immutableSchema = (schema: StructuralSchema): boolean => schema["x-kubernetes-validations"]?.some(({ rule }) => /^\s*self\s*==\s*oldSelf\s*$/.test(rule)) === true || schema.allOf?.some(immutableSchema) === true

export function originalArrayItem(schema: StructuralSchema, original: unknown, value: unknown, index: number): unknown {
  if (!Array.isArray(original)) return undefined
  const keys = schema["x-kubernetes-list-map-keys"]
  return keys?.length ? original.find((item) => keys.every((key) => JSON.stringify(schemaRecord(item)[key]) === JSON.stringify(schemaRecord(value)[key]))) : original[index]
}

/** Removing an ancestor must not bypass a descendant's read-only contract. */
export function hasReadOnlyValue(input: StructuralSchema, value: unknown, original?: unknown): boolean {
  if (value === undefined) return false
  const schema = resolvedSchema(input)
  if (schema.readOnly || (original !== undefined && immutableSchema(schema))) return true
  if (Array.isArray(value)) return value.some((item, index) => hasReadOnlyValue(schema.items || {}, item, originalArrayItem(schema, original, item, index)))
  const map = typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined
  return Object.entries(schemaRecord(value)).some(([key, item]) => hasReadOnlyValue(
    Object.prototype.hasOwnProperty.call(schema.properties || {}, key) ? schema.properties![key] : map || {}, item, Object.prototype.hasOwnProperty.call(schemaRecord(original), key) ? schemaRecord(original)[key] : undefined,
  ))
}

export type SchemaIssue = { path: string; message: string; values?: Record<string, string | number> }

/** CEL, admission, and complex union validation remain authoritative on the API server. */
export function schemaIssues(input: StructuralSchema, value: unknown, path = ""): SchemaIssue[] {
  const schema = resolvedSchema(input)
  const issues: SchemaIssue[] = []
  const issue = (message: string, values?: SchemaIssue["values"]) => issues.push({ path, message, values })
  if (value === undefined) return issues
  if (value === null) {
    if (!schema.nullable) issue("This field cannot be null.")
    return issues
  }
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) issue("Choose one of the allowed values.")
  if (schema["x-kubernetes-int-or-string"]) {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isInteger(value))) issue("Enter a string or an integer.")
    return issues
  }
  const type = schemaType(schema, value)
  if ((type === "object" && (typeof value !== "object" || Array.isArray(value))) || (type === "array" && !Array.isArray(value)) ||
    (["string", "boolean", "number", "integer"].includes(type) && typeof value !== (type === "integer" ? "number" : type))) {
    issue("Expected {type}.", { type })
    return issues
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) issue("Enter a valid {type}.", { type })
    if (schema.minimum !== undefined && (schema.exclusiveMinimum ? value <= schema.minimum : value < schema.minimum)) issue("Minimum: {value}.", { value: schema.minimum })
    if (schema.maximum !== undefined && (schema.exclusiveMaximum ? value >= schema.maximum : value > schema.maximum)) issue("Maximum: {value}.", { value: schema.maximum })
  }
  if (typeof value === "string") {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) issue("Use at least {count} characters.", { count: schema.minLength })
    if (schema.maxLength !== undefined && length > schema.maxLength) issue("Use at most {count} characters.", { count: schema.maxLength })
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(value)) issue("Does not match the required pattern.") } catch { /* RE2-only patterns are checked by server dry-run. */ }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issue("Add at least {count} items.", { count: schema.minItems })
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issue("Use at most {count} items.", { count: schema.maxItems })
    if ((schema.uniqueItems || schema["x-kubernetes-list-type"] === "set") && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) issue("Items must be unique.")
    const mapKeys = schema["x-kubernetes-list-map-keys"]
    if (schema["x-kubernetes-list-type"] === "map" && mapKeys?.length && new Set(value.map((item) => JSON.stringify(mapKeys.map((key) => schemaRecord(item)[key])))).size !== value.length) issue("List keys must be unique.")
    value.forEach((item, index) => issues.push(...schemaIssues(schema.items || {}, item, `${path}[${index}]`)))
  } else if (type === "object") {
    const object = schemaRecord(value)
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(object, key) || object[key] === undefined) issues.push({ path: path ? `${path}.${key}` : key, message: "Required field." })
    for (const [key, next] of Object.entries(object)) {
      const field = Object.prototype.hasOwnProperty.call(schema.properties || {}, key) ? schema.properties![key] : typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined
      if (field && !field.readOnly) issues.push(...schemaIssues(field, next, path ? `${path}.${key}` : key))
    }
  }
  return issues
}
