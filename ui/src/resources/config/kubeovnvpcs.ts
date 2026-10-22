import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnVpcsConfig: ResourceConfig = {
    id: "vpcs",
    path: "/networks/kube-ovn/vpcs",
    title: "Kube-OVN VPCs",
    subtitle: "Manage Kube-OVN VPC resources",
    listPath: "/apis/kubeovn.io/v1/vpcs",
    namespaced: false,
    resourcePath: "/apis/kubeovn.io/v1",
    kind: "Vpc",
    createFields: [
      ...shared.nameOnlyFields("example-vpc"),
      { name: "namespaces", label: "Namespaces", section: "VPC", defaultValue: "", placeholder: "comma separated, optional" },
      { name: "staticRoutes", label: "Static route CIDR", section: "Routing", defaultValue: "", placeholder: "optional" },
      { name: "nextHopIP", label: "Next hop IP", section: "Routing", defaultValue: "", placeholder: "optional" },
    ],
    buildCreateResource: (values) => {
      const namespaces = shared.stringValue(values.namespaces).split(",").map((item) => item.trim()).filter(Boolean);
      const staticRoutes = shared.stringValue(values.staticRoutes) && shared.stringValue(values.nextHopIP)
        ? [{ cidr: shared.stringValue(values.staticRoutes), nextHopIP: shared.stringValue(values.nextHopIP), policy: "policyDst" }]
        : [];
      return {
        apiVersion: "kubeovn.io/v1",
        kind: "Vpc",
        metadata: { name: shared.stringValue(values.name, "example-vpc") },
        spec: { ...(namespaces.length ? { namespaces } : {}), ...(staticRoutes.length ? { staticRoutes } : {}) },
      };
    },
    statusPath: ["status", "ready"],
    detailSections: shared.kubeOvnDetailSections,
    extraColumns: [{ label: "Namespaces", value: (r) => shared.listNames(shared.getRecord(r.spec).namespaces) || "N/A" }],
    createTemplate: `apiVersion: kubeovn.io/v1
kind: Vpc
metadata:
  name: example-vpc
spec: {}
`,
  };
