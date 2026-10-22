import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const horizontalpodautoscalersConfig: ResourceConfig = {
    id: "horizontalpodautoscalers",
    path: "/kubevirt/operations/autoscaling",
    title: "Autoscaling",
    subtitle: "Manage autoscaling policies for VM pools and related workloads",
    listPath: "/apis/autoscaling/v2/horizontalpodautoscalers",
    namespaced: true,
    resourcePath: "/apis/autoscaling/v2",
    kind: "HorizontalPodAutoscaler",
    actions: shared.hpaActions,
    createFields: [
      ...shared.namespaceNameFields("example-hpa"),
      { name: "targetKind", label: "Target Kind", type: "select", defaultValue: "VirtualMachinePool", options: [{ label: "VirtualMachinePool", value: "VirtualMachinePool" }, { label: "Deployment", value: "Deployment" }] },
      { name: "targetName", label: "Target Name", defaultValue: "example-pool" },
      { name: "minReplicas", label: "Min Replicas", type: "number", defaultValue: "1" },
      { name: "maxReplicas", label: "Max Replicas", type: "number", defaultValue: "3" },
      { name: "cpu", label: "CPU Utilization", type: "number", defaultValue: "80" },
    ],
    buildCreateResource: (values) => {
      const targetKind = shared.stringValue(values.targetKind, "VirtualMachinePool");
      return {
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        metadata: { name: shared.stringValue(values.name, "example-hpa"), namespace: shared.stringValue(values.namespace, "default"), labels: { "kubevirt-manager.io/managed": "true" } },
        spec: {
          minReplicas: shared.numberValue(values.minReplicas, 1),
          maxReplicas: shared.numberValue(values.maxReplicas, 3),
          scaleTargetRef: {
            apiVersion: targetKind === "Deployment" ? "apps/v1" : "pool.kubevirt.io/v1beta1",
            kind: targetKind,
            name: shared.stringValue(values.targetName, "example-pool"),
          },
          metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: shared.numberValue(values.cpu, 80) } } }],
        },
      };
    },
    detailSections: (r) => {
      const spec = shared.getRecord(r.spec);
      const status = shared.getRecord(r.status);
      return [
        {
          title: "Scale Target",
          items: [
            { label: "Target API Version", value: shared.getRecord(spec.scaleTargetRef).apiVersion },
            { label: "Target Kind", value: shared.getRecord(spec.scaleTargetRef).kind },
            { label: "Target Name", value: shared.getRecord(spec.scaleTargetRef).name },
          ],
        },
        {
          title: "Replicas",
          items: [
            { label: "Min", value: spec.minReplicas },
            { label: "Max", value: spec.maxReplicas },
            { label: "Current", value: status.currentReplicas },
            { label: "Desired", value: status.desiredReplicas },
          ],
        },
      ];
    },
    statusPath: ["status", "currentReplicas"],
    extraColumns: [
      { label: "Min", value: (r) => String((r.spec?.minReplicas as number | undefined) ?? "N/A") },
      { label: "Max", value: (r) => String((r.spec?.maxReplicas as number | undefined) ?? "N/A") },
    ],
    createTemplate: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: example-hpa
  namespace: default
spec:
  minReplicas: 1
  maxReplicas: 3
  scaleTargetRef:
    apiVersion: pool.kubevirt.io/v1beta1
    kind: VirtualMachinePool
    name: example-pool
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80
`,
  };
