import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const volumesnapshotclassesConfig: ResourceConfig = {
    id: "volumesnapshotclasses",
    path: "/storage/kubernetes/volume-snapshot-classes",
    title: "Volume Snapshot Classes",
    subtitle: "Manage CSI VolumeSnapshotClass driver configuration",
    listPath: "/apis/snapshot.storage.k8s.io/v1/volumesnapshotclasses",
    listPathAlternates: ["/apis/snapshot.storage.k8s.io/v1beta1/volumesnapshotclasses", "/apis/snapshot.storage.k8s.io/v1alpha1/volumesnapshotclasses"],
    namespaced: false,
    resourcePath: "/apis/snapshot.storage.k8s.io/v1",
    resourcePathAlternates: ["/apis/snapshot.storage.k8s.io/v1beta1", "/apis/snapshot.storage.k8s.io/v1alpha1"],
    kind: "VolumeSnapshotClass",
    createFields: [
      ...shared.nameOnlyFields("example-snapshot-class"),
      { name: "driver", label: "Driver", section: "Driver", defaultValue: "example.csi.io" },
      { name: "deletionPolicy", label: "Deletion policy", section: "Policy", type: "select", defaultValue: "Delete", options: [{ label: "Delete", value: "Delete" }, { label: "Retain", value: "Retain" }] },
      { name: "parameters", label: "Parameters", section: "Driver", type: "textarea", defaultValue: "", placeholder: "key=value" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "snapshot.storage.k8s.io/v1",
      kind: "VolumeSnapshotClass",
      metadata: { name: shared.stringValue(values.name, "example-snapshot-class") },
      driver: shared.stringValue(values.driver, "example.csi.io"),
      deletionPolicy: shared.stringValue(values.deletionPolicy, "Delete"),
      parameters: shared.parseKeyValueText(shared.stringValue(values.parameters)),
    }),
    statusPath: ["driver"],
    detailSections: shared.volumeSnapshotClassDetailSections,
    extraColumns: [
      { label: "Driver", value: (r) => String(shared.getRecord(r).driver || "N/A") },
      { label: "Deletion", value: (r) => String(shared.getRecord(r).deletionPolicy || "N/A") },
    ],
    createTemplate: `apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: example-snapshot-class
driver: example.csi.io
deletionPolicy: Delete
parameters: {}
`,
  };
