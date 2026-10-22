import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnOvnDnatRulesConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "ovn-dnat-rules",
    path: "/networks/kube-ovn/ovn-dnat-rules",
    title: "Kube-OVN OVN DNAT Rules",
    subtitle: "Manage Kube-OVN OvnDnatRule resources",
    kind: "OvnDnatRule",
    createFields: [
      { name: "ovnEip", label: "OVN EIP", section: "DNAT", defaultValue: "example-ovn-eip" },
      { name: "ipName", label: "IP Name", section: "DNAT", defaultValue: "", placeholder: "Kube-OVN IP object, e.g. vm.namespace" },
      { name: "ipType", label: "IP Type", section: "DNAT", type: "select", defaultValue: "ip", options: [{ label: "ip", value: "ip" }, { label: "vip", value: "vip" }] },
      { name: "externalPort", label: "External Port", section: "DNAT", defaultValue: "8080" },
      { name: "internalPort", label: "Internal Port", section: "DNAT", defaultValue: "80" },
      { name: "protocol", label: "Protocol", section: "DNAT", type: "select", defaultValue: "tcp", options: [{ label: "tcp", value: "tcp" }, { label: "udp", value: "udp" }] },
    ],
    buildSpec: (values) => ({ ovnEip: shared.stringValue(values.ovnEip), ipName: shared.stringValue(values.ipName), ipType: shared.stringValue(values.ipType, "ip"), externalPort: shared.stringValue(values.externalPort), internalPort: shared.stringValue(values.internalPort), protocol: shared.stringValue(values.protocol, "tcp") }),
    statusPath: ["status", "ready"],
    extraColumns: [{ label: "EIP", value: (r) => String(shared.getRecord(r.spec).ovnEip || "N/A") }],
  });
