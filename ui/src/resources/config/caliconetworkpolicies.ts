import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoNetworkPoliciesConfig: ResourceConfig = {
    id: "networkpolicies",
    path: "/networks/calico/network-policies",
    title: "Calico Network Policies",
    subtitle: "Manage Calico namespaced NetworkPolicy resources",
    listPath: "/apis/crd.projectcalico.org/v1/networkpolicies",
    namespaced: true,
    resourcePath: "/apis/crd.projectcalico.org/v1",
    kind: "NetworkPolicy",
    createFields: [
      ...shared.namespaceNameFields("example-calico-policy"),
      { name: "selector", label: "Selector", section: "Policy", defaultValue: "all()" },
      { name: "types", label: "Types", section: "Policy", type: "select", defaultValue: "Ingress", options: [{ label: "Ingress", value: "Ingress" }, { label: "Egress", value: "Egress" }, { label: "Ingress and egress", value: "Both" }] },
      { name: "action", label: "Action", section: "Rule", type: "select", defaultValue: "Allow", options: [{ label: "Allow", value: "Allow" }, { label: "Deny", value: "Deny" }, { label: "Pass", value: "Pass" }, { label: "Log", value: "Log" }] },
      { name: "protocol", label: "Protocol", section: "Rule", defaultValue: "TCP" },
      { name: "destinationPort", label: "Destination port", section: "Rule", type: "number", defaultValue: "80" },
    ],
    buildCreateResource: (values) => {
      const types = shared.stringValue(values.types, "Ingress") === "Both" ? ["Ingress", "Egress"] : [shared.stringValue(values.types, "Ingress")];
      const rule = { action: shared.stringValue(values.action, "Allow"), protocol: shared.stringValue(values.protocol, "TCP"), destination: { ports: [shared.numberValue(values.destinationPort, 80)] } };
      return {
        apiVersion: "crd.projectcalico.org/v1",
        kind: "NetworkPolicy",
        metadata: { name: shared.stringValue(values.name, "example-calico-policy"), namespace: shared.stringValue(values.namespace, "default") },
        spec: { selector: shared.stringValue(values.selector, "all()"), types, ...(types.includes("Ingress") ? { ingress: [rule] } : {}), ...(types.includes("Egress") ? { egress: [rule] } : {}) },
      };
    },
    statusPath: ["spec", "selector"],
    detailSections: shared.calicoDetailSections,
    extraColumns: [{ label: "Selector", value: (r) => String(shared.getRecord(r.spec).selector || "N/A") }],
    createTemplate: `apiVersion: crd.projectcalico.org/v1
kind: NetworkPolicy
metadata:
  name: example-calico-policy
  namespace: default
spec:
  selector: all()
`,
  };
