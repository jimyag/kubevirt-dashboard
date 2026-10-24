import { expect, test } from "bun:test"
import type { KubeObject } from "../src/lib/kube"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { extraNicSpec, vmOvnProviders, vmOvnAnnotationPatch, vmSubnets, removeVmNic } = await import("../src/lib/vm-network")
const { setVmSecurityGroups, setVmSecurityGroupRefs, vmSecurityGroups } = await import("../src/lib/security-groups")

const vm: KubeObject = { metadata: { namespace: "test", name: "vm" }, spec: { template: { spec: { networks: [{ name: "default", pod: {} }, { name: "nic1", multus: { networkName: "attached" } }] } } } }
const nads: KubeObject[] = [
  { metadata: { namespace: "test", name: "attached" }, spec: { config: JSON.stringify({ type: "kube-ovn", provider: "custom.test.ovn" }) } },
  { metadata: { namespace: "other", name: "attached" }, spec: { config: JSON.stringify({ type: "kube-ovn", provider: "unrelated.ovn" }) } },
]

test("OVN providers follow attached NADs and preserve the primary provider", () => {
  expect(vmOvnProviders(vm, nads)).toEqual(["ovn", "custom.test.ovn"])
  expect(vmOvnProviders(vm, [{ ...nads[0], spec: { config: '{"type":"bridge"}' } }])).toEqual(["ovn"])
  expect(vmOvnProviders(vm, [{ ...nads[0], spec: { config: '{"type":"kube-ovn"}' } }])).toEqual(["ovn", "attached.test.ovn"])
})

test("subnet membership includes every attached OVN network and counts duplicate subnets once", () => {
  const selected: KubeObject = { ...vm, spec: { template: { metadata: { annotations: { "ovn.kubernetes.io/logical_switch": "primary", "custom.test.ovn.kubernetes.io/logical_switch": "secondary", "other.test.ovn.kubernetes.io/logical_switch": "secondary", "unrelated": "ignored" } } } } }
  expect(vmSubnets(selected)).toEqual(["primary", "secondary"])
  expect(vmSubnets(vm)).toEqual([])
})

test("security group reads include secondary-only annotations without duplicates", () => {
  const selected: KubeObject = { ...vm, spec: { template: { metadata: { annotations: { "ovn.kubernetes.io/security_groups": "shared", "custom.test.ovn.kubernetes.io/security_groups": "shared,secondary" } } } } }
  expect(vmSecurityGroups(selected, "kube-ovn")).toEqual(["shared", "secondary"])
})

test("new attached NICs inherit security and bandwidth settings without copying the primary subnet", () => {
  const result = extraNicSpec([{ name: "nic1", network: { value: "attached", nad: "test/attached", provider: "custom.test.ovn", subnet: "secondary", cniType: "kube-ovn" } }], {
    "ovn.kubernetes.io/logical_switch": "primary",
    "ovn.kubernetes.io/security_groups": "sg",
    "ovn.kubernetes.io/port_security": "true",
    "ovn.kubernetes.io/ingress_rate": "10",
  })
  expect(result.annotations).toEqual({ "custom.test.ovn.kubernetes.io/logical_switch": "secondary", "custom.test.ovn.kubernetes.io/security_groups": "sg", "custom.test.ovn.kubernetes.io/port_security": "true", "custom.test.ovn.kubernetes.io/ingress_rate": "10" })
})

test("live updates target canonical virt-launcher labels and propagate pod failures", async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const calls: Array<{ url: string; body?: unknown }> = []
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "" } })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith("network-attachment-definitions")) return Response.json({ items: nads })
    if (url.includes("pods?")) return Response.json({ items: [{ metadata: { name: "pool-launcher", namespace: "test" } }] })
    if (url.endsWith("pods/pool-launcher")) return new Response("pod patch denied", { status: 403 })
    return Response.json({})
  }) as typeof fetch
  try {
    const patch = await vmOvnAnnotationPatch(vm, { security_groups: "sg", ingress_rate: "10" })
    expect(patch["custom.test.ovn.kubernetes.io/security_groups"]).toBe("sg")
    expect(patch["custom.test.ovn.kubernetes.io/ingress_rate"]).toBe("10")
    await expect(setVmSecurityGroups(vm, "kube-ovn", ["sg"])).rejects.toThrow("pod patch denied")
    const selected: KubeObject = { ...vm, spec: { ...vm.spec, template: { ...(vm.spec?.template as object), metadata: { annotations: { "ovn.kubernetes.io/security_groups": "sg" } } } } }
    await expect(setVmSecurityGroupRefs(selected, ["kube-ovn"], [{ provider: "kube-ovn", name: "sg" }])).rejects.toThrow("pod patch denied")
    expect(calls.some((call) => decodeURIComponent(call.url).includes("labelSelector=kubevirt.io/domain=vm"))).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})

test("NIC removal clears unused provider settings and retains settings shared by another interface", async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const patches: Array<{ spec: { template: { metadata?: { annotations: Record<string, null> }; spec: { networks: unknown[] } } } }> = []
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "" } })
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.body) patches.push(JSON.parse(String(init.body)))
    return Response.json({ items: nads })
  }) as typeof fetch
  const annotations = { "custom.test.ovn.kubernetes.io/logical_switch": "secondary", "custom.test.ovn.kubernetes.io/security_groups": "sg", "custom.test.ovn.kubernetes.io/ingress_rate": "10", "ovn.kubernetes.io/security_groups": "primary" }
  const selected: KubeObject = { ...vm, spec: { template: { metadata: { annotations }, spec: { networks: [{ name: "default", pod: {} }, { name: "nic1", multus: { networkName: "attached" } }], domain: { devices: { interfaces: [{ name: "default", masquerade: {} }, { name: "nic1", bridge: {} }] } } } } } }
  try {
    await removeVmNic(selected, "nic1", "custom.test.ovn")
    expect(patches[0].spec.template.metadata?.annotations).toEqual({ "custom.test.ovn.kubernetes.io/logical_switch": null, "custom.test.ovn.kubernetes.io/security_groups": null, "custom.test.ovn.kubernetes.io/ingress_rate": null })
    expect(patches[0].spec.template.spec.networks).toEqual([{ name: "default", pod: {} }])
    const shared = structuredClone(selected)
    ;(shared.spec!.template as { spec: { networks: unknown[] } }).spec.networks.push({ name: "nic2", multus: { networkName: "attached" } })
    await removeVmNic(shared, "nic1", "custom.test.ovn")
    expect(patches[1].spec.template.metadata).toBeUndefined()
    expect(patches[1].spec.template.spec.networks).toContainEqual({ name: "nic2", multus: { networkName: "attached" } })
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})
