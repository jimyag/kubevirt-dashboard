import { expect, test } from "bun:test"

const { helmReleasePath } = await import("../src/lib/helm")

test("release paths encode every route segment and tab", () => {
  expect(helmReleasePath({ namespace: "team/a", name: "release?x" }, "values&y")).toBe(
    "/applications/installed/team%2Fa/release%3Fx?tab=values%26y",
  )
})
