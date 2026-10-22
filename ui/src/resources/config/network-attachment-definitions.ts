import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const networkAttachmentDefinitionsConfig: ResourceConfig = {
    id: "network-attachment-definitions",
    path: "/networks/kubernetes/nads",
    title: "Network Attachments",
    subtitle: "Manage Multus network attachment definitions",
    listPath: "/apis/k8s.cni.cncf.io/v1/network-attachment-definitions",
    namespaced: true,
    resourcePath: "/apis/k8s.cni.cncf.io/v1",
    kind: "NetworkAttachmentDefinition",
    createFields: [
      ...shared.namespaceNameFields("bridge-network"),
      { name: "type", label: "CNI type", type: "select", defaultValue: "bridge", options: [{ label: "Bridge", value: "bridge" }, { label: "Macvlan", value: "macvlan" }] },
      { name: "bridge", label: "Bridge / master", defaultValue: "br0" },
      { name: "vlan", label: "VLAN", defaultValue: "", placeholder: "optional" },
    ],
    buildCreateResource: (values) => {
      const cniType = shared.stringValue(values.type, "bridge");
      const vlan = shared.stringValue(values.vlan);
      const config = cniType === "macvlan"
        ? { cniVersion: "0.3.1", type: "macvlan", master: shared.stringValue(values.bridge, "eth0"), mode: "bridge", ipam: {} }
        : { cniVersion: "0.3.1", type: "bridge", bridge: shared.stringValue(values.bridge, "br0"), ...(vlan ? { vlan: Number(vlan) } : {}), ipam: {} };
      return {
        apiVersion: "k8s.cni.cncf.io/v1",
        kind: "NetworkAttachmentDefinition",
        metadata: { name: shared.stringValue(values.name, "bridge-network"), namespace: shared.stringValue(values.namespace, "default") },
        spec: { config: JSON.stringify(config, null, 2) },
      };
    },
    detailSections: shared.networkAttachmentDetailSections,
    createTemplate: `apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: bridge-network
  namespace: default
spec:
  config: |
    {
      "cniVersion": "0.3.1",
      "type": "bridge",
      "bridge": "br0",
      "ipam": {}
    }
`,
  };
