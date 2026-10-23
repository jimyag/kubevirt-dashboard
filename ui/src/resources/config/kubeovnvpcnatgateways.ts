import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnVpcNatGatewaysConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "vpc-nat-gateways",
    path: "/networks/kube-ovn/vpc-nat-gateways",
    title: "Kube-OVN VPC NAT Gateways",
    subtitle: "Manage Kube-OVN VpcNatGateway resources",
    kind: "VpcNatGateway",
    createFields: [
      { name: "vpc", label: "VPC", section: "Gateway", defaultValue: "", placeholder: "custom VPC name" },
      { name: "subnet", label: "Subnet", section: "Gateway", defaultValue: "", placeholder: "subnet in the VPC" },
      { name: "lanIp", label: "LAN IP", section: "Gateway", defaultValue: "", placeholder: "unused IP in the subnet" },
      { name: "externalSubnets", label: "External subnets", section: "Gateway", defaultValue: "", placeholder: "comma separated, optional" },
      { name: "qosPolicy", label: "QoS policy", section: "Gateway", defaultValue: "", placeholder: "optional" },
    ],
    // VpcNatGateway spec (kubeovn.io/v1): vpc, subnet, lanIp, externalSubnets, qosPolicy, selector, ...
    buildSpec: (values) => {
      const externalSubnets = shared.csvList(values.externalSubnets)
      return {
        vpc: shared.stringValue(values.vpc),
        subnet: shared.stringValue(values.subnet),
        lanIp: shared.stringValue(values.lanIp),
        ...(externalSubnets.length ? { externalSubnets } : {}),
        ...(shared.stringValue(values.qosPolicy) ? { qosPolicy: shared.stringValue(values.qosPolicy) } : {}),
      }
    },
    extraColumns: [
      { label: "VPC", value: (r) => String(shared.getRecord(r.spec).vpc || "N/A") },
      { label: "Subnet", value: (r) => String(shared.getRecord(r.spec).subnet || "N/A") },
    ],
  });
