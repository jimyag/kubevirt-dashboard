import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachineclusterpreferencesConfig: ResourceConfig = shared.instancetypeResourceConfig({
    plural: "virtualmachineclusterpreferences",
    path: "/kubevirt/templates/preferences",
    title: "Preferences",
    subtitle: "Manage KubeVirt VirtualMachineClusterPreference resources",
    kind: "VirtualMachineClusterPreference",
    createFields: [...shared.nameOnlyFields("example-preference"), { name: "machineType", label: "Machine type", section: "Machine", defaultValue: "q35" }, { name: "cpuTopology", label: "Preferred CPU topology", section: "CPU", type: "select", defaultValue: "preferSockets", options: [{ label: "Prefer sockets", value: "preferSockets" }, { label: "Prefer cores", value: "preferCores" }, { label: "Prefer threads", value: "preferThreads" }] }],
    buildSpec: (values) => ({ machine: { preferredMachineType: shared.stringValue(values.machineType, "q35") }, cpu: { preferredCPUTopology: shared.stringValue(values.cpuTopology, "preferSockets") } }),
    statusPath: ["metadata", "name"],
  });
