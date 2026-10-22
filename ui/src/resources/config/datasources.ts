import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const datasourcesConfig: ResourceConfig = shared.cdiResourceConfig({
    plural: "datasources",
    path: "/kubevirt/cdi/data-sources",
    title: "DataSources",
    subtitle: "Manage CDI DataSource resources",
    kind: "DataSource",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-datasource"), { name: "sourceKind", label: "Source kind", section: "Source", type: "select", defaultValue: "DataVolume", options: [{ label: "DataVolume", value: "DataVolume" }, { label: "PVC", value: "PVC" }, { label: "VolumeSnapshot", value: "VolumeSnapshot" }] }, { name: "sourceName", label: "Source name", section: "Source", defaultValue: "example-disk" }],
    buildSpec: (values) => ({ source: { [shared.stringValue(values.sourceKind, "DataVolume").toLowerCase()]: { name: shared.stringValue(values.sourceName, "example-disk"), namespace: shared.stringValue(values.namespace, "default") } } }),
    statusPath: ["status", "conditions", "0", "type"],
  });
