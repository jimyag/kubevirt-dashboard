import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnOvnFipsConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "ovn-fips",
    path: "/networks/kube-ovn/ovn-fips",
    title: "Kube-OVN OVN FIPs",
    subtitle: "Manage Kube-OVN OvnFip resources",
    kind: "OvnFip",
    createFields: [
      { name: "ovnEip", label: "OVN EIP", section: "FIP", defaultValue: "example-ovn-eip" },
      { name: "ipName", label: "IP name", section: "FIP", defaultValue: "example-ip" },
      { name: "ipType", label: "IP type", section: "FIP", type: "select", defaultValue: "ip", options: [{ label: "ip", value: "ip" }, { label: "vip", value: "vip" }] },
      { name: "type", label: "Mode", section: "FIP", type: "select", defaultValue: "centralized", options: [{ label: "centralized", value: "centralized" }, { label: "distributed", value: "distributed" }] },
    ],
    buildSpec: (values) => ({ ovnEip: shared.stringValue(values.ovnEip), ipName: shared.stringValue(values.ipName), ipType: shared.stringValue(values.ipType, "ip"), type: shared.stringValue(values.type, "centralized") }),
    statusPath: ["status", "ready"],
    extraColumns: [{ label: "OVN EIP", value: (r) => String(shared.getRecord(r.spec).ovnEip || "N/A") }],
  });
