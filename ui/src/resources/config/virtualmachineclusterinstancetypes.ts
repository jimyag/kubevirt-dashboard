import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const virtualmachineclusterinstancetypesConfig: ResourceConfig = {
    id: "virtualmachineclusterinstancetypes",
    path: "/kubevirt/templates/instance-types",
    title: "Instance Types",
    subtitle: "Manage reusable KubeVirt compute shapes",
    listPath: "/apis/instancetype.kubevirt.io/v1beta1/virtualmachineclusterinstancetypes",
    namespaced: false,
    resourcePath: "/apis/instancetype.kubevirt.io/v1beta1",
    kind: "VirtualMachineClusterInstancetype",
    actions: shared.instanceTypeActions,
    createFields: [
      { name: "name", label: "Name", defaultValue: "example-small", required: true },
      { name: "cpu", label: "Guest CPUs", type: "number", defaultValue: "1" },
      { name: "memory", label: "Guest memory", defaultValue: "1Gi" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "instancetype.kubevirt.io/v1beta1",
      kind: "VirtualMachineClusterInstancetype",
      metadata: { name: shared.stringValue(values.name, "example-small") },
      spec: { cpu: { guest: shared.numberValue(values.cpu, 1) }, memory: { guest: shared.stringValue(values.memory, "1Gi") } },
    }),
    detailSections: (r) => {
      const spec = shared.getRecord(r.spec);
      return [{
        title: "Compute Shape",
        items: [
          { label: "Guest CPUs", value: shared.getRecord(spec.cpu).guest },
          { label: "Guest memory", value: shared.getRecord(spec.memory).guest },
          { label: "IO threads policy", value: spec.ioThreadsPolicy },
          { label: "Launch security", value: spec.launchSecurity },
        ],
      }];
    },
    extraColumns: [
      { label: "CPU", value: (r) => String(((r.spec?.cpu as Record<string, unknown> | undefined)?.guest as number | undefined) ?? "N/A") },
      { label: "Memory", value: (r) => String(((r.spec?.memory as Record<string, unknown> | undefined)?.guest as string | undefined) || "N/A") },
    ],
    createTemplate: `apiVersion: instancetype.kubevirt.io/v1beta1
kind: VirtualMachineClusterInstancetype
metadata:
  name: example-small
spec:
  cpu:
    guest: 1
  memory:
    guest: 1Gi
`,
  };
