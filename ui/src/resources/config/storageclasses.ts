import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const storageclassesConfig: ResourceConfig = {
    id: "storageclasses",
    path: "/storage/kubernetes/storage-classes",
    title: "Storage Classes",
    subtitle: "Manage Kubernetes StorageClass provisioner configuration",
    listPath: "/apis/storage.k8s.io/v1/storageclasses",
    namespaced: false,
    resourcePath: "/apis/storage.k8s.io/v1",
    kind: "StorageClass",
    createFields: [
      ...shared.nameOnlyFields("example-storage-class"),
      { name: "provisioner", label: "Provisioner", section: "Provisioner", defaultValue: "kubernetes.io/no-provisioner" },
      { name: "reclaimPolicy", label: "Reclaim policy", section: "Policy", type: "select", defaultValue: "Delete", options: [{ label: "Delete", value: "Delete" }, { label: "Retain", value: "Retain" }] },
      { name: "volumeBindingMode", label: "Volume binding mode", section: "Policy", type: "select", defaultValue: "WaitForFirstConsumer", options: [{ label: "Immediate", value: "Immediate" }, { label: "WaitForFirstConsumer", value: "WaitForFirstConsumer" }] },
      { name: "allowExpansion", label: "Allow volume expansion", section: "Policy", type: "checkbox", defaultValue: true },
      { name: "parameters", label: "Parameters", section: "Provisioner", type: "textarea", defaultValue: "", placeholder: "type=gp3\nfsType=ext4" },
      { name: "mountOptions", label: "Mount options", section: "Mount", type: "textarea", defaultValue: "", placeholder: "discard\nnoatime" },
      { name: "defaultClass", label: "Default storage class", section: "Policy", type: "checkbox", defaultValue: false },
    ],
    buildCreateResource: (values) => {
      const parameters = shared.parseKeyValueText(shared.stringValue(values.parameters));
      const mountOptions = shared.csvList(shared.stringValue(values.mountOptions).replace(/\n/g, ","));
      return {
        apiVersion: "storage.k8s.io/v1",
        kind: "StorageClass",
        metadata: {
          name: shared.stringValue(values.name, "example-storage-class"),
          ...(values.defaultClass === true ? { annotations: { "storageclass.kubernetes.io/is-default-class": "true" } } : {}),
        },
        provisioner: shared.stringValue(values.provisioner, "kubernetes.io/no-provisioner"),
        reclaimPolicy: shared.stringValue(values.reclaimPolicy, "Delete"),
        volumeBindingMode: shared.stringValue(values.volumeBindingMode, "WaitForFirstConsumer"),
        allowVolumeExpansion: values.allowExpansion === true,
        ...(Object.keys(parameters).length ? { parameters } : {}),
        ...(mountOptions.length ? { mountOptions } : {}),
      };
    },
    statusPath: ["provisioner"],
    detailSections: shared.storageClassDetailSections,
    extraColumns: [
      { label: "Provisioner", value: (r) => String(shared.getRecord(r).provisioner || "N/A") },
      { label: "Binding mode", value: (r) => String(shared.getRecord(r).volumeBindingMode || "N/A") },
      { label: "Reclaim", value: (r) => String(shared.getRecord(r).reclaimPolicy || "N/A") },
    ],
    createTemplate: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: example-storage-class
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
`,
  };
