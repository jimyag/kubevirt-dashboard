import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const persistentvolumesConfig: ResourceConfig = {
    id: "persistentvolumes",
    path: "/storage/kubernetes/persistent-volumes",
    title: "Persistent Volumes",
    subtitle: "Manage Kubernetes PersistentVolume backing storage",
    listPath: "/api/v1/persistentvolumes",
    namespaced: false,
    resourcePath: "/api/v1",
    kind: "PersistentVolume",
    createFields: [
      ...shared.nameOnlyFields("example-pv"),
      { name: "storage", label: "Storage", section: "Capacity", defaultValue: "10Gi" },
      { name: "accessMode", label: "Access mode", section: "Capacity", type: "select", defaultValue: "ReadWriteOnce", options: [{ label: "ReadWriteOnce", value: "ReadWriteOnce" }, { label: "ReadOnlyMany", value: "ReadOnlyMany" }, { label: "ReadWriteMany", value: "ReadWriteMany" }, { label: "ReadWriteOncePod", value: "ReadWriteOncePod" }] },
      { name: "volumeMode", label: "Volume mode", section: "Capacity", type: "select", defaultValue: "Filesystem", options: [{ label: "Filesystem", value: "Filesystem" }, { label: "Block", value: "Block" }] },
      { name: "storageClassName", label: "Storage class", section: "Binding", defaultValue: "", placeholder: "optional" },
      { name: "reclaimPolicy", label: "Reclaim policy", section: "Binding", type: "select", defaultValue: "Retain", options: [{ label: "Retain", value: "Retain" }, { label: "Delete", value: "Delete" }, { label: "Recycle", value: "Recycle" }] },
      { name: "hostPath", label: "Host path", section: "Source", defaultValue: "/mnt/disks/example" },
    ],
    buildCreateResource: (values) => {
      const storageClassName = shared.stringValue(values.storageClassName);
      return {
        apiVersion: "v1",
        kind: "PersistentVolume",
        metadata: { name: shared.stringValue(values.name, "example-pv") },
        spec: {
          capacity: { storage: shared.stringValue(values.storage, "10Gi") },
          accessModes: [shared.stringValue(values.accessMode, "ReadWriteOnce")],
          volumeMode: shared.stringValue(values.volumeMode, "Filesystem"),
          persistentVolumeReclaimPolicy: shared.stringValue(values.reclaimPolicy, "Retain"),
          ...(storageClassName ? { storageClassName } : {}),
          hostPath: { path: shared.stringValue(values.hostPath, "/mnt/disks/example") },
        },
      };
    },
    statusPath: ["status", "phase"],
    detailSections: shared.persistentVolumeDetailSections,
    extraColumns: [
      { label: "Phase", value: (r) => String(shared.getRecord(r.status).phase || "N/A") },
      { label: "Capacity", value: (r) => String(shared.getRecord(shared.getRecord(r.spec).capacity).storage || "N/A") },
      { label: "Storage class", value: (r) => String(shared.getRecord(r.spec).storageClassName || "N/A") },
      { label: "Claim", value: (r) => {
        const claimRef = shared.getRecord(shared.getRecord(r.spec).claimRef);
        return claimRef.name ? `${claimRef.namespace || "default"}/${claimRef.name}` : "N/A";
      } },
    ],
    createTemplate: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: example-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /mnt/disks/example
`,
  };
