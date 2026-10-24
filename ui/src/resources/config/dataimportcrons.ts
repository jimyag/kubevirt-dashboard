import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const dataimportcronsConfig: ResourceConfig = shared.cdiResourceConfig({
    plural: "dataimportcrons",
    path: "/kubevirt/cdi/data-import-crons",
    title: "DataImportCrons",
    subtitle: "Manage CDI DataImportCron resources",
    kind: "DataImportCron",
    namespaced: true,
    createFields: [
      ...shared.namespaceNameFields("example-import-cron"),
      { name: "schedule", label: "Schedule", section: "Schedule", defaultValue: "0 0 * * *" },
      { name: "managedDataSource", label: "Managed data source", section: "Source", defaultValue: "example-datasource", required: true },
      { name: "url", label: "Registry URL", section: "Source", defaultValue: "docker://quay.io/kubevirt/cirros-container-disk-demo:latest" },
      { name: "storage", label: "Storage", section: "Storage", defaultValue: "10Gi" },
      { name: "storageClassName", label: "Storage class", section: "Storage", defaultValue: "", placeholder: "optional" },
      { name: "accessMode", label: "Access mode", section: "Storage", type: "select", defaultValue: "ReadWriteOnce", options: [{ label: "ReadWriteOnce", value: "ReadWriteOnce" }, { label: "ReadWriteMany", value: "ReadWriteMany" }, { label: "ReadWriteOncePod", value: "ReadWriteOncePod" }] },
      { name: "volumeMode", label: "Volume mode", section: "Storage", type: "select", defaultValue: "Filesystem", options: [{ label: "Filesystem", value: "Filesystem" }, { label: "Block", value: "Block" }] },
    ],
    buildSpec: (values) => ({ managedDataSource: shared.stringValue(values.managedDataSource), schedule: shared.stringValue(values.schedule, "0 0 * * *"), template: { spec: { source: { registry: { url: shared.stringValue(values.url) } }, storage: { ...(shared.stringValue(values.storageClassName) ? { storageClassName: shared.stringValue(values.storageClassName) } : {}), accessModes: [shared.stringValue(values.accessMode, "ReadWriteOnce")], volumeMode: shared.stringValue(values.volumeMode, "Filesystem"), resources: { requests: { storage: shared.stringValue(values.storage, "10Gi") } } } } } }),
    statusPath: ["status", "conditions", "0", "type"],
  });
