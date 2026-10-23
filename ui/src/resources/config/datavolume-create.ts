import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const dvCreateConfig: ResourceConfig = {
  id: "datavolumes",
  path: "/kubevirt/cdi/data-volumes",
  title: "DataVolumes",
  subtitle: "Create a CDI DataVolume",
  listPath: "/apis/cdi.kubevirt.io/v1beta1/datavolumes",
  namespaced: true,
  resourcePath: "/apis/cdi.kubevirt.io/v1beta1",
  kind: "DataVolume",
  createTemplate: "",
  createFields: [
    ...shared.namespaceNameFields("example-disk"),
    { name: "storage", label: "Storage size", section: "Storage", defaultValue: "10Gi" },
    { name: "accessMode", label: "Access mode", section: "Storage", type: "select", defaultValue: "ReadWriteOnce", options: [{ label: "ReadWriteOnce", value: "ReadWriteOnce" }, { label: "ReadWriteMany", value: "ReadWriteMany" }] },
    { name: "volumeMode", label: "Volume mode", section: "Storage", type: "select", defaultValue: "Filesystem", options: [{ label: "Filesystem", value: "Filesystem" }, { label: "Block", value: "Block" }] },
    { name: "storageClassName", label: "Storage class", section: "Storage", defaultValue: "", placeholder: "optional" },
    { name: "sourceType", label: "Source", section: "Source", type: "select", defaultValue: "blank", options: [{ label: "Blank", value: "blank" }, { label: "HTTP image", value: "http" }, { label: "Registry image", value: "registry" }, { label: "PVC clone", value: "pvc" }, { label: "Upload", value: "upload" }] },
    { name: "sourceUrl", label: "HTTP / registry source", section: "Source", defaultValue: "", placeholder: "https://example.com/disk.qcow2 or docker://..." },
    { name: "sourceNamespace", label: "Source PVC namespace", section: "Source", defaultValue: "", placeholder: "for PVC clone" },
    { name: "sourcePvc", label: "Source PVC name", section: "Source", defaultValue: "", placeholder: "for PVC clone" },
  ],
  buildCreateResource: (values) => {
    const storageClassName = shared.stringValue(values.storageClassName);
    const sourceType = shared.stringValue(values.sourceType, "blank");
    const source = sourceType === "http"
      ? { http: { url: shared.stringValue(values.sourceUrl, "https://example.com/disk.qcow2") } }
      : sourceType === "registry"
        ? { registry: { url: shared.stringValue(values.sourceUrl, "docker://quay.io/containerdisks/fedora:latest") } }
        : sourceType === "pvc"
          ? { pvc: { namespace: shared.stringValue(values.sourceNamespace, shared.stringValue(values.namespace, "default")), name: shared.stringValue(values.sourcePvc, "source-pvc") } }
          : sourceType === "upload"
            ? { upload: {} }
            : { blank: {} };
    return {
      apiVersion: "cdi.kubevirt.io/v1beta1",
      kind: "DataVolume",
      metadata: {
        name: shared.stringValue(values.name, "example-disk"),
        namespace: shared.stringValue(values.namespace, "default"),
        labels: { "kubevirt-manager.io/managed": "true" },
      },
      spec: {
        source,
        storage: {
          ...(storageClassName ? { storageClassName } : {}),
          accessModes: [shared.stringValue(values.accessMode, "ReadWriteOnce")],
          volumeMode: shared.stringValue(values.volumeMode, "Filesystem"),
          resources: { requests: { storage: shared.stringValue(values.storage, "10Gi") } },
        },
      },
    };
  },
};
