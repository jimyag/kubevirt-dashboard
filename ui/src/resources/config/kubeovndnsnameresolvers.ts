import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnDNSNameResolversConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "dnsnameresolvers",
    path: "/networks/kube-ovn/dns-name-resolvers",
    title: "Kube-OVN DNS Name Resolvers",
    subtitle: "Manage Kube-OVN DNSNameResolver resources",
    kind: "DNSNameResolver",
    createFields: [
      { name: "dnsName", label: "DNS name (FQDN)", section: "Resolver", defaultValue: "example.com.", placeholder: "example.com." },
    ],
    buildSpec: (values) => ({ name: shared.stringValue(values.dnsName) }),
    statusPath: ["status", "resolved"],
  });
