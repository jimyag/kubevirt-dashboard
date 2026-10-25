import { expect, test } from "bun:test"

import { networkPolicyDirectionApplies } from "../src/lib/network-policy"

test("NetworkPolicy follows explicit and defaulted traffic directions", () => {
  expect(networkPolicyDirectionApplies({}, "ingress")).toBe(true)
  expect(networkPolicyDirectionApplies({}, "egress")).toBe(false)
  expect(networkPolicyDirectionApplies({ egress: [] }, "egress")).toBe(true)
  expect(networkPolicyDirectionApplies({ policyTypes: ["Egress"] }, "ingress")).toBe(false)
  expect(networkPolicyDirectionApplies({ policyTypes: ["Egress"] }, "egress")).toBe(true)
})
