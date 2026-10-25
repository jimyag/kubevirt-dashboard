import type { ResourceConfig } from "@/components/resource-management";
import { formatStorageSize } from "../../lib/metrics";
import * as shared from "./shared";

export const persistentvolumeclaimsConfig: ResourceConfig = {
    id: "persistentvolumeclaims",
    path: "/storage/kubernetes/persistent-volume-claims",
    title: "PersistentVolumeClaims",
    subtitle: "Manage Kubernetes PersistentVolumeClaim storage requests",
    listPath: "/api/v1/persistentvolumeclaims",
    namespaced: true,
    resourcePath: "/api/v1",
    kind: "PersistentVolumeClaim",
    createFields: [
      ...shared.namespaceNameFields("example-pvc"),
      { name: "storage", label: "Storage", section: "Request", defaultValue: "10Gi" },
      { name: "accessMode", label: "Access mode", section: "Request", type: "select", defaultValue: "ReadWriteOnce", options: [{ label: "ReadWriteOnce", value: "ReadWriteOnce" }, { label: "ReadOnlyMany", value: "ReadOnlyMany" }, { label: "ReadWriteMany", value: "ReadWriteMany" }, { label: "ReadWriteOncePod", value: "ReadWriteOncePod" }] },
      { name: "volumeMode", label: "Volume mode", section: "Request", type: "select", defaultValue: "Filesystem", options: [{ label: "Filesystem", value: "Filesystem" }, { label: "Block", value: "Block" }] },
      { name: "storageClassName", label: "Storage class", section: "Binding", defaultValue: "", placeholder: "optional" },
      { name: "volumeName", label: "Prebound PV", section: "Binding", defaultValue: "", placeholder: "optional" },
      { name: "selectorKey", label: "Selector key", section: "Selector", defaultValue: "", placeholder: "optional" },
      { name: "selectorValue", label: "Selector value", section: "Selector", defaultValue: "", placeholder: "optional" },
    ],
    buildCreateResource: (values) => {
      const storageClassName = shared.stringValue(values.storageClassName);
      const volumeName = shared.stringValue(values.volumeName);
      const selectorKey = shared.stringValue(values.selectorKey);
      const selectorValue = shared.stringValue(values.selectorValue);
      return {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: { name: shared.stringValue(values.name, "example-pvc"), namespace: shared.stringValue(values.namespace, "default") },
        spec: {
          accessModes: [shared.stringValue(values.accessMode, "ReadWriteOnce")],
          volumeMode: shared.stringValue(values.volumeMode, "Filesystem"),
          resources: { requests: { storage: shared.stringValue(values.storage, "10Gi") } },
          ...(storageClassName ? { storageClassName } : {}),
          ...(volumeName ? { volumeName } : {}),
          ...(selectorKey && selectorValue ? { selector: { matchLabels: { [selectorKey]: selectorValue } } } : {}),
        },
      };
    },
    statusPath: ["status", "phase"],
    detailSections: shared.persistentVolumeClaimDetailSections,
    extraColumns: [
      { label: "Phase", value: (r) => String(shared.getRecord(r.status).phase || "N/A") },
      { label: "Storage class", value: (r) => String(shared.getRecord(r.spec).storageClassName || "N/A") },
      { label: "Volume", value: (r) => String(shared.getRecord(r.spec).volumeName || "N/A") },
      { label: "Storage", value: (r) => formatStorageSize(shared.getRecord(shared.getRecord(r.status).capacity).storage || shared.getRecord(shared.getRecord(shared.getRecord(r.spec).resources).requests).storage) },
    ],
    createTemplate: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: example-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  volumeMode: Filesystem
  resources:
    requests:
      storage: 10Gi
`,
  };
