import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoGlobalNetworkPoliciesConfig: ResourceConfig = {
    id: "globalnetworkpolicies",
    path: "/networks/calico/global-network-policies",
    title: "Calico Global Network Policies",
    subtitle: "Manage Calico cluster-scoped GlobalNetworkPolicy resources",
    listPath: "/apis/crd.projectcalico.org/v1/globalnetworkpolicies",
    namespaced: false,
    resourcePath: "/apis/crd.projectcalico.org/v1",
    kind: "GlobalNetworkPolicy",
    createFields: [
      ...shared.nameOnlyFields("example-global-policy"),
      { name: "selector", label: "Selector", section: "Policy", defaultValue: "all()" },
      { name: "order", label: "Order", section: "Policy", type: "number", defaultValue: "100" },
      { name: "types", label: "Types", section: "Policy", type: "select", defaultValue: "Ingress", options: [{ label: "Ingress", value: "Ingress" }, { label: "Egress", value: "Egress" }, { label: "Ingress and egress", value: "Both" }] },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "crd.projectcalico.org/v1",
      kind: "GlobalNetworkPolicy",
      metadata: { name: shared.stringValue(values.name, "example-global-policy") },
      spec: { selector: shared.stringValue(values.selector, "all()"), order: shared.numberValue(values.order, 100), types: shared.stringValue(values.types, "Ingress") === "Both" ? ["Ingress", "Egress"] : [shared.stringValue(values.types, "Ingress")] },
    }),
    statusPath: ["spec", "selector"],
    detailSections: shared.calicoDetailSections,
    extraColumns: [{ label: "Order", value: (r) => String(shared.getRecord(r.spec).order || "N/A") }],
    createTemplate: `apiVersion: crd.projectcalico.org/v1
kind: GlobalNetworkPolicy
metadata:
  name: example-global-policy
spec:
  selector: all()
`,
  };
