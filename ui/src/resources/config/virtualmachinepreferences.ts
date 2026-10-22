import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachinepreferencesConfig: ResourceConfig = shared.instancetypeResourceConfig({
    plural: "virtualmachinepreferences",
    path: "/kubevirt/templates/preferences",
    title: "Preferences",
    subtitle: "Manage namespaced KubeVirt VirtualMachinePreference resources",
    kind: "VirtualMachinePreference",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-preference"), { name: "machineType", label: "Machine type", section: "Machine", defaultValue: "q35" }],
    buildSpec: (values) => ({ machine: { preferredMachineType: shared.stringValue(values.machineType, "q35") } }),
  });
