import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const csistoragecapacitiesConfig: ResourceConfig = {
    id: "csistoragecapacities",
    path: "/storage/kubernetes/csi-storage-capacities",
    title: "CSI Storage Capacities",
    subtitle: "Manage per-topology CSI capacity objects used by scheduling",
    listPath: "/apis/storage.k8s.io/v1/csistoragecapacities",
    listPathAlternates: ["/apis/storage.k8s.io/v1beta1/csistoragecapacities", "/apis/storage.k8s.io/v1alpha1/csistoragecapacities"],
    namespaced: true,
    resourcePath: "/apis/storage.k8s.io/v1",
    resourcePathAlternates: ["/apis/storage.k8s.io/v1beta1", "/apis/storage.k8s.io/v1alpha1"],
    kind: "CSIStorageCapacity",
    createFields: [
      ...shared.namespaceNameFields("example-capacity", "default"),
      { name: "storageClassName", label: "Storage class", section: "Capacity", defaultValue: "standard" },
      { name: "capacity", label: "Capacity", section: "Capacity", defaultValue: "100Gi" },
      { name: "maximumVolumeSize", label: "Maximum volume size", section: "Capacity", defaultValue: "", placeholder: "optional" },
      { name: "topologyKey", label: "Topology key", section: "Topology", defaultValue: "", placeholder: "topology.kubernetes.io/zone" },
      { name: "topologyValue", label: "Topology value", section: "Topology", defaultValue: "", placeholder: "us-east-1a" },
    ],
    buildCreateResource: (values) => {
      const maximumVolumeSize = shared.stringValue(values.maximumVolumeSize);
      const topologyKey = shared.stringValue(values.topologyKey);
      const topologyValue = shared.stringValue(values.topologyValue);
      return {
        apiVersion: "storage.k8s.io/v1",
        kind: "CSIStorageCapacity",
        metadata: { name: shared.stringValue(values.name, "example-capacity"), namespace: shared.stringValue(values.namespace, "default") },
        storageClassName: shared.stringValue(values.storageClassName, "standard"),
        capacity: shared.stringValue(values.capacity, "100Gi"),
        ...(maximumVolumeSize ? { maximumVolumeSize } : {}),
        ...(topologyKey && topologyValue ? { nodeTopology: { matchLabels: { [topologyKey]: topologyValue } } } : {}),
      };
    },
    statusPath: ["storageClassName"],
    detailSections: shared.csiStorageCapacityDetailSections,
    extraColumns: [
      { label: "Storage class", value: (r) => String(shared.getRecord(r).storageClassName || "N/A") },
      { label: "Capacity", value: (r) => String(shared.getRecord(r).capacity || "N/A") },
      { label: "Max volume", value: (r) => String(shared.getRecord(r).maximumVolumeSize || "N/A") },
    ],
    createTemplate: `apiVersion: storage.k8s.io/v1
kind: CSIStorageCapacity
metadata:
  name: example-capacity
  namespace: default
storageClassName: standard
capacity: 100Gi
`,
  };
