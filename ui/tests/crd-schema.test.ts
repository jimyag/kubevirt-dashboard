import { expect, test } from "bun:test"
import { hasReadOnlyValue, immutableSchema, originalArrayItem, initialSchemaValue, resolvedSchema, schemaIssues, withSchemaField, type StructuralSchema } from "../src/lib/crd-schema"
import { humanizeKey } from "../src/lib/detail-values"

test("generated field labels preserve acronym plurals and split following words", () => {
  expect(humanizeKey("podIPs")).toBe("Pod IPs")
  expect(humanizeKey("destinationCIDRs")).toBe("Destination CIDRs")
  expect(humanizeKey("loadBalancerIPs")).toBe("Load balancer IPs")
  expect(humanizeKey("allowedCIDRsList")).toBe("Allowed CIDRs list")
  expect(humanizeKey("cidrs")).toBe("CIDRs")
  expect(humanizeKey("HTTPRoute")).toBe("HTTP route")
  expect(humanizeKey("lanIp")).toBe("LAN IP")
})

test("present read-only descendants protect ancestors including array and map entries", () => {
  const schema: StructuralSchema = { properties: { spec: { allOf: [{ properties: { locked: { readOnly: true }, editable: { type: "string" } } }] } } }
  for (const locked of [false, 0, "", null]) expect(hasReadOnlyValue(schema, { spec: { locked } })).toBe(true)
  expect(hasReadOnlyValue(schema, { spec: { editable: "value" } })).toBe(false)
  expect(hasReadOnlyValue(schema, {})).toBe(false)
  expect(hasReadOnlyValue({ items: schema }, [{ spec: { locked: false } }])).toBe(true)
  expect(hasReadOnlyValue({ additionalProperties: schema }, { entry: { spec: { locked: 0 } } })).toBe(true)
  expect(hasReadOnlyValue({ readOnly: true }, undefined)).toBe(false)
})

test("CEL immutable fields lock existing values while creation and new keyed items stay editable", () => {
  const field: StructuralSchema = { type: "string", "x-kubernetes-validations": [{ rule: " self == oldSelf ", message: "immutable" }] }
  expect(immutableSchema(field)).toBe(true)
  expect(immutableSchema({ allOf: [field, { "x-kubernetes-validations": [{ rule: "self.size() > 0" }] }] })).toBe(true)
  expect(immutableSchema({ "x-kubernetes-validations": [{ rule: "self >= oldSelf" }] })).toBe(false)
  for (const value of [false, 0, "", null]) expect(hasReadOnlyValue(field, value, value)).toBe(true)
  expect(hasReadOnlyValue(field, "new")).toBe(false)
  const schema: StructuralSchema = { type: "array", "x-kubernetes-list-map-keys": ["name"], items: { type: "object", properties: { token: field } } }
  const original = [{ name: "one", token: "a" }, { name: "two", token: "b" }]
  expect(originalArrayItem(schema, original, { name: "two" }, 0)).toEqual(original[1])
  expect(originalArrayItem(schema, original, { name: "new" }, 0)).toBeUndefined()
  expect(hasReadOnlyValue(schema, [{ name: "two", token: "b" }], original)).toBe(true)
  expect(hasReadOnlyValue(schema, [{ name: "new", token: "c" }], original)).toBe(false)
  expect(hasReadOnlyValue({ additionalProperties: field }, { saved: "a" }, { saved: "a" })).toBe(true)
  expect(hasReadOnlyValue({ additionalProperties: field }, { added: "b" }, {})).toBe(false)
  expect(hasReadOnlyValue({ additionalProperties: field }, { constructor: "new" }, {})).toBe(false)
})

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
