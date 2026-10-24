import { expect, test } from "bun:test"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { formatBytes, formatRate } = await import("../src/lib/metrics")

test("fractional byte rates keep a valid unit", () => {
  expect(formatRate(0.25)).toBe("0 B/s")
  expect(formatRate(0.75)).toBe("1 B/s")
  expect(formatRate(1024)).toBe("1.0 KiB/s")
})

test("byte sizes handle zero, unavailable values and large units", () => {
  expect(formatBytes(0)).toBe("0 B")
  expect(formatBytes(-1)).toBe("0 B")
  expect(formatBytes(Number.NaN)).toBe("0 B")
  expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B")
  expect(formatBytes(1024 ** 5)).toBe("1024 TiB")
})
