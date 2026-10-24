import { expect, test } from "bun:test"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { replicaCount } = await import("../src/resources/config/shared")

test("replica counts allow scaling to zero and retain valid counts", () => {
  expect(replicaCount("0")).toBe(0)
  expect(replicaCount("0.0")).toBe(0)
  expect(replicaCount("3")).toBe(3)
})

test("invalid replica counts retain the default instead of scaling to zero", () => {
  for (const value of ["", " ", "-1", "1.5", "Infinity", "invalid", false]) {
    expect(replicaCount(value)).toBe(1)
  }
})
