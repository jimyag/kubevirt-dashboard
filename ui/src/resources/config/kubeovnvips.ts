import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnVipsConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "vips",
    path: "/networks/kube-ovn/vips",
    title: "Kube-OVN VIPs",
    subtitle: "Manage Kube-OVN Vip resources",
    kind: "Vip",
    createFields: [
      { name: "subnet", label: "Subnet", section: "VIP", defaultValue: "example-subnet" },
      { name: "v4ip", label: "IPv4", section: "VIP", defaultValue: "", placeholder: "optional" },
      { name: "attachSubnets", label: "Attach subnets", section: "VIP", defaultValue: "", placeholder: "comma separated" },
    ],
    buildSpec: (values) => ({ subnet: shared.stringValue(values.subnet), ...(shared.stringValue(values.v4ip) ? { v4ip: shared.stringValue(values.v4ip) } : {}), attachSubnets: shared.csvList(values.attachSubnets) }),
    statusPath: ["spec", "subnet"],
    extraColumns: [{ label: "Subnet", value: (r) => String(shared.getRecord(r.spec).subnet || "N/A") }],
  });
