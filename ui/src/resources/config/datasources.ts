import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const datasourcesConfig: ResourceConfig = shared.cdiResourceConfig({
    plural: "datasources",
    path: "/kubevirt/cdi/data-sources",
    title: "DataSources",
    subtitle: "Manage CDI DataSource resources",
    kind: "DataSource",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-datasource"), { name: "sourceKind", label: "Source kind", section: "Source", type: "select", defaultValue: "pvc", options: [{ label: "PVC", value: "pvc" }, { label: "VolumeSnapshot", value: "snapshot" }, { label: "DataSource", value: "dataSource" }] }, { name: "sourceName", label: "Source name", section: "Source", defaultValue: "example-disk" }],
    buildSpec: (values) => ({ source: { [shared.stringValue(values.sourceKind, "pvc")]: { name: shared.stringValue(values.sourceName, "example-disk"), namespace: shared.stringValue(values.namespace, "default") } } }),
    statusPath: ["status", "conditions", "0", "type"],
  });
