import { expect, test } from "bun:test"
import { certificateRequest, certificateRequestStatus } from "../src/lib/certificates"

test("CSR PEM encoding preserves bytes and Base64 is not encoded twice", () => {
  const pem = "-----BEGIN CERTIFICATE REQUEST-----\nZXhhbXBsZQ==\n-----END CERTIFICATE REQUEST-----\n"
  expect(atob(certificateRequest(pem))).toBe(pem)
  expect(certificateRequest(` ${btoa(pem)}\n`)).toBe(btoa(pem))
})

test("CSR status distinguishes pending approval, issued and failed requests", () => {
  expect(certificateRequestStatus({})).toBe("Pending")
  expect(certificateRequestStatus({ conditions: [{ type: "Approved", status: "False" }] })).toBe("Pending")
  expect(certificateRequestStatus({ conditions: [{ type: "Approved", status: "True" }] })).toBe("Approved")
  expect(certificateRequestStatus({ certificate: "Y2VydA==" })).toBe("Issued")
  for (const type of ["Denied", "Failed"]) {
    expect(certificateRequestStatus({ certificate: "Y2VydA==", conditions: [{ type: "Approved", status: "True" }, { type, status: "True" }] })).toBe(type)
  }
})
