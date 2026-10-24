import { apiFetch, useAsync } from "@/lib/kube"
import type { StructuralSchema } from "@/lib/crd-schema"

export type CrdDefinition = {
  metadata: { name: string }
  spec: {
    group: string
    scope: string
    names: { plural: string; kind: string }
    versions: Array<{ name: string; served: boolean; storage: boolean; schema?: { openAPIV3Schema?: StructuralSchema } }>
  }
}

export function useCrdSchema(apiVersion: string, plural: string) {
  const { data: schema, error, loading } = useAsync(async () => {
    const [group, version] = apiVersion.split("/")
    if (!version) return undefined
    const response = await apiFetch(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${plural}.${group}`)
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(await response.text())
    const definition = await response.json() as CrdDefinition
    return definition.spec.versions.find((item) => item.name === version && item.served)?.schema?.openAPIV3Schema
  }, undefined as StructuralSchema | undefined, [apiVersion, plural])
  return { schema, error, loading }
}
