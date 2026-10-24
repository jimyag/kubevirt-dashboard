import { expect, test } from "bun:test"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { formatBytes, formatRate, formatStorageSize } = await import("../src/lib/metrics")

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

test("storage quantities keep API units and format plain byte counts", () => {
  expect(formatStorageSize("1Gi")).toBe("1Gi")
  expect(formatStorageSize("1138166334")).toBe("1.1 GiB")
  expect(formatStorageSize("0")).toBe("0 B")
  expect(formatStorageSize("")).toBe("N/A")
  expect(formatStorageSize(undefined)).toBe("N/A")
})
