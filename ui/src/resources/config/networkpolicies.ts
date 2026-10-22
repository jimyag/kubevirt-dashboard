import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const networkpoliciesConfig: ResourceConfig = {
    id: "networkpolicies",
    path: "/networks/kubernetes/network-policies",
    title: "Network Policies",
    subtitle: "Manage Kubernetes NetworkPolicy firewall rules",
    listPath: "/apis/networking.k8s.io/v1/networkpolicies",
    namespaced: true,
    resourcePath: "/apis/networking.k8s.io/v1",
    kind: "NetworkPolicy",
    actions: shared.networkPolicyActions,
    createFields: [
      ...shared.namespaceNameFields("example-vm-policy"),
      { name: "selectorKey", label: "Pod selector key", defaultValue: "kubevirt.io/domain" },
      { name: "selectorValue", label: "Pod selector value", defaultValue: "example-vm" },
      { name: "policyType", label: "Policy type", type: "select", defaultValue: "Ingress", options: [{ label: "Ingress", value: "Ingress" }, { label: "Egress", value: "Egress" }, { label: "Ingress and egress", value: "Both" }] },
    ],
    buildCreateResource: (values) => {
      const policyType = shared.stringValue(values.policyType, "Ingress");
      return {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: shared.stringValue(values.name, "example-vm-policy"), namespace: shared.stringValue(values.namespace, "default") },
        spec: {
          podSelector: { matchLabels: { [shared.stringValue(values.selectorKey, "kubevirt.io/domain")]: shared.stringValue(values.selectorValue, "example-vm") } },
          policyTypes: policyType === "Both" ? ["Ingress", "Egress"] : [policyType],
        },
      };
    },
    detailSections: shared.kubernetesNetworkPolicyDetailSections,
    extraColumns: [
      { label: "Policy types", value: (r) => ((r.spec?.policyTypes as string[] | undefined) || []).join(", ") || "N/A" },
    ],
    createTemplate: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: example-vm-policy
  namespace: default
spec:
  podSelector:
    matchLabels:
      kubevirt.io/domain: example-vm
  policyTypes:
    - Ingress
`,
  };
