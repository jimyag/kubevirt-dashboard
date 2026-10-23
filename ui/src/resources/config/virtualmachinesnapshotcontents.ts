import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachinesnapshotcontentsConfig: ResourceConfig = shared.snapshotResourceConfig({
    plural: "virtualmachinesnapshotcontents",
    path: "/kubevirt/snapshots/snapshot-contents",
    title: "Snapshot Contents",
    subtitle: "Manage KubeVirt VirtualMachineSnapshotContent resources",
    kind: "VirtualMachineSnapshotContent",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-snapshot-content"), { name: "snapshotName", label: "Snapshot name", section: "Snapshot", defaultValue: "example-snapshot" }, { name: "sourceVm", label: "Source VM", section: "Source", defaultValue: "example-vm" }],
    buildSpec: (values) => ({ virtualMachineSnapshotName: shared.stringValue(values.snapshotName, "example-snapshot"), source: { apiGroup: "kubevirt.io", kind: "VirtualMachine", name: shared.stringValue(values.sourceVm, "example-vm") } }),
    statusPath: ["status", "readyToUse"],
  });
