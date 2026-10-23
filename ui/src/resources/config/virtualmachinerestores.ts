import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachinerestoresConfig: ResourceConfig = {
    id: "virtualmachinerestores",
    path: "/kubevirt/snapshots/restores",
    title: "Restores",
    subtitle: "Restore VMs from KubeVirt snapshots",
    listPath: "/apis/snapshot.kubevirt.io/v1beta1/virtualmachinerestores",
    namespaced: true,
    resourcePath: "/apis/snapshot.kubevirt.io/v1beta1",
    kind: "VirtualMachineRestore",
    createFields: [
      ...shared.namespaceNameFields("example-restore"),
      { name: "targetVm", label: "Target VM", defaultValue: "example-vm", required: true },
      { name: "snapshotName", label: "Snapshot name", defaultValue: "example-snapshot", required: true },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "snapshot.kubevirt.io/v1beta1",
      kind: "VirtualMachineRestore",
      metadata: { name: shared.stringValue(values.name, "example-restore"), namespace: shared.stringValue(values.namespace, "default") },
      spec: {
        target: { apiGroup: "kubevirt.io", kind: "VirtualMachine", name: shared.stringValue(values.targetVm, "example-vm") },
        virtualMachineSnapshotName: shared.stringValue(values.snapshotName, "example-snapshot"),
      },
    }),
    detailSections: (r) => {
      const spec = shared.getRecord(r.spec);
      const status = shared.getRecord(r.status);
      return [{
        title: "Restore",
        items: [
          { label: "Snapshot", value: spec.virtualMachineSnapshotName },
          { label: "Target kind", value: shared.getRecord(spec.target).kind },
          { label: "Target VM", value: shared.getRecord(spec.target).name },
          { label: "Complete", value: status.complete },
          { label: "Restore time", value: status.restoreTime },
        ],
      }];
    },
    statusPath: ["status", "complete"],
    extraColumns: [
      { label: "Target VM", value: (r) => String(((r.spec?.target as Record<string, unknown> | undefined)?.name as string | undefined) || "N/A") },
    ],
    createTemplate: `apiVersion: snapshot.kubevirt.io/v1beta1
kind: VirtualMachineRestore
metadata:
  name: example-restore
  namespace: default
spec:
  target:
    apiGroup: kubevirt.io
    kind: VirtualMachine
    name: example-vm
  virtualMachineSnapshotName: example-snapshot
`,
  };
