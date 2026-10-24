import { expect, test } from "bun:test"
import { limitrangesConfig } from "../src/resources/config/kubernetes-core"

test("limit ranges keep container defaults and respect Pod/PVC resource bounds", () => {
  const build = limitrangesConfig.buildCreateResource!
  for (const type of ["Container", "Pod", "PersistentVolumeClaim"]) {
    const storage = type === "PersistentVolumeClaim"
    const resource = build({ name: "limits", namespace: "test", type, min: storage ? "storage=1Gi" : "cpu=100m\nmemory=128Mi", max: storage ? "storage=4Gi" : "cpu=2\nmemory=2Gi" })
    const limits = (resource.spec as { limits: Array<{ type: string; default?: unknown; min: unknown; max: unknown }> }).limits[0]
    expect(limits.type).toBe(type)
    expect(limits.default).toEqual(type === "Container" ? { cpu: "500m", memory: "512Mi" } : undefined)
    expect(limits.min).toEqual(storage ? { storage: "1Gi" } : { cpu: "100m", memory: "128Mi" })
    expect(limits.max).toEqual(storage ? { storage: "4Gi" } : { cpu: "2", memory: "2Gi" })
  }
})
