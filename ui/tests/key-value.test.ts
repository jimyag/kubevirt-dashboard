import { expect, test } from "bun:test"
import { keyValueText, parseKeyValueText, parseSpecFields } from "../src/lib/key-value"

test("editable key/value roundtrips preserve multiline, whitespace, quotes and literal escape sequences", () => {
  const values = { multiline: "line one\nline two\r\n", padded: "  text\t ", quoted: '"literal"', empty: "", placeholder: "N/A", equals: "a=b", escaped: String.raw`line\ntext`, unicode: "中文" }
  expect(parseKeyValueText(keyValueText(values))).toEqual(values)
})

test("plain key/value input and malformed quotes remain editable", () => {
  expect(parseKeyValueText('plain=value\nempty=\nequals=a=b\ninvalid="unfinished\nquoted="line\\nnext"')).toEqual({ plain: "value", empty: "", equals: "a=b", invalid: '"unfinished', quoted: "line\nnext" })
  expect(parseKeyValueText("\n=value\n")).toEqual({})
  expect(keyValueText(undefined)).toBe("")
})

test("spec fields preserve explicitly quoted strings alongside typed values", () => {
  expect(parseSpecFields('internalPort="81"\nquotedBoolean="false"\nreplicas=0\nenabled=false\ncleared=null\nname=example\nempty=\nlabels={"app":"test"}\nports=[80,81]\nmultiline="line\\nnext"')).toEqual({ internalPort: "81", quotedBoolean: "false", replicas: 0, enabled: false, cleared: null, name: "example", empty: "", labels: { app: "test" }, ports: [80, 81], multiline: "line\nnext" })
  expect(parseSpecFields('incomplete="unfinished\ninvalidJson=[oops')).toEqual({ incomplete: '"unfinished', invalidJson: "[oops" })
})
