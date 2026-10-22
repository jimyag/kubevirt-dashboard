import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnVpcEgressGatewaysConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "vpc-egress-gateways",
    path: "/networks/kube-ovn/vpc-egress-gateways",
    title: "Kube-OVN VPC Egress Gateways",
    subtitle: "Manage Kube-OVN VpcEgressGateway resources",
    kind: "VpcEgressGateway",
    namespaced: true,
    createFields: [
      { name: "vpc", label: "VPC", section: "Gateway", defaultValue: "ovn-cluster" },
      { name: "externalSubnet", label: "External subnet", section: "Gateway", defaultValue: "external-subnet" },
      { name: "internalSubnet", label: "Internal subnet", section: "Gateway", defaultValue: "example-subnet" },
      { name: "replicas", label: "Replicas", section: "Gateway", type: "number", defaultValue: "1" },
    ],
    buildSpec: (values) => ({ vpc: shared.stringValue(values.vpc), externalSubnet: shared.stringValue(values.externalSubnet), internalSubnet: shared.stringValue(values.internalSubnet), replicas: shared.numberValue(values.replicas, 1) }),
    statusPath: ["status", "ready"],
    extraColumns: [{ label: "External subnet", value: (r) => String(shared.getRecord(r.spec).externalSubnet || "N/A") }],
  });
