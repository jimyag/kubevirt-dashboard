import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnOvnEipsConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "ovn-eips",
    path: "/networks/kube-ovn/ovn-eips",
    title: "Kube-OVN OVN EIPs",
    subtitle: "Manage Kube-OVN OvnEip resources",
    kind: "OvnEip",
    createFields: [
      { name: "externalSubnet", label: "External subnet", section: "EIP", defaultValue: "external-subnet" },
      { name: "v4Ip", label: "IPv4", section: "EIP", defaultValue: "", placeholder: "optional" },
      { name: "type", label: "Type", section: "EIP", type: "select", defaultValue: "nat", options: [{ label: "nat", value: "nat" }, { label: "lrp", value: "lrp" }, { label: "lsp", value: "lsp" }] },
    ],
    buildSpec: (values) => ({ externalSubnet: shared.stringValue(values.externalSubnet), ...(shared.stringValue(values.v4Ip) ? { v4Ip: shared.stringValue(values.v4Ip) } : {}), type: shared.stringValue(values.type, "nat") }),
    statusPath: ["status", "ready"],
    extraColumns: [{ label: "External subnet", value: (r) => String(shared.getRecord(r.spec).externalSubnet || "N/A") }],
  });
