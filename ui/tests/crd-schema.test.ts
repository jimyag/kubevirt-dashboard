import { expect, test } from "bun:test"
import { initialSchemaValue, resolvedSchema, schemaIssues, withSchemaField, type StructuralSchema } from "../src/lib/crd-schema"

test("schema defaults preserve zero/false and avoid materializing optional trees", () => {
  const schema: StructuralSchema = { type: "object", required: ["spec"], properties: { spec: { type: "object", required: ["name"], properties: { name: { type: "string" }, replicas: { type: "integer", default: 0 }, enabled: { type: "boolean", default: false }, optional: { type: "object", properties: { nested: { type: "string", default: "unused" } } }, status: { type: "string", default: "server", readOnly: true } } } } }
  expect(initialSchemaValue(schema)).toEqual({ spec: { name: "", replicas: 0, enabled: false } })
  expect(initialSchemaValue({ default: { items: [false, 0, ""] } })).toEqual({ items: [false, 0, ""] })
  expect(initialSchemaValue({ type: "object", properties: { status: { type: "string", default: "business-value" } } })).toEqual({ status: "business-value" })
  expect(initialSchemaValue({ type: "string", enum: ["Kubernetes", "Host"] })).toBe("Kubernetes")
  expect(initialSchemaValue({ type: "integer", enum: [0, 1] })).toBe(0)
})

test("editing one field retains unknown fields and distinguishes removal from empty values", () => {
  const original = { unknown: { preserved: [0, false, ""] }, edited: 1 }
  expect(withSchemaField(original, "edited", 0)).toEqual({ ...original, edited: 0 })
  expect(withSchemaField(original, "edited", "")).toEqual({ ...original, edited: "" })
  expect(withSchemaField(original, "edited", undefined)).toEqual({ unknown: original.unknown })
  expect(Object.hasOwn(withSchemaField({}, "__proto__", "safe"), "__proto__")).toBe(true)
  expect(original.edited).toBe(1)
})

test("schema validation respects required values, integer/string unions and list-map keys", () => {
  const schema: StructuralSchema = { type: "object", required: ["count", "enabled", "name"], properties: { count: { type: "integer", minimum: 0 }, enabled: { type: "boolean" }, name: { type: "string", minLength: 1 }, port: { "x-kubernetes-int-or-string": true }, entries: { type: "array", "x-kubernetes-list-type": "map", "x-kubernetes-list-map-keys": ["name"], items: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } } }
  expect(schemaIssues(schema, { count: 0, enabled: false, name: "a", port: "80", entries: [{ name: "a" }, { name: "b" }] })).toEqual([])
  expect(schemaIssues(schema, { count: 1.5, name: "", port: false, entries: [{ name: "a" }, { name: "a" }] }).map((issue) => issue.path)).toEqual(["enabled", "count", "name", "port", "entries"])
  expect(schemaIssues({ type: "string", nullable: true }, null)).toEqual([])
  expect(schemaIssues({ type: "boolean" }, null)).toHaveLength(1)
  expect(schemaIssues({ type: "object", required: ["constructor"] }, {}).map((issue) => issue.path)).toEqual(["constructor"])
})

test("allOf combines field definitions and required fields", () => {
  const schema = resolvedSchema({ type: "object", required: ["first"], properties: { first: { type: "string" } }, allOf: [{ required: ["second"], properties: { second: { type: "integer" } } }] })
  expect(schema.required).toEqual(["first", "second"])
  expect(Object.keys(schema.properties || {})).toEqual(["first", "second"])
})
