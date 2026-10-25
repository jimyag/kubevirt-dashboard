import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";
import { virtualmachineclusterinstancetypesConfig } from "./virtualmachineclusterinstancetypes";

const namespacedInstanceTypesConfig = shared.instancetypeResourceConfig({
    plural: "virtualmachineinstancetypes",
    path: "/kubevirt/templates/instance-types",
    title: "Instance Types",
    subtitle: "Manage namespaced KubeVirt VirtualMachineInstancetype resources",
    kind: "VirtualMachineInstancetype",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-instancetype"), { name: "cpu", label: "Guest CPUs", section: "Compute", type: "number", defaultValue: "1" }, { name: "memory", label: "Memory", section: "Compute", defaultValue: "1Gi" }],
    buildSpec: (values) => ({ cpu: { guest: shared.numberValue(values.cpu, 1) }, memory: { guest: shared.stringValue(values.memory, "1Gi") } }),
    extraColumns: [{ label: "CPU", value: (r) => String(shared.getRecord(shared.getRecord(r.spec).cpu).guest || "N/A") }, { label: "Memory", value: (r) => String(shared.getRecord(shared.getRecord(r.spec).memory).guest || "N/A") }],
  });

export const virtualmachineinstancetypesConfig: ResourceConfig = {
  ...namespacedInstanceTypesConfig,
  scopeVariants: [
    { id: "cluster", label: "Cluster", config: virtualmachineclusterinstancetypesConfig },
    { id: "namespace", label: "Namespaced", config: namespacedInstanceTypesConfig },
  ],
};
