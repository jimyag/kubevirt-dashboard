import * as YAML from "js-yaml"

/**
 * Serializes an object the way `kubectl get -o yaml` prints it: managedFields hidden (the kubectl
 * default since 1.21), keys sorted, list items not indented under their key, strings that would
 * read as another type double-quoted, multi-line strings as blocks, no line folding.
 */
export const toKubectlYaml = (object: unknown) => {
  if (!object || typeof object !== "object") return ""
  const copy = structuredClone(object) as { metadata?: Record<string, unknown> }
  if (copy.metadata) delete copy.metadata.managedFields
  const text = YAML.dump(copy, { sortKeys: true, noArrayIndent: true, lineWidth: -1, noRefs: true, quotingType: '"' })
  // js-yaml quotes every string starting with "-"; kubectl leaves flags like --v=1 plain. Unquote
  // them when the plain form still reads back as the same string (not a number, no ": " or " #").
  return text
    .replace(/(?<=^\s*(?:- )*(?:\S[^"]*: )?)"(-[A-Za-z-][^"\\]*)"$/gm, (match, value: string) => (/: | #|:$/.test(value) ? match : value))
    // Strings whose only escapes are \" (inline JSON) read better single-quoted, as kubectl prints them.
    .replace(/(?<=^\s*(?:- )*(?:\S[^"]*: )?)"((?:[^"\\]|\\")*\\"(?:[^"\\]|\\")*)"$/gm, (_match, value: string) => `'${value.replace(/\\"/g, '"').replace(/'/g, "''")}'`)
}
