import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnSecurityGroupsConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "security-groups",
    path: "/networks/kube-ovn/security-groups",
    title: "Kube-OVN Security Groups",
    subtitle: "Manage Kube-OVN SecurityGroup resources",
    kind: "SecurityGroup",
    createFields: [
      { name: "allowSameGroupTraffic", label: "Allow same group traffic", section: "Security Group", type: "checkbox", defaultValue: true },
      { name: "ingressRules", label: "Ingress rules", section: "Security Group", type: "textarea", defaultValue: "", placeholder: "edit detailed rules in manifest" },
    ],
    buildSpec: (values) => ({ allowSameGroupTraffic: values.allowSameGroupTraffic === true }),
    statusPath: ["status", "allowSameGroupTraffic"],
  });
