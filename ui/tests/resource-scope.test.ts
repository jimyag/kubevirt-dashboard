import { expect, test } from "bun:test"

import { resolveResourceScope, withResourceScope } from "../src/lib/resource-scope"

const variants = [
  { id: "cluster", label: "Cluster", config: "cluster" },
  { id: "namespace", label: "Namespaced", config: "namespace" },
]

test("resource scope uses an explicit value, then the legacy namespace, then the list default", () => {
  expect(resolveResourceScope(variants, "namespace", "_cluster")?.config).toBe("namespace")
  expect(resolveResourceScope(variants, null, "_cluster")?.config).toBe("cluster")
  expect(resolveResourceScope(variants, null, "team-a")?.config).toBe("namespace")
  expect(resolveResourceScope(variants, null, "team-a", true)?.config).toBe("cluster")
})

test("scope links preserve other query parameters", () => {
  expect(withResourceScope("/kubevirt/templates/instance-types?view=compact", "namespace")).toBe(
    "/kubevirt/templates/instance-types?view=compact&scope=namespace",
  )
})
