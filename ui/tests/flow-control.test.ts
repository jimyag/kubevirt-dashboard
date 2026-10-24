import { expect, test } from "bun:test"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { flowSchemaSubject } = await import("../src/lib/flow-control")

test("flow subjects preserve identity kind and explicit service account namespaces", () => {
  expect(flowSchemaSubject("User|alice", "default")).toEqual({ kind: "User", user: { name: "alice" } })
  expect(flowSchemaSubject("Group|team", "default")).toEqual({ kind: "Group", group: { name: "team" } })
  expect(flowSchemaSubject(" ServiceAccount | worker | jobs ", "default")).toEqual({ kind: "ServiceAccount", serviceAccount: { name: "worker", namespace: "jobs" } })
  expect(flowSchemaSubject("ServiceAccount|worker", "default")).toEqual({ kind: "ServiceAccount", serviceAccount: { name: "worker", namespace: "default" } })
  for (const invalid of ["Group|", "Unknown|name", "User|name|ns", "Group|name|ns", "User|name|ns|extra"]) {
    expect(() => flowSchemaSubject(invalid, "default")).toThrow("nonempty name")
  }
})
