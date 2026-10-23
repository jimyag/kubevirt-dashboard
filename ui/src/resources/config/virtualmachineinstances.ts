import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachineinstancesConfig: ResourceConfig = shared.kubevirtResourceConfig({
    plural: "virtualmachineinstances",
    path: "/kubevirt/virtualization/virtual-machine-instances",
    title: "Virtual Machine Instances",
    subtitle: "Manage live KubeVirt VirtualMachineInstance resources",
    kind: "VirtualMachineInstance",
    namespaced: true,
    createFields: [
      ...shared.namespaceNameFields("example-vmi"),
      { name: "cpu", label: "CPU cores", section: "Compute", type: "number", defaultValue: "1" },
      { name: "memory", label: "Memory", section: "Compute", defaultValue: "1Gi" },
      { name: "containerImage", label: "Container disk image", section: "Storage", defaultValue: "quay.io/containerdisks/fedora:latest" },
    ],
    buildSpec: (values) => ({
      domain: {
        cpu: { cores: shared.numberValue(values.cpu, 1) },
        resources: { requests: { memory: shared.stringValue(values.memory, "1Gi") } },
        devices: { disks: [{ name: "containerdisk", disk: { bus: "virtio" } }], interfaces: [{ name: "default", masquerade: {} }] },
      },
      networks: [{ name: "default", pod: {} }],
      volumes: [{ name: "containerdisk", containerDisk: { image: shared.stringValue(values.containerImage, "quay.io/containerdisks/fedora:latest") } }],
    }),
    statusPath: ["status", "phase"],
    extraColumns: [{ label: "Phase", value: (r) => String(shared.getRecord(r.status).phase || "N/A") }, { label: "Node", value: (r) => String(shared.getRecord(r.status).nodeName || "N/A") }],
  });
