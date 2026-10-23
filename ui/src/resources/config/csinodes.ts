import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const csinodesConfig: ResourceConfig = {
    id: "csinodes",
    path: "/storage/kubernetes/csi-nodes",
    title: "CSI Nodes",
    subtitle: "Manage Kubernetes CSINode driver node registrations",
    listPath: "/apis/storage.k8s.io/v1/csinodes",
    listPathAlternates: ["/apis/storage.k8s.io/v1beta1/csinodes", "/apis/storage.k8s.io/v1alpha1/csinodes"],
    namespaced: false,
    resourcePath: "/apis/storage.k8s.io/v1",
    resourcePathAlternates: ["/apis/storage.k8s.io/v1beta1", "/apis/storage.k8s.io/v1alpha1"],
    kind: "CSINode",
    createFields: [
      ...shared.nameOnlyFields("example-node"),
      { name: "driverName", label: "Driver name", section: "Driver", defaultValue: "example.csi.io" },
      { name: "nodeID", label: "Node ID", section: "Driver", defaultValue: "example-node" },
      { name: "topologyKeys", label: "Topology keys", section: "Topology", defaultValue: "", placeholder: "topology.kubernetes.io/zone" },
      { name: "allocatableCount", label: "Allocatable count", section: "Driver", type: "number", defaultValue: "0" },
    ],
    buildCreateResource: (values) => {
      const allocatableCount = shared.numberValue(values.allocatableCount, 0);
      return {
        apiVersion: "storage.k8s.io/v1",
        kind: "CSINode",
        metadata: { name: shared.stringValue(values.name, "example-node") },
        spec: {
          drivers: [{
            name: shared.stringValue(values.driverName, "example.csi.io"),
            nodeID: shared.stringValue(values.nodeID, "example-node"),
            ...(shared.csvList(values.topologyKeys).length ? { topologyKeys: shared.csvList(values.topologyKeys) } : {}),
            ...(allocatableCount > 0 ? { allocatable: { count: allocatableCount } } : {}),
          }],
        },
      };
    },
    statusPath: ["spec", "drivers", "0", "name"],
    detailSections: shared.csiNodeDetailSections,
    extraColumns: [
      { label: "Drivers", value: (r) => String((shared.getRecord(r.spec).drivers as unknown[] | undefined)?.length || 0) },
      { label: "First driver", value: (r) => String(((shared.getRecord(r.spec).drivers as Record<string, unknown>[] | undefined)?.[0]?.name) || "N/A") },
    ],
    createTemplate: `apiVersion: storage.k8s.io/v1
kind: CSINode
metadata:
  name: example-node
spec:
  drivers:
    - name: example.csi.io
      nodeID: example-node
`,
  };
