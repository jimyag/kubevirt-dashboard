import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnIptablesEIPsConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "iptables-eips",
    path: "/networks/kube-ovn/iptables-eips",
    title: "Kube-OVN Iptables EIPs",
    subtitle: "Manage Kube-OVN IptablesEIP resources",
    kind: "IptablesEIP",
    createFields: [
      { name: "natGwDp", label: "NAT gateway", section: "EIP", defaultValue: "vpc-nat-gw" },
      { name: "externalSubnet", label: "External subnet", section: "EIP", defaultValue: "external-subnet" },
      { name: "v4ip", label: "IPv4", section: "EIP", defaultValue: "", placeholder: "optional" },
      { name: "macAddress", label: "MAC address", section: "EIP", defaultValue: "", placeholder: "optional" },
      { name: "qosPolicy", label: "QoS policy", section: "EIP", defaultValue: "", placeholder: "optional" },
    ],
    buildSpec: (values) => ({
      natGwDp: shared.stringValue(values.natGwDp),
      externalSubnet: shared.stringValue(values.externalSubnet),
      ...(shared.stringValue(values.v4ip) ? { v4ip: shared.stringValue(values.v4ip) } : {}),
      ...(shared.stringValue(values.macAddress) ? { macAddress: shared.stringValue(values.macAddress) } : {}),
      ...(shared.stringValue(values.qosPolicy) ? { qosPolicy: shared.stringValue(values.qosPolicy) } : {}),
    }),
    statusPath: ["status", "ready"],
    extraColumns: [
      { label: "External subnet", value: (r) => String(shared.getRecord(r.spec).externalSubnet || "N/A") },
      { label: "NAT gateway", value: (r) => String(shared.getRecord(r.spec).natGwDp || "N/A") },
    ],
  });
