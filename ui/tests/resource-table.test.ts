import { expect, test } from "bun:test"
import { resourceTable } from "../src/lib/resource-table"
import type { KubeResource } from "../src/components/resource-management"

const object: KubeResource = { apiVersion: "example.test/v1", kind: "Example", metadata: { name: "example", uid: "uid" }, spec: { untouched: { enabled: false } } }

test("server printer columns retain false, zero and empty values without modifying resource objects", () => {
  const table = resourceTable({ kind: "Table", columnDefinitions: [{ name: "Name" }, { name: "Shared" }, { name: "Count" }, { name: "Value" }, { name: "Wide", priority: 1 }, { name: "Age" }], rows: [{ object, cells: ["example", false, 0, "", "hidden", "1h"] }] }, () => "Active")
  expect(table.items[0]).toBe(object)
  expect(table.columns?.map((column) => [column.label, column.value(object)])).toEqual([["Shared", "false"], ["Count", "0"], ["Value", '""']])
  expect(object.spec).toEqual({ untouched: { enabled: false } })
  expect(Object.keys(object)).toEqual(["apiVersion", "kind", "metadata", "spec"])
})

test("printer readiness fills missing status but cannot override termination or pending reconciliation", () => {
  const payload = { kind: "Table", columnDefinitions: [{ name: "Name" }, { name: "Ready" }], rows: [{ object, cells: ["example", false] }] }
  expect(resourceTable(payload, () => "Active").status?.(object)).toBe("NotReady")
  expect(resourceTable(payload, () => "Terminating").status?.(object)).toBe("Terminating")
  expect(resourceTable(payload, () => "Pending").status?.(object)).toBe("Pending")
  expect(resourceTable({ ...payload, rows: [{ object, cells: ["example", true] }] }, () => "Unknown").status?.(object)).toBe("Ready")
})

test("normal list responses remain usable and incomplete Table objects fail visibly", () => {
  expect(resourceTable({ kind: "ExampleList", items: [object] }, () => "Active")).toEqual({ items: [object] })
  expect(() => resourceTable({ kind: "Table", rows: [{ cells: ["example"] }] }, () => "Active")).toThrow("Kubernetes table did not include resource objects.")
})
