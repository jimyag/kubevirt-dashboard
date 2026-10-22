import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachinesnapshotsConfig: ResourceConfig = {
    id: "virtualmachinesnapshots",
    path: "/kubevirt/snapshots/snapshots",
    title: "Snapshots",
    subtitle: "Create and manage KubeVirt virtual machine snapshots",
    listPath: "/apis/snapshot.kubevirt.io/v1beta1/virtualmachinesnapshots",
    namespaced: true,
    resourcePath: "/apis/snapshot.kubevirt.io/v1beta1",
    kind: "VirtualMachineSnapshot",
    createFields: [
      ...shared.namespaceNameFields("example-snapshot"),
      { name: "sourceVm", label: "Source VM", defaultValue: "example-vm", required: true },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "snapshot.kubevirt.io/v1beta1",
      kind: "VirtualMachineSnapshot",
      metadata: { name: shared.stringValue(values.name, "example-snapshot"), namespace: shared.stringValue(values.namespace, "default") },
      spec: { source: { apiGroup: "kubevirt.io", kind: "VirtualMachine", name: shared.stringValue(values.sourceVm, "example-vm") } },
    }),
    detailSections: (r) => {
      const spec = shared.getRecord(r.spec);
      const status = shared.getRecord(r.status);
      return [
        {
          title: "Snapshot Source",
          items: [
            { label: "Source kind", value: shared.getRecord(spec.source).kind },
            { label: "Source VM", value: shared.getRecord(spec.source).name },
            { label: "Ready to use", value: status.readyToUse },
            { label: "Creation time", value: status.creationTime },
          ],
        },
        {
          title: "Snapshot Content",
          items: [
            { label: "Content name", value: status.virtualMachineSnapshotContentName },
            { label: "Indications", value: status.indications },
          ],
        },
      ];
    },
    statusPath: ["status", "readyToUse"],
    extraColumns: [
      { label: "Source VM", value: (r) => String(((r.spec?.source as Record<string, unknown> | undefined)?.name as string | undefined) || "N/A") },
    ],
    createTemplate: `apiVersion: snapshot.kubevirt.io/v1beta1
kind: VirtualMachineSnapshot
metadata:
  name: example-snapshot
  namespace: default
spec:
  source:
    apiGroup: kubevirt.io
    kind: VirtualMachine
    name: example-vm
`,
  };
