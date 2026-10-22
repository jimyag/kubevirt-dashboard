import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoStagedKubernetesNetworkPoliciesConfig: ResourceConfig = shared.calicoResourceConfig({
    plural: "stagedkubernetesnetworkpolicies",
    path: "/networks/calico/staged-kubernetes-network-policies",
    title: "Calico Staged Kubernetes Policies",
    subtitle: "Manage staged Kubernetes NetworkPolicy resources in Calico",
    kind: "StagedKubernetesNetworkPolicy",
    namespaced: true,
    createFields: [{ name: "selectorKey", label: "Pod selector key", section: "Policy", defaultValue: "app" }, { name: "selectorValue", label: "Pod selector value", section: "Policy", defaultValue: "example" }],
    buildSpec: (values) => ({ podSelector: shared.selectorFromValues(values), policyTypes: ["Ingress"] }),
    statusPath: ["spec", "policyTypes", "0"],
  });
