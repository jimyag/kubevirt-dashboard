import type { CreateFormField, ResourceAction, ResourceConfig } from "@/components/resource-management";
import { calicoDetailSections } from "../calico/detail-sections";
import { ciliumEndpointDetailSections, ciliumPolicyDetailSections } from "../cilium/detail-sections";
import { kubeOvnDetailSections } from "../kube-ovn/detail-sections";
import {
  gatewayClassDetailSections,
  gatewayDetailSections,
  httpRouteDetailSections,
  kubernetesEndpointSliceDetailSections,
  kubernetesEndpointsDetailSections,
  kubernetesIngressClassDetailSections,
  kubernetesIngressDetailSections,
  kubernetesNetworkPolicyDetailSections,
  kubernetesServiceDetailSections,
  networkAttachmentDetailSections,
} from "../kubernetes/detail-sections";
import {
  csiDriverDetailSections,
  csiNodeDetailSections,
  csiStorageCapacityDetailSections,
  persistentVolumeClaimDetailSections,
  persistentVolumeDetailSections,
  storageClassDetailSections,
  volumeAttachmentDetailSections,
  volumeAttributesClassDetailSections,
  volumeSnapshotClassDetailSections,
  volumeSnapshotContentDetailSections,
  volumeSnapshotDetailSections,
} from "../storage/detail-sections";

const namespaceNameFields = (name: string, namespace = "default"): CreateFormField[] => [
  { name: "name", label: "Name", section: "Identity", defaultValue: name, required: true },
  { name: "namespace", label: "Namespace", section: "Identity", defaultValue: namespace, required: true },
];

const nameOnlyFields = (name: string): CreateFormField[] => [
  { name: "name", label: "Name", section: "Identity", defaultValue: name, required: true },
];

const numberValue = (value: string | boolean, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const stringValue = (value: string | boolean | undefined, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

const getRecord = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const listNames = (value: unknown) => Array.isArray(value) ? value.map((item) => item?.name || item?.metadata?.name || JSON.stringify(item)).join(", ") : "";
const selectorText = (value: unknown) => Object.entries(getRecord(value)).map(([key, val]) => `${key}=${val}`).join(", ");
const keyValueText = (value?: Record<string, string>) => Object.entries(value || {}).map(([key, val]) => `${key}=${val}`).join("\n");
const parseKeyValueText = (text: string) => Object.fromEntries(
  text.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return [key.trim(), rest.join("=").trim()];
    })
    .filter(([key]) => key)
);
const selectorFromValues = (values: Record<string, string | boolean>, keyName = "selectorKey", valueName = "selectorValue") => ({
  matchLabels: { [stringValue(values[keyName], "app")]: stringValue(values[valueName], "default") },
});
const mergePatch = (body: unknown): RequestInit => ({
  method: "PATCH",
  headers: { "Content-Type": "application/merge-patch+json", Accept: "application/json" },
  body: JSON.stringify(body),
});
const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(body),
});
const jsonPut = (body: unknown = {}): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(body),
});
const resourceRefPath = (base: string, id: string, resource: { metadata: { namespace?: string; name: string } }) =>
  `${base}${resource.metadata.namespace ? `/namespaces/${resource.metadata.namespace}` : ""}/${id}/${resource.metadata.name}`;

/** Pools are served as v1beta1 since KubeVirt 1.7 and v1alpha1 before; act on the version the object was read from. */
const poolBase = (resource: { apiVersion?: string }) => `/apis/${resource.apiVersion || "pool.kubevirt.io/v1beta1"}`;
const poolVmSpec = (r: { spec?: Record<string, unknown> }) => getRecord(getRecord(r.spec).virtualMachineTemplate).spec as Record<string, unknown> | undefined;
const poolDomain = (r: { spec?: Record<string, unknown> }) => getRecord(getRecord(getRecord(poolVmSpec(r)).template).spec).domain;

const poolActions: ResourceAction[] = [
  {
    id: "start-pool",
    label: "Start",
    description: "Set the pool VM template run strategy to Always.",
    buildRequest: (resource) => ({
      url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
      options: mergePatch({ spec: { virtualMachineTemplate: { spec: { runStrategy: "Always" } } } }),
    }),
  },
  {
    id: "stop-pool",
    label: "Stop",
    description: "Set the pool VM template run strategy to Halted.",
    buildRequest: (resource) => ({
      url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
      options: mergePatch({ spec: { virtualMachineTemplate: { spec: { runStrategy: "Halted" } } } }),
    }),
  },
  {
    id: "scale-pool",
    label: "Scale",
    fields: [{ name: "replicas", label: "Replicas", type: "number", defaultValue: (r) => String(getRecord(r.spec).replicas || 1) }],
    buildRequest: (resource, values) => ({
      url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
      options: mergePatch({ spec: { replicas: numberValue(values.replicas, 1) } }),
    }),
  },
  {
    id: "resize-pool",
    label: "Resize",
    description: "Set CPU topology and memory on the pool VM template. Not allowed when the pool uses an instance type.",
    fields: [
      { name: "sockets", label: "Sockets", type: "number", defaultValue: (r) => String(getRecord(getRecord(poolDomain(r)).cpu).sockets || 1) },
      { name: "cores", label: "Cores", type: "number", defaultValue: (r) => String(getRecord(getRecord(poolDomain(r)).cpu).cores || 1) },
      { name: "threads", label: "Threads", type: "number", defaultValue: (r) => String(getRecord(getRecord(poolDomain(r)).cpu).threads || 1) },
      { name: "memory", label: "Memory", defaultValue: (r) => String(getRecord(getRecord(getRecord(poolDomain(r)).resources).requests).memory || getRecord(getRecord(poolDomain(r)).memory).guest || "1Gi") },
    ],
    buildRequest: (resource, values) => ({
      url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
      options: mergePatch({
        spec: {
          virtualMachineTemplate: {
            spec: {
              template: {
                spec: {
                  domain: {
                    cpu: {
                      sockets: numberValue(values.sockets, 1),
                      cores: numberValue(values.cores, 1),
                      threads: numberValue(values.threads, 1),
                    },
                    resources: { requests: { memory: stringValue(values.memory, "1Gi") } },
                  },
                },
              },
            },
          },
        },
      }),
    }),
  },
  {
    id: "pool-run-strategy",
    label: "Run Strategy",
    fields: [{ name: "runStrategy", label: "Run Strategy", type: "select", defaultValue: (r) => String(getRecord(poolVmSpec(r)).runStrategy || "Always"), options: [{ label: "Always", value: "Always" }, { label: "Halted", value: "Halted" }, { label: "RerunOnFailure", value: "RerunOnFailure" }, { label: "Manual", value: "Manual" }] }],
    buildRequest: (resource, values) => ({
      url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
      options: mergePatch({ spec: { virtualMachineTemplate: { spec: { runStrategy: stringValue(values.runStrategy, "Always") } } } }),
    }),
  },
  {
    id: "pool-instance-type",
    label: "Instance Type",
    description: "Use a cluster instance type for CPU and memory. Leave empty to go back to the template's own sizing.",
    fields: [{ name: "instanceType", label: "Cluster Instance Type", defaultValue: (r) => String(getRecord(getRecord(poolVmSpec(r)).instancetype).name || "") }],
    buildRequest: (resource, values) => {
      const name = stringValue(values.instanceType);
      // An instance type and template CPU/memory are mutually exclusive in KubeVirt.
      const spec = name
        ? { instancetype: { kind: "VirtualMachineClusterInstancetype", name }, template: { spec: { domain: { cpu: null, resources: { requests: { memory: null } }, memory: null } } } }
        : { instancetype: null };
      return {
        url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
        options: mergePatch({ spec: { virtualMachineTemplate: { spec } } }),
      };
    },
  },
  {
    id: "pool-priority-class",
    label: "Priority Class",
    fields: [{ name: "priorityClassName", label: "Priority Class Name", defaultValue: (r) => String(getRecord(getRecord(getRecord(poolVmSpec(r)).template).spec).priorityClassName || "") }],
    buildRequest: (resource, values) => ({
      url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
      options: mergePatch({ spec: { virtualMachineTemplate: { spec: { template: { spec: { priorityClassName: stringValue(values.priorityClassName) || null } } } } } }),
    }),
  },
  {
    id: "detach-vm",
    label: "Detach VM",
    description: "Remove pool ownership labels from a VM and pin it to a selected node.",
    fields: [
      { name: "vmName", label: "VM Name", defaultValue: "" },
      { name: "nodeName", label: "Target Node", defaultValue: "" },
    ],
    buildRequest: (resource, values) => {
      const vmName = stringValue(values.vmName);
      return {
        url: `/apis/kubevirt.io/v1/namespaces/${resource.metadata.namespace}/virtualmachines/${vmName}`,
        options: mergePatch({
          metadata: {
            labels: {
              "kubevirt.io/domain": vmName,
              "kubevirt.io/vm-pool-revision-name": null,
              "kubevirt.io/vmpool": null,
            },
            ownerReferences: null,
          },
          spec: {
            template: {
              metadata: {
                labels: {
                  "kubevirt.io/domain": vmName,
                  "kubevirt.io/vm-pool-revision-name": null,
                  "kubevirt.io/vmpool": null,
                },
              },
              spec: { nodeSelector: { "kubernetes.io/hostname": stringValue(values.nodeName) } },
            },
          },
        }),
      };
    },
  },
  {
    id: "set-liveness",
    label: "Liveness Probe",
    description: "Set or clear the VM template livenessProbe. Enter JSON for the probe, or leave empty to clear it.",
    fields: [{ name: "probe", label: "Probe JSON", type: "textarea", defaultValue: "" }],
    buildRequest: (resource, values) => {
      const probe = stringValue(values.probe);
      return {
        url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
        options: mergePatch({ spec: { virtualMachineTemplate: { spec: { template: { spec: { livenessProbe: probe ? JSON.parse(probe) : null } } } } } }),
      };
    },
  },
  {
    id: "set-readiness",
    label: "Readiness Probe",
    description: "Set or clear the VM template readinessProbe. Enter JSON for the probe, or leave empty to clear it.",
    fields: [{ name: "probe", label: "Probe JSON", type: "textarea", defaultValue: "" }],
    buildRequest: (resource, values) => {
      const probe = stringValue(values.probe);
      return {
        url: resourceRefPath(poolBase(resource), "virtualmachinepools", resource),
        options: mergePatch({ spec: { virtualMachineTemplate: { spec: { template: { spec: { readinessProbe: probe ? JSON.parse(probe) : null } } } } } }),
      };
    },
  },
];

const instanceTypeActions: ResourceAction[] = [
  {
    id: "edit-shape",
    label: "Edit Shape",
    fields: [
      { name: "cpu", label: "Guest CPUs", type: "number", defaultValue: (r) => String(getRecord(getRecord(r.spec).cpu).guest || 1) },
      { name: "memory", label: "Guest Memory", defaultValue: (r) => String(getRecord(getRecord(r.spec).memory).guest || "1Gi") },
    ],
    buildRequest: (resource, values) => ({
      url: resourceRefPath("/apis/instancetype.kubevirt.io/v1beta1", "virtualmachineclusterinstancetypes", resource),
      options: mergePatch({ spec: { cpu: { guest: numberValue(values.cpu, 1) }, memory: { guest: stringValue(values.memory, "1Gi") } } }),
    }),
  },
];

const hpaActions: ResourceAction[] = [
  {
    id: "scale-bounds",
    label: "Scale Bounds",
    description: "Set replica bounds and the CPU utilization target. Other metrics are kept.",
    fields: [
      { name: "minReplicas", label: "Min Replicas", type: "number", defaultValue: (r) => String(getRecord(r.spec).minReplicas || 1) },
      { name: "maxReplicas", label: "Max Replicas", type: "number", defaultValue: (r) => String(getRecord(r.spec).maxReplicas || 3) },
      { name: "cpu", label: "CPU Utilization %", type: "number", placeholder: "leave empty to keep metrics unchanged", defaultValue: (r) => {
        const cpu = (getRecord(r.spec).metrics as Array<Record<string, unknown>> | undefined || []).find((metric) => getRecord(metric.resource).name === "cpu");
        return String(getRecord(getRecord(getRecord(cpu).resource).target).averageUtilization || "");
      } },
    ],
    buildRequest: (resource, values) => {
      const current = (getRecord(resource.spec).metrics as Array<Record<string, unknown>> | undefined) || [];
      const cpu = stringValue(values.cpu);
      const cpuMetric = { type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: numberValue(cpu, 80) } } };
      // Merge patch replaces arrays, so rebuild the list keeping every non-CPU metric.
      const metrics = cpu ? [...current.filter((metric) => getRecord(metric.resource).name !== "cpu"), cpuMetric] : undefined;
      return {
        url: resourceRefPath("/apis/autoscaling/v2", "horizontalpodautoscalers", resource),
        options: mergePatch({ spec: { minReplicas: numberValue(values.minReplicas, 1), maxReplicas: numberValue(values.maxReplicas, 3), ...(metrics ? { metrics } : {}) } }),
      };
    },
  },
];

const networkPolicyActions: ResourceAction[] = [
  {
    id: "set-rules",
    label: "Set Rules",
    description: "Replace the policy rules. For a direction, leaving both port and CIDR empty denies all traffic in that direction.",
    fields: [
      { name: "policyType", label: "Policy Type", type: "select", defaultValue: "Ingress", options: [{ label: "Ingress", value: "Ingress" }, { label: "Egress", value: "Egress" }, { label: "Ingress and Egress", value: "Both" }] },
      { name: "ingressPort", label: "Ingress TCP Port", defaultValue: "", placeholder: "optional" },
      { name: "ingressCidr", label: "Ingress CIDR", defaultValue: "", placeholder: "0.0.0.0/0" },
      { name: "egressPort", label: "Egress TCP Port", defaultValue: "", placeholder: "optional" },
      { name: "egressCidr", label: "Egress CIDR", defaultValue: "", placeholder: "0.0.0.0/0" },
    ],
    buildRequest: (resource, values) => {
      const policyType = stringValue(values.policyType, "Ingress");
      const policyTypes = policyType === "Both" ? ["Ingress", "Egress"] : [policyType];
      const ingressPort = stringValue(values.ingressPort);
      const egressPort = stringValue(values.egressPort);
      const ingressCidr = stringValue(values.ingressCidr);
      const egressCidr = stringValue(values.egressCidr);
      return {
        url: resourceRefPath("/apis/networking.k8s.io/v1", "networkpolicies", resource),
        options: mergePatch({
          spec: {
            policyTypes,
            // An empty rule object would allow everything; with no peer or port, send no rules (deny).
            ...(policyTypes.includes("Ingress") ? {
              ingress: ingressCidr || ingressPort ? [{
                ...(ingressCidr ? { from: [{ ipBlock: { cidr: ingressCidr } }] } : {}),
                ...(ingressPort ? { ports: [{ protocol: "TCP", port: numberValue(ingressPort, 1) }] } : {}),
              }] : [],
            } : { ingress: null }),
            ...(policyTypes.includes("Egress") ? {
              egress: egressCidr || egressPort ? [{
                ...(egressCidr ? { to: [{ ipBlock: { cidr: egressCidr } }] } : {}),
                ...(egressPort ? { ports: [{ protocol: "TCP", port: numberValue(egressPort, 1) }] } : {}),
              }] : [],
            } : { egress: null }),
          },
        }),
      };
    },
  },
];

const csvList = (value: string | boolean | undefined) => stringValue(value).split(",").map((item) => item.trim()).filter(Boolean);

const kubeOvnResourceConfig = ({
  plural,
  path,
  title,
  subtitle,
  kind,
  namespaced = false,
  createFields = [],
  buildSpec,
  detailSections,
  statusPath,
  extraColumns = [],
  allowCreate,
  allowDelete,
}: {
  plural: string;
  path: string;
  title: string;
  subtitle: string;
  kind: string;
  namespaced?: boolean;
  createFields?: CreateFormField[];
  buildSpec?: (values: Record<string, string | boolean>) => Record<string, unknown>;
  detailSections?: ResourceConfig["detailSections"];
  statusPath?: string[];
  extraColumns?: ResourceConfig["extraColumns"];
  allowCreate?: boolean;
  allowDelete?: boolean;
}): ResourceConfig => ({
  id: plural,
  path,
  title,
  subtitle,
  listPath: `/apis/kubeovn.io/v1/${plural}`,
  namespaced,
  resourcePath: "/apis/kubeovn.io/v1",
  kind,
  allowCreate,
  allowDelete,
  createFields: [
    ...(namespaced ? namespaceNameFields(`example-${plural}`) : nameOnlyFields(`example-${plural}`)),
    ...createFields,
  ],
  buildCreateResource: buildSpec ? (values) => ({
    apiVersion: "kubeovn.io/v1",
    kind,
    metadata: {
      name: stringValue(values.name, `example-${plural}`),
      ...(namespaced ? { namespace: stringValue(values.namespace, "default") } : {}),
    },
    spec: buildSpec(values),
  }) : undefined,
  statusPath,
  detailSections: detailSections || kubeOvnDetailSections,
  extraColumns,
  createTemplate: `apiVersion: kubeovn.io/v1
kind: ${kind}
metadata:
  name: example-${plural}
spec: {}
`,
});

const extensionResourceConfig = ({
  groupVersion,
  plural,
  path,
  title,
  subtitle,
  kind,
  namespaced = false,
  createFields = [],
  buildSpec,
  detailSections,
  statusPath,
  extraColumns = [],
  allowCreate,
  allowDelete,
}: {
  groupVersion: string;
  plural: string;
  path: string;
  title: string;
  subtitle: string;
  kind: string;
  namespaced?: boolean;
  createFields?: CreateFormField[];
  buildSpec?: (values: Record<string, string | boolean>) => Record<string, unknown>;
  detailSections?: ResourceConfig["detailSections"];
  statusPath?: string[];
  extraColumns?: ResourceConfig["extraColumns"];
  allowCreate?: boolean;
  allowDelete?: boolean;
}): ResourceConfig => ({
  id: plural,
  path,
  title,
  subtitle,
  listPath: `/apis/${groupVersion}/${plural}`,
  namespaced,
  resourcePath: `/apis/${groupVersion}`,
  kind,
  allowCreate,
  allowDelete,
  createFields: [
    ...(namespaced ? namespaceNameFields(`example-${plural}`) : nameOnlyFields(`example-${plural}`)),
    ...createFields,
  ],
  buildCreateResource: buildSpec ? (values) => ({
    apiVersion: groupVersion,
    kind,
    metadata: {
      name: stringValue(values.name, `example-${plural}`),
      ...(namespaced ? { namespace: stringValue(values.namespace, "default") } : {}),
    },
    spec: buildSpec(values),
  }) : undefined,
  statusPath,
  detailSections: detailSections || ((r) => {
    const spec = getRecord(r.spec);
    const status = getRecord(r.status);
    return [
      { title: "Spec", items: Object.entries(spec).map(([label, value]) => ({ label, value })) },
      { title: "Status", items: Object.entries(status).map(([label, value]) => ({ label, value })) },
    ].filter((section) => section.items.length > 0);
  }),
  extraColumns,
  createTemplate: `apiVersion: ${groupVersion}
kind: ${kind}
metadata:
  name: example-${plural}
spec: {}
`,
});

const calicoResourceConfig = (config: Omit<Parameters<typeof extensionResourceConfig>[0], "groupVersion">) =>
  extensionResourceConfig({ groupVersion: "crd.projectcalico.org/v1", detailSections: calicoDetailSections, ...config });

const ciliumResourceConfig = (config: Omit<Parameters<typeof extensionResourceConfig>[0], "groupVersion"> & { version?: "v2" | "v2alpha1" }) => {
  const { version = "v2", ...rest } = config;
  return extensionResourceConfig({ groupVersion: `cilium.io/${version}`, ...rest });
};

const kubevirtResourceConfig = (config: Omit<Parameters<typeof extensionResourceConfig>[0], "groupVersion"> & { version?: "v1" | "v1alpha3" }) => {
  const { version = "v1", ...rest } = config;
  return extensionResourceConfig({ groupVersion: `kubevirt.io/${version}`, ...rest });
};

const cdiResourceConfig = (config: Omit<Parameters<typeof extensionResourceConfig>[0], "groupVersion"> & { version?: "v1beta1" }) => {
  const { version = "v1beta1", ...rest } = config;
  return extensionResourceConfig({ groupVersion: `cdi.kubevirt.io/${version}`, ...rest });
};

const instancetypeResourceConfig = (config: Omit<Parameters<typeof extensionResourceConfig>[0], "groupVersion"> & { version?: "v1beta1" }) => {
  const { version = "v1beta1", ...rest } = config;
  return extensionResourceConfig({ groupVersion: `instancetype.kubevirt.io/${version}`, ...rest });
};

const snapshotResourceConfig = (config: Omit<Parameters<typeof extensionResourceConfig>[0], "groupVersion"> & { version?: "v1beta1" }) => {
  const { version = "v1beta1", ...rest } = config;
  return extensionResourceConfig({ groupVersion: `snapshot.kubevirt.io/${version}`, ...rest });
};
export {
  calicoDetailSections,
  calicoResourceConfig,
  cdiResourceConfig,
  ciliumEndpointDetailSections,
  ciliumPolicyDetailSections,
  ciliumResourceConfig,
  csiDriverDetailSections,
  csiNodeDetailSections,
  csiStorageCapacityDetailSections,
  csvList,
  extensionResourceConfig,
  gatewayClassDetailSections,
  gatewayDetailSections,
  getRecord,
  hpaActions,
  httpRouteDetailSections,
  instanceTypeActions,
  instancetypeResourceConfig,
  jsonPost,
  jsonPut,
  keyValueText,
  kubeOvnDetailSections,
  kubeOvnResourceConfig,
  kubevirtResourceConfig,
  kubernetesEndpointSliceDetailSections,
  kubernetesEndpointsDetailSections,
  kubernetesIngressClassDetailSections,
  kubernetesIngressDetailSections,
  kubernetesNetworkPolicyDetailSections,
  kubernetesServiceDetailSections,
  listNames,
  mergePatch,
  nameOnlyFields,
  namespaceNameFields,
  networkAttachmentDetailSections,
  networkPolicyActions,
  numberValue,
  parseKeyValueText,
  persistentVolumeClaimDetailSections,
  persistentVolumeDetailSections,
  poolActions,
  resourceRefPath,
  selectorFromValues,
  selectorText,
  snapshotResourceConfig,
  storageClassDetailSections,
  stringValue,
  volumeAttachmentDetailSections,
  volumeAttributesClassDetailSections,
  volumeSnapshotClassDetailSections,
  volumeSnapshotContentDetailSections,
  volumeSnapshotDetailSections,
};
