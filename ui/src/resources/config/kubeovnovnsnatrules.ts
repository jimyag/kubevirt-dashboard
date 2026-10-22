import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnOvnSnatRulesConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "ovn-snat-rules",
    path: "/networks/kube-ovn/ovn-snat-rules",
    title: "Kube-OVN OVN SNAT Rules",
    subtitle: "Manage Kube-OVN OvnSnatRule resources",
    kind: "OvnSnatRule",
    createFields: [
      { name: "ovnEip", label: "OVN EIP", section: "SNAT", defaultValue: "example-ovn-eip" },
      { name: "vpcSubnet", label: "Subnet name", section: "SNAT", defaultValue: "", placeholder: "subnet to SNAT" },
      { name: "ipName", label: "IP name", section: "SNAT", defaultValue: "", placeholder: "or a single IP object" },
    ],
    buildSpec: (values) => ({
      ovnEip: shared.stringValue(values.ovnEip),
      ...(shared.stringValue(values.vpcSubnet) ? { vpcSubnet: shared.stringValue(values.vpcSubnet) } : { ipName: shared.stringValue(values.ipName) }),
    }),
    statusPath: ["status", "ready"],
    extraColumns: [{ label: "EIP", value: (r) => String(shared.getRecord(r.spec).ovnEip || "N/A") }],
  });
