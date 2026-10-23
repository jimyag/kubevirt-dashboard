import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachineinstancemigrationsConfig: ResourceConfig = shared.kubevirtResourceConfig({
    plural: "virtualmachineinstancemigrations",
    path: "/kubevirt/operations/migrations",
    title: "VMI Migrations",
    subtitle: "Manage KubeVirt VirtualMachineInstanceMigration resources",
    kind: "VirtualMachineInstanceMigration",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-migration"), { name: "vmiName", label: "VMI name", section: "Migration", defaultValue: "example-vm" }],
    buildSpec: (values) => ({ vmiName: shared.stringValue(values.vmiName, "example-vm") }),
    statusPath: ["status", "phase"],
    extraColumns: [{ label: "Phase", value: (r) => String(shared.getRecord(r.status).phase || "N/A") }, { label: "VMI", value: (r) => String(shared.getRecord(r.spec).vmiName || "N/A") }],
  });
