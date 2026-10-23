import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const ciliumNetworkPoliciesConfig: ResourceConfig = {
    id: "ciliumnetworkpolicies",
    path: "/networks/cilium/network-policies",
    title: "Cilium Network Policies",
    subtitle: "Manage CiliumNetworkPolicy resources",
    listPath: "/apis/cilium.io/v2/ciliumnetworkpolicies",
    namespaced: true,
    resourcePath: "/apis/cilium.io/v2",
    kind: "CiliumNetworkPolicy",
    createFields: [
      ...shared.namespaceNameFields("example-cilium-policy"),
      { name: "selectorKey", label: "Endpoint selector key", section: "Selector", defaultValue: "app" },
      { name: "selectorValue", label: "Endpoint selector value", section: "Selector", defaultValue: "example" },
      { name: "cidr", label: "Allowed CIDR", section: "Ingress", defaultValue: "0.0.0.0/0" },
      { name: "port", label: "TCP port", section: "Ingress", type: "number", defaultValue: "80" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "cilium.io/v2",
      kind: "CiliumNetworkPolicy",
      metadata: { name: shared.stringValue(values.name, "example-cilium-policy"), namespace: shared.stringValue(values.namespace, "default") },
      spec: {
        endpointSelector: shared.selectorFromValues(values),
        ingress: [{ fromCIDR: [shared.stringValue(values.cidr, "0.0.0.0/0")], toPorts: [{ ports: [{ port: shared.stringValue(values.port, "80"), protocol: "TCP" }] }] }],
      },
    }),
    statusPath: ["status", "conditions", "0", "type"],
    detailSections: shared.ciliumPolicyDetailSections,
    extraColumns: [{ label: "Selector", value: (r) => shared.selectorText(shared.getRecord(shared.getRecord(r.spec).endpointSelector).matchLabels) || "N/A" }],
    createTemplate: `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: example-cilium-policy
  namespace: default
spec:
  endpointSelector: {}
`,
  };
