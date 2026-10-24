import { expect, spyOn, test } from "bun:test"
import type { ResourceConfig } from "../src/components/resource-management"

test("schema discovery follows served group/version fallbacks and preserves API errors", async () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "" } })
  const { discoverCrdSchema } = await import("../src/lib/crd-discovery")
  const schema = { type: "object", properties: { spec: { type: "object" } } }
  const responses = new Map<string, Response>()
  const calls: string[] = []
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    calls.push(url)
    return responses.get(url)?.clone() || new Response("Not found", { status: 404 })
  })
  const config = { id: "ippools", listPath: "/apis/crd.projectcalico.org/v1/ippools", resourcePath: "/apis/crd.projectcalico.org/v1" } as ResourceConfig
  try {
    responses.set("/apis/apiextensions.k8s.io/v1/customresourcedefinitions/ippools.projectcalico.org", Response.json({ spec: { names: { plural: "ippools", kind: "IPPool" }, scope: "Cluster", versions: [{ name: "v3", served: true, schema: { openAPIV3Schema: schema } }] } }))
    expect(await discoverCrdSchema(config)).toEqual({ schema, listPath: "/apis/projectcalico.org/v3/ippools", resourcePath: "/apis/projectcalico.org/v3", id: "ippools", kind: "IPPool", namespaced: false })
    expect(calls).toHaveLength(2)
    responses.set("/apis/apiextensions.k8s.io/v1/customresourcedefinitions/pools.cilium.io", Response.json({ spec: { names: { plural: "pools", kind: "Pool" }, scope: "Namespaced", versions: [{ name: "v2alpha1", served: false, schema: { openAPIV3Schema: { type: "string" } } }, { name: "v2", served: true, schema: { openAPIV3Schema: schema } }] } }))
    expect((await discoverCrdSchema({ ...config, id: "pools", listPath: "/apis/cilium.io/v2alpha1/pools" }))?.listPath).toBe("/apis/cilium.io/v2/pools")
    expect(await discoverCrdSchema({ ...config, id: "missing", listPath: "/apis/crd.projectcalico.org/v1/missing" })).toBeUndefined()
    responses.set("/apis/apiextensions.k8s.io/v1/customresourcedefinitions/ipamconfigurations.projectcalico.org", Response.json({ spec: { names: { plural: "ipamconfigurations", kind: "IPAMConfiguration" }, scope: "Cluster", versions: [{ name: "v3", served: true, schema: { openAPIV3Schema: schema } }] } }))
    const renamed = await discoverCrdSchema({ ...config, id: "ipamconfigs", listPath: "/apis/crd.projectcalico.org/v1/ipamconfigs", listPathAlternates: ["/apis/projectcalico.org/v3/ipamconfigurations"] })
    expect(renamed?.id).toBe("ipamconfigurations")
    expect(renamed?.kind).toBe("IPAMConfiguration")
    responses.set("/apis/apiextensions.k8s.io/v1/customresourcedefinitions/ippools.crd.projectcalico.org", new Response("Forbidden", { status: 403 }))
    await expect(discoverCrdSchema(config)).rejects.toThrow("Forbidden")
    const before = calls.length
    expect(await discoverCrdSchema({ ...config, schema })).toBeUndefined()
    expect(await discoverCrdSchema({ ...config, listPath: "/api/v1/pods" })).toBeUndefined()
    expect(calls).toHaveLength(before)
  } finally {
    fetch.mockRestore()
    if (storage) Object.defineProperty(globalThis, "localStorage", storage)
    else Reflect.deleteProperty(globalThis, "localStorage")
  }
})
