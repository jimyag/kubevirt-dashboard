import { apiFetch, useAsync } from "./kube"
import type { StructuralSchema } from "./crd-schema"
import { expandListPaths, apiVersionFromListPath, resourceNameFromListPath } from "../resources/api-paths"
import type { ResourceConfig } from "../components/resource-management"

export type CrdDefinition = {
  metadata: { name: string }
  spec: {
    group: string
    scope: string
    names: { plural: string; kind: string }
    versions: Array<{ name: string; served: boolean; storage: boolean; schema?: { openAPIV3Schema?: StructuralSchema } }>
  }
}

export async function discoverCrdSchema(config: ResourceConfig) {
  if (config.schema) return undefined
  const paths = expandListPaths(config)
  const checked = new Set<string>()
  for (const candidate of paths) {
    const [group, candidateVersion] = apiVersionFromListPath(candidate).split("/")
    if (!candidateVersion) continue
    const plural = resourceNameFromListPath(candidate, config.id)
    const name = `${plural}.${group}`
    if (checked.has(name)) continue
    checked.add(name)
    const response = await apiFetch(`/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${name}`)
    if (response.status === 404) continue
    if (!response.ok) throw new Error(await response.text())
    const definition = await response.json() as CrdDefinition
    for (const listPath of paths) {
      const [pathGroup, version] = apiVersionFromListPath(listPath).split("/")
      if (pathGroup !== group || resourceNameFromListPath(listPath, config.id) !== plural) continue
      const schema = definition.spec.versions.find((item) => item.name === version && item.served)?.schema?.openAPIV3Schema
      if (schema) return { schema, listPath, resourcePath: `/apis/${group}/${version}`, id: definition.spec.names.plural, kind: definition.spec.names.kind, namespaced: definition.spec.scope === "Namespaced" }
    }
  }
  return undefined
}

export function useCrdSchema(config: ResourceConfig) {
  const result = useAsync(() => discoverCrdSchema(config), undefined as Awaited<ReturnType<typeof discoverCrdSchema>>, [config])
  return { ...result, schema: result.data?.schema }
}
