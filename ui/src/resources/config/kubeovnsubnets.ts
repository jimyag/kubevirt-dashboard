import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnSubnetsConfig: ResourceConfig = {
    id: "subnets",
    path: "/networks/kube-ovn/subnets",
    title: "Kube-OVN Subnets",
    subtitle: "Manage Kube-OVN Subnet resources",
    listPath: "/apis/kubeovn.io/v1/subnets",
    namespaced: false,
    resourcePath: "/apis/kubeovn.io/v1",
    kind: "Subnet",
    createFields: [
      ...shared.nameOnlyFields("example-subnet"),
      { name: "cidrBlock", label: "CIDR block", section: "Subnet", defaultValue: "10.16.0.0/16" },
      { name: "gateway", label: "Gateway", section: "Subnet", defaultValue: "10.16.0.1" },
      { name: "protocol", label: "Protocol", section: "Subnet", type: "select", defaultValue: "IPv4", options: [{ label: "IPv4", value: "IPv4" }, { label: "IPv6", value: "IPv6" }, { label: "Dual", value: "Dual" }] },
      { name: "vpc", label: "VPC", section: "Subnet", defaultValue: "ovn-cluster" },
      { name: "natOutgoing", label: "NAT outgoing", section: "Subnet", type: "checkbox", defaultValue: true },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "kubeovn.io/v1",
      kind: "Subnet",
      metadata: { name: shared.stringValue(values.name, "example-subnet") },
      spec: { cidrBlock: shared.stringValue(values.cidrBlock, "10.16.0.0/16"), gateway: shared.stringValue(values.gateway, "10.16.0.1"), protocol: shared.stringValue(values.protocol, "IPv4"), vpc: shared.stringValue(values.vpc, "ovn-cluster"), natOutgoing: values.natOutgoing === true },
    }),
    statusPath: ["status", "ready"],
    detailSections: shared.kubeOvnDetailSections,
    extraColumns: [{ label: "CIDR", value: (r) => String(shared.getRecord(r.spec).cidrBlock || "N/A") }, { label: "VPC", value: (r) => String(shared.getRecord(r.spec).vpc || "N/A") }],
    createTemplate: `apiVersion: kubeovn.io/v1
kind: Subnet
metadata:
  name: example-subnet
spec:
  cidrBlock: 10.16.0.0/16
`,
  };
