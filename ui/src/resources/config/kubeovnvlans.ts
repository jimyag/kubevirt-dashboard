import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnVlansConfig: ResourceConfig = {
    id: "vlans",
    path: "/networks/kube-ovn/vlans",
    title: "Kube-OVN VLANs",
    subtitle: "Manage Kube-OVN Vlan resources",
    listPath: "/apis/kubeovn.io/v1/vlans",
    namespaced: false,
    resourcePath: "/apis/kubeovn.io/v1",
    kind: "Vlan",
    createFields: [
      ...shared.nameOnlyFields("vlan100"),
      { name: "id", label: "VLAN ID", section: "VLAN", type: "number", defaultValue: "100" },
      { name: "provider", label: "Provider network", section: "VLAN", defaultValue: "provider-net" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "kubeovn.io/v1",
      kind: "Vlan",
      metadata: { name: shared.stringValue(values.name, "vlan100") },
      spec: { id: Number(shared.stringValue(values.id, "100")), provider: shared.stringValue(values.provider, "provider-net") },
    }),
    statusPath: ["spec", "id"],
    detailSections: shared.kubeOvnDetailSections,
    extraColumns: [{ label: "VLAN ID", value: (r) => String(shared.getRecord(r.spec).id ?? "N/A") }, { label: "Provider", value: (r) => String(shared.getRecord(r.spec).provider || "N/A") }],
    createTemplate: `apiVersion: kubeovn.io/v1
kind: Vlan
metadata:
  name: vlan100
spec:
  id: 100
  provider: provider-net
`,
  };
