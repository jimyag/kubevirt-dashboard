import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const ciliumNodesConfig: ResourceConfig = {
    id: "ciliumnodes",
    path: "/networks/cilium/nodes",
    title: "Cilium Nodes",
    subtitle: "Inspect CiliumNode resources",
    listPath: "/apis/cilium.io/v2/ciliumnodes",
    namespaced: false,
    resourcePath: "/apis/cilium.io/v2",
    kind: "CiliumNode",
    allowCreate: false,
    allowDelete: false,
    statusPath: ["spec", "health", "ipv4"],
    detailSections: (r) => [{ title: "Cilium node", items: [{ label: "Addresses", value: shared.getRecord(r.spec).addresses }, { label: "Health", value: shared.getRecord(r.spec).health }, { label: "IPAM", value: shared.getRecord(r.spec).ipam }, { label: "Encryption", value: shared.getRecord(r.spec).encryption }] }],
    extraColumns: [{ label: "Health IPv4", value: (r) => String(shared.getRecord(shared.getRecord(r.spec).health).ipv4 || "N/A") }],
    createTemplate: `apiVersion: cilium.io/v2
kind: CiliumNode
metadata:
  name: example-node
`,
  };
