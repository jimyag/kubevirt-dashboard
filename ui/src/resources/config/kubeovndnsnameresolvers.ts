import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnDNSNameResolversConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "dnsnameresolvers",
    path: "/networks/kube-ovn/dns-name-resolvers",
    title: "Kube-OVN DNS Name Resolvers",
    subtitle: "Manage Kube-OVN DNSNameResolver resources",
    kind: "DNSNameResolver",
    createFields: [
      { name: "names", label: "DNS names", section: "Resolver", defaultValue: "example.com", placeholder: "comma separated" },
    ],
    buildSpec: (values) => ({ names: shared.csvList(values.names) }),
    statusPath: ["status", "resolved"],
  });
