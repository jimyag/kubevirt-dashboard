import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachineinstancereplicasetsConfig: ResourceConfig = shared.kubevirtResourceConfig({
    plural: "virtualmachineinstancereplicasets",
    path: "/kubevirt/virtualization/vmi-replica-sets",
    title: "VMI ReplicaSets",
    subtitle: "Manage KubeVirt VirtualMachineInstanceReplicaSet resources",
    kind: "VirtualMachineInstanceReplicaSet",
    namespaced: true,
    createFields: [...shared.namespaceNameFields("example-vmirs"), { name: "replicas", label: "Replicas", section: "Scale", type: "number", defaultValue: "1" }],
    buildSpec: (values) => ({ replicas: shared.replicaCount(values.replicas), selector: { matchLabels: { app: shared.stringValue(values.name, "example-vmirs") } }, template: { metadata: { labels: { app: shared.stringValue(values.name, "example-vmirs") } }, spec: { domain: { devices: { disks: [] } }, volumes: [] } } }),
    statusPath: ["status", "readyReplicas"],
    extraColumns: [{ label: "Replicas", value: (r) => String(shared.getRecord(r.spec).replicas ?? "N/A") }, { label: "Ready", value: (r) => String(shared.getRecord(r.status).readyReplicas || 0) }],
  });
