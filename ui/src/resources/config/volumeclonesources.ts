import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const volumeclonesourcesConfig: ResourceConfig = shared.cdiResourceConfig({ plural: "volumeclonesources", path: "/kubevirt/cdi/volume-clone-sources", title: "VolumeCloneSources", subtitle: "Manage CDI VolumeCloneSource resources", kind: "VolumeCloneSource", namespaced: true, createFields: [...shared.namespaceNameFields("example-clone-source"), { name: "sourceName", label: "Source PVC", section: "Source", defaultValue: "source-pvc" }], buildSpec: (values) => ({ source: { kind: "PersistentVolumeClaim", name: shared.stringValue(values.sourceName, "source-pvc") } }) });
