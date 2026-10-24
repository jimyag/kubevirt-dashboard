import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";
import { t } from "@/lib/i18n";

export const virtualmachinesnapshotcontentsConfig: ResourceConfig = shared.snapshotResourceConfig({
    plural: "virtualmachinesnapshotcontents",
    path: "/kubevirt/snapshots/snapshot-contents",
    title: "Snapshot Contents",
    subtitle: "Manage KubeVirt VirtualMachineSnapshotContent resources",
    kind: "VirtualMachineSnapshotContent",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-snapshot-content"), { name: "snapshotName", label: "Snapshot name", section: "Snapshot", defaultValue: "example-snapshot" }, { name: "sourceVm", label: "Source VM snapshot (JSON)", section: "Source", type: "textarea", defaultValue: "", required: true, placeholder: '{"metadata":{"name":"example-vm"},"spec":{"template":{}}}' }],
    buildSpec: (values) => {
      if (!shared.stringValue(values.sourceVm)) throw new Error(t("Paste the source VM snapshot as JSON."));
      const virtualMachine = shared.getRecord(JSON.parse(shared.stringValue(values.sourceVm)));
      if (!shared.getRecord(virtualMachine.metadata).name || !shared.getRecord(virtualMachine.spec).template) throw new Error(t("Source VM snapshot must include metadata.name and spec.template."));
      return { virtualMachineSnapshotName: shared.stringValue(values.snapshotName, "example-snapshot"), source: { virtualMachine } };
    },
    statusPath: ["status", "readyToUse"],
  });
