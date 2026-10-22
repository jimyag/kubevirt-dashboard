import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const nodesConfig: ResourceConfig = {
    id: "nodes",
    path: "/nodes",
    title: "Nodes",
    subtitle: "Inspect Kubernetes nodes used by KubeVirt workloads",
    listPath: "/api/v1/nodes",
    namespaced: false,
    resourcePath: "/api/v1",
    kind: "Node",
    allowCreate: false,
    allowDelete: false,
    statusPath: ["status", "conditions", "0", "type"],
    detailSections: (r) => {
      const status = shared.getRecord(r.status);
      const spec = shared.getRecord(r.spec);
      const conditions = Array.isArray(status.conditions) ? status.conditions : [];
      const addresses = Array.isArray(status.addresses) ? status.addresses : [];
      const nodeInfo = shared.getRecord(status.nodeInfo);
      const capacity = shared.getRecord(status.capacity);
      const allocatable = shared.getRecord(status.allocatable);
      const resourceKeys = Array.from(new Set([...Object.keys(capacity), ...Object.keys(allocatable)]));
      return [
        {
          title: "Node Status",
          items: [
            { label: "Conditions", value: conditions },
            { label: "Addresses", value: Object.fromEntries(addresses.map((address: Record<string, unknown>) => [address.type || "Address", address.address])) },
            { label: "Kubelet", value: nodeInfo.kubeletVersion },
            { label: "Container runtime", value: nodeInfo.containerRuntimeVersion },
            { label: "OS image", value: nodeInfo.osImage },
            { label: "Architecture", value: nodeInfo.architecture },
          ],
        },
        {
          title: "Resources",
          items: resourceKeys.map((label) => ({
            label,
            value: {
              capacity: capacity[label],
              allocatable: allocatable[label],
            },
          })),
        },
        {
          title: "Scheduling",
          items: [
            { label: "Unschedulable", value: spec.unschedulable || false },
            { label: "Pod CIDR", value: spec.podCIDR },
            { label: "Provider ID", value: spec.providerID },
          ],
        },
      ];
    },
    extraColumns: [
      { label: "CPU", value: (r) => String((r.status?.capacity as Record<string, string> | undefined)?.cpu || "N/A") },
      { label: "Memory", value: (r) => String((r.status?.capacity as Record<string, string> | undefined)?.memory || "N/A") },
    ],
    createTemplate: `apiVersion: v1
kind: Node
metadata:
  name: example-node
`,
  };
