/** Whether a NetworkPolicy controls one traffic direction under Kubernetes' defaulting rules. */
export function networkPolicyDirectionApplies(
  spec: Record<string, unknown>,
  direction: "ingress" | "egress",
): boolean {
  const policyTypes = Array.isArray(spec.policyTypes) ? spec.policyTypes.map(String) : undefined
  if (policyTypes) return policyTypes.includes(direction === "ingress" ? "Ingress" : "Egress")
  return direction === "ingress" || spec.egress !== undefined
}
