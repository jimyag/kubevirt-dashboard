import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnQoSPoliciesConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "qos-policies",
    path: "/networks/kube-ovn/qos-policies",
    title: "Kube-OVN QoS Policies",
    subtitle: "Manage Kube-OVN QoSPolicy resources",
    kind: "QoSPolicy",
    createFields: [
      { name: "bandwidthLimitRules", label: "Bandwidth limit rules", section: "QoS", type: "textarea", defaultValue: "", placeholder: "advanced YAML/JSON-like values can be edited in manifest after create" },
    ],
    buildSpec: () => ({}),
    statusPath: ["status", "shared"],
  });
