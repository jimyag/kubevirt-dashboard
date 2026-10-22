import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnProviderNetworksConfig: ResourceConfig = {
    id: "provider-networks",
    path: "/networks/kube-ovn/provider-networks",
    title: "Kube-OVN Provider Networks",
    subtitle: "Manage Kube-OVN ProviderNetwork resources",
    listPath: "/apis/kubeovn.io/v1/provider-networks",
    namespaced: false,
    resourcePath: "/apis/kubeovn.io/v1",
    kind: "ProviderNetwork",
    createFields: [
      ...shared.nameOnlyFields("provider-net"),
      { name: "defaultInterface", label: "Default interface", section: "Provider Network", defaultValue: "eth0" },
      { name: "excludeNodes", label: "Exclude nodes", section: "Provider Network", defaultValue: "", placeholder: "comma separated, optional" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "kubeovn.io/v1",
      kind: "ProviderNetwork",
      metadata: { name: shared.stringValue(values.name, "provider-net") },
      spec: { defaultInterface: shared.stringValue(values.defaultInterface, "eth0"), excludeNodes: shared.stringValue(values.excludeNodes).split(",").map((item) => item.trim()).filter(Boolean) },
    }),
    statusPath: ["status", "ready"],
    detailSections: shared.kubeOvnDetailSections,
    extraColumns: [{ label: "Interface", value: (r) => String(shared.getRecord(r.spec).defaultInterface || "N/A") }],
    createTemplate: `apiVersion: kubeovn.io/v1
kind: ProviderNetwork
metadata:
  name: provider-net
spec:
  defaultInterface: eth0
`,
  };
