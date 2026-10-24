import { t } from "./i18n"

export const rbacApiGroups = (value: string | boolean | undefined) =>
  String(value || "").split(",").map((group) => group.trim())

export const rbacSubject = (kind: string, name: string, namespace: string) => ({
  kind,
  name,
  ...(kind === "ServiceAccount" ? { namespace } : { apiGroup: "rbac.authorization.k8s.io" }),
})

export function parseRbacEntries(text: string | boolean | undefined): Record<string, unknown>[] {
  const entries: unknown = JSON.parse(String(text || "[]"))
  if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(t("Enter a JSON array of objects."))
  }
  return entries
}
