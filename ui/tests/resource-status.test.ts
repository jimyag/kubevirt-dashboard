import { expect, test } from "bun:test"
import { conditionReadiness } from "../src/lib/resource-status"

test("rejected policies and partial Gateway programming never appear healthy", () => {
  expect(conditionReadiness({ ancestors: [{ conditions: [{ type: "Accepted", status: "False", reason: "Invalid" }] }] })).toBe("Accepted (False)")
  expect(conditionReadiness({ conditions: [{ type: "Accepted", status: "True" }, { type: "Programmed", status: "False" }] })).toBe("Programmed (False)")
  expect(conditionReadiness({ parents: [{ conditions: [{ type: "Accepted", status: "True" }, { type: "ResolvedRefs", status: "False" }] }] })).toBe("ResolvedRefs (False)")
})

test("all attached targets contribute to readiness", () => {
  expect(conditionReadiness({ ancestors: [{ conditions: [{ type: "Accepted", status: "True" }] }, { conditions: [{ type: "Accepted", status: "False" }] }] })).toBe("Accepted (False)")
  expect(conditionReadiness({ conditions: [{ type: "Accepted", status: "True" }, { type: "Programmed", status: "True" }] })).toBe("Programmed (True)")
})

test("negative conditions being false are healthy while genuine failure overrides success", () => {
  expect(conditionReadiness({ conditions: [{ type: "Failed", status: "False" }, { type: "Complete", status: "True" }] })).toBe("Complete (True)")
  expect(conditionReadiness({ conditions: [{ type: "MemoryPressure", status: "False" }, { type: "Ready", status: "True" }] })).toBe("Ready")
  expect(conditionReadiness({ conditions: [{ type: "Ready", status: "True" }, { type: "Degraded", status: "True" }] })).toBe("NotReady")
  expect(conditionReadiness({ conditions: [{ type: "Ready", status: "False" }] })).toBe("NotReady")
  expect(conditionReadiness({ conditions: [{ type: "Dangling", status: "False", reason: "Found" }] })).toBe("Ready")
  expect(conditionReadiness({ conditions: [{ type: "Dangling", status: "True", reason: "NotFound" }] })).toBe("NotReady")
})

test("stale generations cannot report a successful reconciliation", () => {
  expect(conditionReadiness({ conditions: [{ type: "Ready", status: "True", observedGeneration: 2 }] }, 3)).toBe("Pending")
  expect(conditionReadiness({ conditions: [{ type: "Ready", status: "False", observedGeneration: 2 }, { type: "Ready", status: "True", observedGeneration: 3 }] }, 3)).toBe("Ready")
  expect(conditionReadiness({ conditions: [{ type: "Ready", status: "True" }] }, 3)).toBe("Ready")
  expect(conditionReadiness({})).toBeUndefined()
  expect(conditionReadiness({ conditions: [{ type: "ConcurrencyShared", status: "False" }] })).toBe("Unknown")
  expect(conditionReadiness({ conditions: [{ type: "NoError", status: "True" }] })).toBe("Unknown")
  expect(conditionReadiness({ ready: false })).toBe("NotReady")
  expect(conditionReadiness({ readyToUse: true })).toBe("Ready")
  expect(conditionReadiness({ isReady: false })).toBe("NotReady")
  expect(conditionReadiness({ shared: false })).toBeUndefined()
})
