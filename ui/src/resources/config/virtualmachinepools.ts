import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachinepoolsConfig: ResourceConfig = {
    id: "virtualmachinepools",
    path: "/kubevirt/virtualization/vm-pools",
    title: "VM Pools",
    subtitle: "Manage KubeVirt VirtualMachinePool resources",
    listPath: "/apis/pool.kubevirt.io/v1beta1/virtualmachinepools",
    namespaced: true,
    resourcePath: "/apis/pool.kubevirt.io/v1beta1",
    kind: "VirtualMachinePool",
    actions: shared.poolActions,
    createFields: [
      ...shared.namespaceNameFields("example-pool"),
      { name: "replicas", label: "Replicas", type: "number", defaultValue: "1" },
      { name: "cpu", label: "CPU Cores", type: "number", defaultValue: "1" },
      { name: "memory", label: "Memory", defaultValue: "1Gi" },
      { name: "containerImage", label: "Container Disk Image", defaultValue: "quay.io/containerdisks/fedora:latest" },
    ],
    buildCreateResource: (values) => {
      const name = shared.stringValue(values.name, "example-pool");
      return {
        apiVersion: "pool.kubevirt.io/v1beta1",
        kind: "VirtualMachinePool",
        metadata: { name, namespace: shared.stringValue(values.namespace, "default"), labels: { "kubevirt-manager.io/managed": "true" } },
        spec: {
          replicas: shared.numberValue(values.replicas, 1),
          selector: { matchLabels: { "kubevirt.io/vmpool": name } },
          virtualMachineTemplate: {
            metadata: { labels: { "kubevirt.io/vmpool": name, "kubevirt-manager.io/managed": "true" } },
            spec: {
              runStrategy: "Always",
              template: {
                metadata: { labels: { "kubevirt.io/vmpool": name } },
                spec: {
                  domain: {
                    cpu: { cores: shared.numberValue(values.cpu, 1) },
                    resources: { requests: { memory: shared.stringValue(values.memory, "1Gi") } },
                    devices: { disks: [{ name: "containerdisk", disk: { bus: "virtio" } }], interfaces: [{ name: "default", masquerade: {} }] },
                  },
                  networks: [{ name: "default", pod: {} }],
                  volumes: [{ name: "containerdisk", containerDisk: { image: shared.stringValue(values.containerImage, "quay.io/containerdisks/fedora:latest") } }],
                },
              },
            },
          },
        },
      };
    },
    statusPath: ["status", "readyReplicas"],
    detailSections: (r) => {
      const spec = shared.getRecord(r.spec);
      const template = shared.getRecord(spec.virtualMachineTemplate);
      const vmSpec = shared.getRecord(template.spec);
      const podSpec = shared.getRecord(shared.getRecord(vmSpec.template).spec);
      const domain = shared.getRecord(podSpec.domain);
      const devices = shared.getRecord(domain.devices);
      return [
        {
          title: "Pool",
          items: [
            { label: "Replicas", value: spec.replicas },
            { label: "Ready Replicas", value: shared.getRecord(r.status).readyReplicas },
            { label: "Run Strategy", value: vmSpec.runStrategy },
            { label: "Selector", value: shared.selectorText(shared.getRecord(spec.selector).matchLabels) },
          ],
        },
        {
          title: "Template",
          items: [
            { label: "Instance Type", value: shared.getRecord(vmSpec.instancetype).name },
            { label: "CPU", value: shared.getRecord(domain.cpu).cores || shared.getRecord(domain.cpu).guest },
            { label: "Memory", value: shared.getRecord(shared.getRecord(domain.resources).requests).memory },
            { label: "Networks", value: shared.listNames(podSpec.networks) },
            { label: "Disks", value: shared.listNames(devices.disks) },
          ],
        },
      ];
    },
    extraColumns: [
      { label: "Replicas", value: (r) => String((r.spec?.replicas as number | undefined) ?? "N/A") },
      { label: "Ready", value: (r) => String((r.status?.readyReplicas as number | undefined) ?? 0) },
    ],
    createTemplate: `apiVersion: pool.kubevirt.io/v1beta1
kind: VirtualMachinePool
metadata:
  name: example-pool
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      kubevirt.io/vmpool: example-pool
  virtualMachineTemplate:
    metadata:
      labels:
        kubevirt.io/vmpool: example-pool
    spec:
      runStrategy: Always
      template:
        spec:
          domain:
            devices:
              disks: []
          volumes: []
`,
  };
