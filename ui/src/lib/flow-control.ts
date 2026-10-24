import { t } from "./i18n"

export const flowSchemaSubject = (line: string, namespace: string) => {
  const parts = line.split("|").map((value) => value.trim())
  const [kind, name, subjectNamespace] = parts
  if (!name || parts.length > 3 || (kind !== "ServiceAccount" && parts.length !== 2) || !["User", "Group", "ServiceAccount"].includes(kind)) {
    throw new Error(t("Use User, Group or ServiceAccount with a nonempty name."))
  }
  if (kind === "ServiceAccount") return { kind, serviceAccount: { name, namespace: subjectNamespace || namespace } }
  if (kind === "User") return { kind, user: { name } }
  return { kind, group: { name } }
}
