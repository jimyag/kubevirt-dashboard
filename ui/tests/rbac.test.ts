import { expect, test } from "bun:test"

Object.defineProperty(navigator, "language", { value: "en-US", configurable: true })
const { parseRbacEntries, rbacApiGroups, rbacSubject } = await import("../src/lib/rbac")

test("RBAC core API group remains the empty string", () => {
  expect(rbacApiGroups("")).toEqual([""])
  expect(rbacApiGroups("apps, batch")).toEqual(["apps", "batch"])
  expect(rbacApiGroups(",apps")).toEqual(["", "apps"])
})

test("rule roundtrips retain restrictions and non-resource URLs", () => {
  const rules = [{ apiGroups: [""], resources: ["pods"], resourceNames: ["only-this-pod"], verbs: ["get"] }, { nonResourceURLs: ["/metrics"], verbs: ["get"] }]
  expect(parseRbacEntries(JSON.stringify(rules))).toEqual(rules)
  for (const invalid of ["{}", "[null]", "[[]]", "[1]", "invalid"]) {
    expect(() => parseRbacEntries(invalid)).toThrow()
  }
})

test("binding subjects retain apiGroup and only service accounts carry namespace", () => {
  for (const kind of ["User", "Group"]) {
    const subject = rbacSubject(kind, "e2e-subject", "test")
    expect(subject).toEqual({ kind, name: "e2e-subject", apiGroup: "rbac.authorization.k8s.io" })
    expect(parseRbacEntries(JSON.stringify([subject]))).toEqual([subject])
  }
  expect(rbacSubject("ServiceAccount", "e2e", "test")).toEqual({ kind: "ServiceAccount", name: "e2e", namespace: "test" })
})
