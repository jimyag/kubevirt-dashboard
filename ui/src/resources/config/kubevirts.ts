import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubevirtsConfig: ResourceConfig = shared.kubevirtResourceConfig({
    plural: "kubevirts",
    path: "/kubevirt/operations/kubevirts",
    title: "KubeVirt Installations",
    subtitle: "Manage KubeVirt operator KubeVirt resources",
    kind: "KubeVirt",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("kubevirt", "kubevirt"), { name: "useEmulation", label: "Use emulation", section: "Configuration", type: "checkbox", defaultValue: false }],
    buildSpec: (values) => ({ configuration: { developerConfiguration: { useEmulation: values.useEmulation === true } } }),
    statusPath: ["status", "phase"],
    extraColumns: [{ label: "Phase", value: (r) => String(shared.getRecord(r.status).phase || "N/A") }],
  });
