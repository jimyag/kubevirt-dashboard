export type ResourceScopeVariant<T> = { id: string; label: string; config: T }

/** Resolve a scope tab, inferring it from legacy detail URLs when no query parameter is present. */
export function resolveResourceScope<T>(
  variants: Array<ResourceScopeVariant<T>> | undefined,
  requested: string | null,
  namespace?: string,
  list = false,
) {
  if (!variants?.length) return undefined
  const selected = variants.find((variant) => variant.id === requested)
  if (selected) return selected
  const inferred = list ? variants[0].id : namespace === "_cluster" ? "cluster" : "namespace"
  return variants.find((variant) => variant.id === inferred) ?? variants[0]
}

/** Add the scope without dropping unrelated query parameters. */
export function withResourceScope(path: string, scope: string) {
  const [pathname, query = ""] = path.split("?", 2)
  const params = new URLSearchParams(query)
  params.set("scope", scope)
  return `${pathname}?${params.toString()}`
}
