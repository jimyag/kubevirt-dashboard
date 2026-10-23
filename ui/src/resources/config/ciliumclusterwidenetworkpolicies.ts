import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const ciliumClusterwideNetworkPoliciesConfig: ResourceConfig = {
    id: "ciliumclusterwidenetworkpolicies",
    path: "/networks/cilium/clusterwide-network-policies",
    title: "Cilium Clusterwide Policies",
    subtitle: "Manage CiliumClusterwideNetworkPolicy resources",
    listPath: "/apis/cilium.io/v2/ciliumclusterwidenetworkpolicies",
    namespaced: false,
    resourcePath: "/apis/cilium.io/v2",
    kind: "CiliumClusterwideNetworkPolicy",
    createFields: [
      ...shared.nameOnlyFields("example-cilium-cluster-policy"),
      { name: "selectorKey", label: "Endpoint selector key", section: "Selector", defaultValue: "app" },
      { name: "selectorValue", label: "Endpoint selector value", section: "Selector", defaultValue: "example" },
      { name: "cidr", label: "Allowed CIDR", section: "Ingress", defaultValue: "0.0.0.0/0" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "cilium.io/v2",
      kind: "CiliumClusterwideNetworkPolicy",
      metadata: { name: shared.stringValue(values.name, "example-cilium-cluster-policy") },
      spec: { endpointSelector: shared.selectorFromValues(values), ingress: [{ fromCIDR: [shared.stringValue(values.cidr, "0.0.0.0/0")] }] },
    }),
    statusPath: ["status", "conditions", "0", "type"],
    detailSections: shared.ciliumPolicyDetailSections,
    extraColumns: [{ label: "Selector", value: (r) => shared.selectorText(shared.getRecord(shared.getRecord(r.spec).endpointSelector).matchLabels) || "N/A" }],
    createTemplate: `apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: example-cilium-cluster-policy
spec:
  endpointSelector: {}
`,
  };
