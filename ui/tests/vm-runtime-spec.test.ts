import { expect, test } from "bun:test"

import { diskSize, vmRuntimeSpec, type DV, type VM, type VMI } from "../src/lib/vm-pages"

const metadata = { name: "vm", namespace: "test", uid: "vm-id", creationTimestamp: "2026-10-23T00:00:00Z" }
const vm: VM = { metadata, spec: { template: { spec: { volumes: [{ name: "declared", dataVolume: { name: "declared" } }] } } } }

test("running storage includes hotplugged volumes rather than only the VM template", () => {
  const vmi: VMI = { metadata, spec: { volumes: [{ name: "hotplug", dataVolume: { name: "disk" } }] }, status: { phase: "Running" } }
  expect(vmRuntimeSpec(vm, vmi)?.volumes?.map((volume) => volume.name)).toEqual(["hotplug"])
})

test("stopped VMs use declared storage and an empty live volume list stays empty", () => {
  expect(vmRuntimeSpec(vm)?.volumes?.map((volume) => volume.name)).toEqual(["declared"])
  expect(vmRuntimeSpec(vm, { metadata, spec: { volumes: [] }, status: { phase: "Running" } })?.volumes).toEqual([])
})

test("disk size follows the bound PVC after expansion and retains the creation request before binding", () => {
  const dv: DV = { metadata, spec: { storage: { resources: { requests: { storage: "1Gi" } } } } }
  expect(diskSize(dv, { metadata, spec: { resources: { requests: { storage: "2Gi" } } }, status: { capacity: { storage: "1Gi" } } })).toBe("2Gi")
  expect(diskSize(dv, null)).toBe("1Gi")
  expect(diskSize({ metadata, spec: { pvc: { resources: { requests: { storage: "3Gi" } } } } })).toBe("3Gi")
})
