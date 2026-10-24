import { expect, test } from "bun:test"
import type { KubeResource } from "../src/components/resource-management"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { poolActions } = await import("../src/resources/config/shared")

test("pool detach validates ownership and removes only pool cleanup state", async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "" } })
  const owner = { uid: "pool-uid", kind: "VirtualMachinePool", name: "pool", controller: true }
  const otherOwner = { uid: "other-uid", kind: "Other", name: "other" }
  const target = { metadata: { name: "vm", resourceVersion: "42", ownerReferences: [owner, otherOwner], finalizers: ["kubevirt.io/virtualMachineControllerFinalize", "pool.kubevirt.io/finalizer", "example.com/retain"] } }
  globalThis.fetch = (async () => Response.json(target)) as typeof fetch
  const pool: KubeResource = { metadata: { namespace: "test", name: "pool", uid: "pool-uid" }, spec: { selector: { matchLabels: { "custom-pool": "pool" } } } }
  const detach = poolActions.find((action) => action.id === "detach-vm")!
  try {
    const request = await detach.buildRequest(pool, { vmName: "vm", nodeName: "worker" })
    const body = JSON.parse(String(request.options?.body))
    expect(body.metadata.resourceVersion).toBe("42")
    expect(body.metadata.ownerReferences).toEqual([otherOwner])
    expect(body.metadata.finalizers).toEqual(["kubevirt.io/virtualMachineControllerFinalize", "example.com/retain"])
    expect(body.metadata.labels["custom-pool"]).toBeNull()
    expect(body.spec.template.metadata.labels["custom-pool"]).toBeNull()
    expect(body.spec.template.spec.nodeSelector).toEqual({ "kubernetes.io/hostname": "worker" })
    await expect(detach.buildRequest({ ...pool, metadata: { ...pool.metadata, uid: "unrelated-pool" } }, { vmName: "vm", nodeName: "worker" })).rejects.toThrow("not owned")
    await expect(detach.buildRequest(pool, { vmName: "", nodeName: "worker" })).rejects.toThrow("required")
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})
