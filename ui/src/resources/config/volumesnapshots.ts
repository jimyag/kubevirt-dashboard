import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const volumesnapshotsConfig: ResourceConfig = {
    id: "volumesnapshots",
    path: "/storage/kubernetes/volume-snapshots",
    title: "Volume Snapshots",
    subtitle: "Manage CSI VolumeSnapshot resources for PVC snapshots",
    listPath: "/apis/snapshot.storage.k8s.io/v1/volumesnapshots",
    listPathAlternates: ["/apis/snapshot.storage.k8s.io/v1beta1/volumesnapshots", "/apis/snapshot.storage.k8s.io/v1alpha1/volumesnapshots"],
    namespaced: true,
    resourcePath: "/apis/snapshot.storage.k8s.io/v1",
    resourcePathAlternates: ["/apis/snapshot.storage.k8s.io/v1beta1", "/apis/snapshot.storage.k8s.io/v1alpha1"],
    kind: "VolumeSnapshot",
    createFields: [
      ...shared.namespaceNameFields("example-snapshot"),
      { name: "snapshotClassName", label: "Snapshot class", section: "Snapshot", defaultValue: "", placeholder: "optional" },
      { name: "sourceType", label: "Source type", section: "Source", type: "select", defaultValue: "pvc", options: [{ label: "PVC", value: "pvc" }, { label: "VolumeSnapshotContent", value: "content" }] },
      { name: "sourceName", label: "Source name", section: "Source", defaultValue: "example-pvc" },
    ],
    buildCreateResource: (values) => {
      const snapshotClassName = shared.stringValue(values.snapshotClassName);
      const sourceName = shared.stringValue(values.sourceName, "example-pvc");
      return {
        apiVersion: "snapshot.storage.k8s.io/v1",
        kind: "VolumeSnapshot",
        metadata: { name: shared.stringValue(values.name, "example-snapshot"), namespace: shared.stringValue(values.namespace, "default") },
        spec: {
          ...(snapshotClassName ? { volumeSnapshotClassName: snapshotClassName } : {}),
          source: shared.stringValue(values.sourceType, "pvc") === "content"
            ? { volumeSnapshotContentName: sourceName }
            : { persistentVolumeClaimName: sourceName },
        },
      };
    },
    statusPath: ["status", "readyToUse"],
    detailSections: shared.volumeSnapshotDetailSections,
    extraColumns: [
      { label: "Ready", value: (r) => String(shared.getRecord(r.status).readyToUse ?? "N/A") },
      { label: "Class", value: (r) => String(shared.getRecord(r.spec).volumeSnapshotClassName || "N/A") },
      { label: "Content", value: (r) => String(shared.getRecord(r.status).boundVolumeSnapshotContentName || "N/A") },
    ],
    createTemplate: `apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: example-snapshot
  namespace: default
spec:
  source:
    persistentVolumeClaimName: example-pvc
`,
  };
