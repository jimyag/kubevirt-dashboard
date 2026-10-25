import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";
import { virtualmachineclusterpreferencesConfig } from "./virtualmachineclusterpreferences";

const namespacedPreferencesConfig = shared.instancetypeResourceConfig({
    plural: "virtualmachinepreferences",
    path: "/kubevirt/templates/preferences",
    title: "Preferences",
    subtitle: "Manage namespaced KubeVirt VirtualMachinePreference resources",
    kind: "VirtualMachinePreference",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-preference"), { name: "machineType", label: "Machine type", section: "Machine", defaultValue: "q35" }],
    buildSpec: (values) => ({ machine: { preferredMachineType: shared.stringValue(values.machineType, "q35") } }),
  });

export const virtualmachinepreferencesConfig: ResourceConfig = {
  ...namespacedPreferencesConfig,
  scopeVariants: [
    { id: "cluster", label: "Cluster", config: virtualmachineclusterpreferencesConfig },
    { id: "namespace", label: "Namespaced", config: namespacedPreferencesConfig },
  ],
};
