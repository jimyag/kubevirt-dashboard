import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";
import { rbacApiGroups, rbacSubject } from "../../lib/rbac";
import {
  kubernetesConfigMapDetailSections,
  kubernetesCronJobDetailSections,
  kubernetesCustomResourceDefinitionDetailSections,
  kubernetesDaemonSetDetailSections,
  kubernetesDeploymentDetailSections,
  kubernetesEventDetailSections,
  kubernetesJobDetailSections,
  kubernetesNamespaceDetailSections,
  kubernetesPodDetailSections,
  kubernetesPodDisruptionBudgetDetailSections,
  kubernetesReplicaSetDetailSections,
  kubernetesRoleBindingDetailSections,
  kubernetesRoleDetailSections,
  kubernetesSecretDetailSections,
  kubernetesServiceAccountDetailSections,
  kubernetesStatefulSetDetailSections,
} from "../kubernetes/detail-sections";

const labelsFromValues = (values: Record<string, string | boolean>) => ({
  [shared.stringValue(values.labelKey, "app")]: shared.stringValue(values.labelValue, shared.stringValue(values.name, "example")),
});

const containerFromValues = (values: Record<string, string | boolean>) => ({
  name: shared.stringValue(values.containerName, "app"),
  image: shared.stringValue(values.image, "nginx:latest"),
  ports: shared.numberValue(values.containerPort, 0) > 0 ? [{ containerPort: shared.numberValue(values.containerPort, 80) }] : undefined,
});

const containerStatuses = (resource: Record<string, unknown>) => {
  const statuses = shared.getRecord(resource.status).containerStatuses;
  return Array.isArray(statuses) ? statuses.map(shared.getRecord) : [];
};
const listValue = (value: unknown) => Array.isArray(value) ? value : [];

const podTemplate = (values: Record<string, string | boolean>, restartPolicy?: "Never") => ({
  metadata: { labels: labelsFromValues(values) },
  spec: {
    ...(restartPolicy ? { restartPolicy } : {}),
    serviceAccountName: shared.stringValue(values.serviceAccountName),
    containers: [containerFromValues(values)],
  },
});

const workloadFields = [
  { name: "replicas", label: "Replicas", section: "Scale", type: "number" as const, defaultValue: "1" },
  { name: "labelKey", label: "Selector key", section: "Selector", defaultValue: "app" },
  { name: "labelValue", label: "Selector value", section: "Selector", defaultValue: "example" },
  { name: "containerName", label: "Container name", section: "Container", defaultValue: "app" },
  { name: "image", label: "Image", section: "Container", defaultValue: "nginx:latest" },
  { name: "containerPort", label: "Container port", section: "Container", type: "number" as const, defaultValue: "80" },
  { name: "serviceAccountName", label: "Service account", section: "Pod", defaultValue: "" },
];

const namedCoreResource = ({
  id,
  path,
  title,
  subtitle,
  kind,
  namespaced,
  detailSections,
  statusPath,
  extraColumns = [],
  createFields = [],
  buildResource,
  allowCreate,
  allowDelete,
}: {
  id: string;
  path: string;
  title: string;
  subtitle: string;
  kind: string;
  namespaced: boolean;
  detailSections?: ResourceConfig["detailSections"];
  statusPath?: string[];
  extraColumns?: ResourceConfig["extraColumns"];
  createFields?: ResourceConfig["createFields"];
  buildResource?: ResourceConfig["buildCreateResource"];
  allowCreate?: boolean;
  allowDelete?: boolean;
}): ResourceConfig => ({
  id,
  path,
  title,
  subtitle,
  listPath: `/api/v1/${id}`,
  namespaced,
  resourcePath: "/api/v1",
  kind,
  allowCreate,
  allowDelete,
  createFields: [
    ...(namespaced ? shared.namespaceNameFields(`example-${id}`) : shared.nameOnlyFields(`example-${id}`)),
    ...(createFields || []),
  ],
  buildCreateResource: buildResource,
  detailSections,
  statusPath,
  extraColumns,
  createTemplate: `apiVersion: v1
kind: ${kind}
metadata:
  name: example-${id}
${namespaced ? "  namespace: default\n" : ""}`,
});

const extensionResource = ({
  groupVersion,
  id,
  path,
  title,
  subtitle,
  kind,
  namespaced,
  detailSections,
  statusPath,
  extraColumns = [],
  createFields = [],
  buildResource,
  allowCreate,
  allowDelete,
  listPathAlternates,
  resourcePathAlternates,
}: {
  groupVersion: string;
  id: string;
  path: string;
  title: string;
  subtitle: string;
  kind: string;
  namespaced: boolean;
  detailSections?: ResourceConfig["detailSections"];
  statusPath?: string[];
  extraColumns?: ResourceConfig["extraColumns"];
  createFields?: ResourceConfig["createFields"];
  buildResource?: ResourceConfig["buildCreateResource"];
  allowCreate?: boolean;
  allowDelete?: boolean;
  listPathAlternates?: string[];
  resourcePathAlternates?: string[];
}): ResourceConfig => ({
  id,
  path,
  title,
  subtitle,
  listPath: `/apis/${groupVersion}/${id}`,
  listPathAlternates,
  namespaced,
  resourcePath: `/apis/${groupVersion}`,
  resourcePathAlternates,
  kind,
  allowCreate,
  allowDelete,
  createFields: [
    ...(namespaced ? shared.namespaceNameFields(`example-${id}`) : shared.nameOnlyFields(`example-${id}`)),
    ...(createFields || []),
  ],
  buildCreateResource: buildResource,
  detailSections,
  statusPath,
  extraColumns,
  createTemplate: `apiVersion: ${groupVersion}
kind: ${kind}
metadata:
  name: example-${id}
${namespaced ? "  namespace: default\n" : ""}spec: {}
`,
});

export const podsConfig = namedCoreResource({
  id: "pods",
  path: "/kubernetes/workloads/pods",
  title: "Pods",
  subtitle: "Manage Kubernetes Pods and inspect container status, scheduling, volumes, and networking",
  kind: "Pod",
  namespaced: true,
  statusPath: ["status", "phase"],
  detailSections: kubernetesPodDetailSections,
  createFields: workloadFields.filter((field) => field.name !== "replicas"),
  buildResource: (values) => ({
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: shared.stringValue(values.name, "example-pod"), namespace: shared.stringValue(values.namespace, "default"), labels: labelsFromValues(values) },
    spec: { serviceAccountName: shared.stringValue(values.serviceAccountName), containers: [containerFromValues(values)] },
  }),
  extraColumns: [
    { label: "Ready", value: (r) => `${containerStatuses(r).filter((s) => s.ready).length} / ${containerStatuses(r).length}` },
    { label: "Restarts", value: (r) => String(containerStatuses(r).reduce((sum, s) => sum + Number(s.restartCount || 0), 0)) },
    { label: "Node", value: (r) => String(shared.getRecord(r.spec).nodeName || "N/A") },
    { label: "Pod IP", value: (r) => String(shared.getRecord(r.status).podIP || "N/A") },
  ],
});

export const deploymentsConfig = extensionResource({
  groupVersion: "apps/v1",
  id: "deployments",
  path: "/kubernetes/workloads/deployments",
  title: "Deployments",
  subtitle: "Manage Deployment rollout, replica, selector, and pod template configuration",
  kind: "Deployment",
  namespaced: true,
  statusPath: ["status", "conditions", "0", "type"],
  detailSections: kubernetesDeploymentDetailSections,
  createFields: workloadFields,
  buildResource: (values) => ({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: shared.stringValue(values.name, "example-deployment"), namespace: shared.stringValue(values.namespace, "default") },
    spec: { replicas: shared.replicaCount(values.replicas), selector: { matchLabels: labelsFromValues(values) }, template: podTemplate(values) },
  }),
  extraColumns: [
    { label: "Ready", value: (r) => `${shared.getRecord(r.status).readyReplicas || 0} / ${shared.getRecord(r.status).replicas || shared.getRecord(r.spec).replicas || 0}` },
    { label: "Available", value: (r) => String(shared.getRecord(r.status).availableReplicas || 0) },
    { label: "Updated", value: (r) => String(shared.getRecord(r.status).updatedReplicas || 0) },
  ],
});

export const statefulsetsConfig = extensionResource({
  groupVersion: "apps/v1",
  id: "statefulsets",
  path: "/kubernetes/workloads/statefulsets",
  title: "StatefulSets",
  subtitle: "Manage StatefulSet identity, ordered rollout, and volume claim templates",
  kind: "StatefulSet",
  namespaced: true,
  statusPath: ["status", "conditions", "0", "type"],
  detailSections: kubernetesStatefulSetDetailSections,
  createFields: [...workloadFields, { name: "serviceName", label: "Headless service name", section: "StatefulSet", defaultValue: "" }],
  buildResource: (values) => ({
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name: shared.stringValue(values.name, "example-statefulset"), namespace: shared.stringValue(values.namespace, "default") },
    spec: { serviceName: shared.stringValue(values.serviceName, shared.stringValue(values.name, "example-statefulset")), replicas: shared.replicaCount(values.replicas), selector: { matchLabels: labelsFromValues(values) }, template: podTemplate(values) },
  }),
  extraColumns: [{ label: "Ready", value: (r) => `${shared.getRecord(r.status).readyReplicas || 0} / ${shared.getRecord(r.status).replicas || shared.getRecord(r.spec).replicas || 0}` }],
});

export const daemonsetsConfig = extensionResource({
  groupVersion: "apps/v1",
  id: "daemonsets",
  path: "/kubernetes/workloads/daemonsets",
  title: "DaemonSets",
  subtitle: "Manage DaemonSet node-wide pod rollout and availability",
  kind: "DaemonSet",
  namespaced: true,
  statusPath: ["status", "conditions", "0", "type"],
  detailSections: kubernetesDaemonSetDetailSections,
  createFields: workloadFields.filter((field) => field.name !== "replicas"),
  buildResource: (values) => ({
    apiVersion: "apps/v1",
    kind: "DaemonSet",
    metadata: { name: shared.stringValue(values.name, "example-daemonset"), namespace: shared.stringValue(values.namespace, "default") },
    spec: { selector: { matchLabels: labelsFromValues(values) }, template: podTemplate(values) },
  }),
  extraColumns: [
    { label: "Desired", value: (r) => String(shared.getRecord(r.status).desiredNumberScheduled || 0) },
    { label: "Ready", value: (r) => String(shared.getRecord(r.status).numberReady || 0) },
    { label: "Available", value: (r) => String(shared.getRecord(r.status).numberAvailable || 0) },
  ],
});

export const replicasetsConfig = extensionResource({
  groupVersion: "apps/v1",
  id: "replicasets",
  path: "/kubernetes/workloads/replicasets",
  title: "ReplicaSets",
  subtitle: "Inspect ReplicaSet ownership, selectors, and pod template state",
  kind: "ReplicaSet",
  namespaced: true,
  allowCreate: false,
  statusPath: ["status", "conditions", "0", "type"],
  detailSections: kubernetesReplicaSetDetailSections,
  extraColumns: [{ label: "Ready", value: (r) => `${shared.getRecord(r.status).readyReplicas || 0} / ${shared.getRecord(r.status).replicas || 0}` }],
});

export const jobsConfig = extensionResource({
  groupVersion: "batch/v1",
  id: "jobs",
  path: "/kubernetes/workloads/jobs",
  title: "Jobs",
  subtitle: "Manage one-shot Kubernetes Jobs and completion status",
  kind: "Job",
  namespaced: true,
  statusPath: ["status", "conditions", "0", "type"],
  detailSections: kubernetesJobDetailSections,
  createFields: workloadFields.filter((field) => field.name !== "replicas"),
  buildResource: (values) => ({
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: shared.stringValue(values.name, "example-job"), namespace: shared.stringValue(values.namespace, "default") },
    spec: { template: podTemplate(values, "Never"), backoffLimit: 3 },
  }),
  extraColumns: [{ label: "Succeeded", value: (r) => String(shared.getRecord(r.status).succeeded || 0) }, { label: "Failed", value: (r) => String(shared.getRecord(r.status).failed || 0) }],
});

export const cronjobsConfig = extensionResource({
  groupVersion: "batch/v1",
  id: "cronjobs",
  path: "/kubernetes/workloads/cronjobs",
  title: "CronJobs",
  subtitle: "Manage scheduled Kubernetes Jobs",
  kind: "CronJob",
  namespaced: true,
  statusPath: ["spec", "schedule"],
  detailSections: kubernetesCronJobDetailSections,
  createFields: [...workloadFields.filter((field) => field.name !== "replicas"), { name: "schedule", label: "Schedule", section: "Cron", defaultValue: "*/5 * * * *" }],
  buildResource: (values) => ({
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: shared.stringValue(values.name, "example-cronjob"), namespace: shared.stringValue(values.namespace, "default") },
    spec: { schedule: shared.stringValue(values.schedule, "*/5 * * * *"), jobTemplate: { spec: { template: podTemplate(values, "Never") } } },
  }),
  extraColumns: [{ label: "Schedule", value: (r) => String(shared.getRecord(r.spec).schedule || "N/A") }, { label: "Suspend", value: (r) => String(shared.getRecord(r.spec).suspend || false) }],
});

export const configmapsConfig = namedCoreResource({
  id: "configmaps",
  path: "/kubernetes/config/configmaps",
  title: "ConfigMaps",
  subtitle: "Manage non-sensitive key/value configuration data",
  kind: "ConfigMap",
  namespaced: true,
  detailSections: kubernetesConfigMapDetailSections,
  createFields: [...shared.namespaceNameFields("example-config").slice(2), { name: "data", label: "Data", section: "Data", type: "textarea", defaultValue: "key=value" }],
  buildResource: (values) => ({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: shared.stringValue(values.name, "example-config"), namespace: shared.stringValue(values.namespace, "default") }, data: shared.parseKeyValueText(String(values.data || "")) }),
  extraColumns: [{ label: "Keys", value: (r) => String(Object.keys(shared.getRecord(r).data || {}).length) }],
});

export const kubernetesSecretsConfig = namedCoreResource({
  id: "secrets",
  path: "/kubernetes/config/secrets",
  title: "Secrets",
  subtitle: "Manage Kubernetes Secret metadata and keys",
  kind: "Secret",
  namespaced: true,
  detailSections: kubernetesSecretDetailSections,
  createFields: [{ name: "type", label: "Type", section: "Secret", defaultValue: "Opaque" }, { name: "stringData", label: "String data", section: "Data", type: "textarea", defaultValue: "key=value" }],
  buildResource: (values) => ({ apiVersion: "v1", kind: "Secret", metadata: { name: shared.stringValue(values.name, "example-secret"), namespace: shared.stringValue(values.namespace, "default") }, type: shared.stringValue(values.type, "Opaque"), stringData: shared.parseKeyValueText(String(values.stringData || "")) }),
  extraColumns: [{ label: "Type", value: (r) => String(shared.getRecord(r).type || "Opaque") }, { label: "Keys", value: (r) => String(Object.keys(shared.getRecord(r).data || {}).length) }],
});

export const namespacesConfig = namedCoreResource({
  id: "namespaces",
  path: "/kubernetes/cluster/namespaces",
  title: "Namespaces",
  subtitle: "Manage Kubernetes namespaces and lifecycle state",
  kind: "Namespace",
  namespaced: false,
  statusPath: ["status", "phase"],
  detailSections: kubernetesNamespaceDetailSections,
  buildResource: (values) => ({ apiVersion: "v1", kind: "Namespace", metadata: { name: shared.stringValue(values.name, "example-namespace") } }),
  extraColumns: [{ label: "Phase", value: (r) => String(shared.getRecord(r.status).phase || "N/A") }],
});

export const eventsConfig = namedCoreResource({
  id: "events",
  path: "/kubernetes/cluster/events",
  title: "Events",
  subtitle: "Inspect Kubernetes events across namespaces",
  kind: "Event",
  namespaced: true,
  allowCreate: false,
  allowDelete: false,
  statusPath: ["type"],
  detailSections: kubernetesEventDetailSections,
  extraColumns: [
    { label: "Type", value: (r) => String(shared.getRecord(r).type || "N/A") },
    { label: "Reason", value: (r) => String(shared.getRecord(r).reason || "N/A") },
    { label: "Object", value: (r) => `${shared.getRecord(shared.getRecord(r).involvedObject).kind || ""}/${shared.getRecord(shared.getRecord(r).involvedObject).name || ""}` },
    { label: "Count", value: (r) => String(shared.getRecord(r).count || 1) },
  ],
});

export const serviceaccountsConfig = namedCoreResource({
  id: "serviceaccounts",
  path: "/kubernetes/security/serviceaccounts",
  title: "Service Accounts",
  subtitle: "Manage namespace service identities",
  kind: "ServiceAccount",
  namespaced: true,
  detailSections: kubernetesServiceAccountDetailSections,
  buildResource: (values) => ({ apiVersion: "v1", kind: "ServiceAccount", metadata: { name: shared.stringValue(values.name, "example-serviceaccount"), namespace: shared.stringValue(values.namespace, "default") } }),
  extraColumns: [{ label: "Secrets", value: (r) => String(listValue(shared.getRecord(r).secrets).length) }],
});

export const rolesConfig = extensionResource({
  groupVersion: "rbac.authorization.k8s.io/v1",
  id: "roles",
  path: "/kubernetes/security/roles",
  title: "Roles",
  subtitle: "Manage namespace RBAC permission rules",
  kind: "Role",
  namespaced: true,
  detailSections: kubernetesRoleDetailSections,
  createFields: [{ name: "apiGroups", label: "API groups", section: "Rules", defaultValue: "" }, { name: "resources", label: "Resources", section: "Rules", defaultValue: "pods" }, { name: "verbs", label: "Verbs", section: "Rules", defaultValue: "get,list,watch" }],
  buildResource: (values) => ({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata: { name: shared.stringValue(values.name, "example-role"), namespace: shared.stringValue(values.namespace, "default") }, rules: [{ apiGroups: rbacApiGroups(values.apiGroups), resources: shared.csvList(String(values.resources || "pods")), verbs: shared.csvList(String(values.verbs || "get,list,watch")) }] }),
  extraColumns: [{ label: "Rules", value: (r) => String(listValue(shared.getRecord(r).rules).length) }],
});

export const rolebindingsConfig = extensionResource({
  groupVersion: "rbac.authorization.k8s.io/v1",
  id: "rolebindings",
  path: "/kubernetes/security/rolebindings",
  title: "Role Bindings",
  subtitle: "Bind Roles or ClusterRoles to users, groups, and service accounts",
  kind: "RoleBinding",
  namespaced: true,
  detailSections: kubernetesRoleBindingDetailSections,
  createFields: [{ name: "roleKind", label: "Role kind", section: "Role", type: "select", defaultValue: "Role", options: [{ label: "Role", value: "Role" }, { label: "ClusterRole", value: "ClusterRole" }] }, { name: "roleName", label: "Role name", section: "Role", defaultValue: "example-role" }, { name: "subjectKind", label: "Subject kind", section: "Subject", type: "select", defaultValue: "ServiceAccount", options: [{ label: "ServiceAccount", value: "ServiceAccount" }, { label: "User", value: "User" }, { label: "Group", value: "Group" }] }, { name: "subjectName", label: "Subject name", section: "Subject", defaultValue: "default" }],
  buildResource: (values) => ({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata: { name: shared.stringValue(values.name, "example-rolebinding"), namespace: shared.stringValue(values.namespace, "default") }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: shared.stringValue(values.roleKind, "Role"), name: shared.stringValue(values.roleName, "example-role") }, subjects: [rbacSubject(shared.stringValue(values.subjectKind, "ServiceAccount"), shared.stringValue(values.subjectName, "default"), shared.stringValue(values.namespace, "default"))] }),
  extraColumns: [{ label: "Role", value: (r) => `${shared.getRecord(shared.getRecord(r).roleRef).kind || ""}/${shared.getRecord(shared.getRecord(r).roleRef).name || ""}` }],
});

export const clusterrolesConfig = extensionResource({
  groupVersion: "rbac.authorization.k8s.io/v1",
  id: "clusterroles",
  path: "/kubernetes/security/clusterroles",
  title: "Cluster Roles",
  subtitle: "Manage cluster-scoped RBAC permission rules",
  kind: "ClusterRole",
  namespaced: false,
  detailSections: kubernetesRoleDetailSections,
  createFields: [{ name: "apiGroups", label: "API groups", section: "Rules", defaultValue: "" }, { name: "resources", label: "Resources", section: "Rules", defaultValue: "pods" }, { name: "verbs", label: "Verbs", section: "Rules", defaultValue: "get,list,watch" }],
  buildResource: (values) => ({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", metadata: { name: shared.stringValue(values.name, "example-clusterrole") }, rules: [{ apiGroups: rbacApiGroups(values.apiGroups), resources: shared.csvList(String(values.resources || "pods")), verbs: shared.csvList(String(values.verbs || "get,list,watch")) }] }),
  extraColumns: [{ label: "Rules", value: (r) => String(listValue(shared.getRecord(r).rules).length) }],
});

export const clusterrolebindingsConfig = extensionResource({
  groupVersion: "rbac.authorization.k8s.io/v1",
  id: "clusterrolebindings",
  path: "/kubernetes/security/clusterrolebindings",
  title: "Cluster Role Bindings",
  subtitle: "Bind ClusterRoles across the cluster",
  kind: "ClusterRoleBinding",
  namespaced: false,
  detailSections: kubernetesRoleBindingDetailSections,
  createFields: [{ name: "roleName", label: "Cluster role name", section: "Role", defaultValue: "view" }, { name: "subjectKind", label: "Subject kind", section: "Subject", type: "select", defaultValue: "ServiceAccount", options: [{ label: "ServiceAccount", value: "ServiceAccount" }, { label: "User", value: "User" }, { label: "Group", value: "Group" }] }, { name: "subjectName", label: "Subject name", section: "Subject", defaultValue: "default" }, { name: "subjectNamespace", label: "Subject namespace", section: "Subject", defaultValue: "default" }],
  buildResource: (values) => ({ apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", metadata: { name: shared.stringValue(values.name, "example-clusterrolebinding") }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: shared.stringValue(values.roleName, "view") }, subjects: [rbacSubject(shared.stringValue(values.subjectKind, "ServiceAccount"), shared.stringValue(values.subjectName, "default"), shared.stringValue(values.subjectNamespace, "default"))] }),
  extraColumns: [{ label: "Role", value: (r) => String(shared.getRecord(shared.getRecord(r).roleRef).name || "N/A") }],
});

export const poddisruptionbudgetsConfig = extensionResource({
  groupVersion: "policy/v1",
  id: "poddisruptionbudgets",
  path: "/kubernetes/policy/pod-disruption-budgets",
  title: "Pod Disruption Budgets",
  subtitle: "Manage voluntary disruption limits for selected pods",
  kind: "PodDisruptionBudget",
  namespaced: true,
  detailSections: kubernetesPodDisruptionBudgetDetailSections,
  createFields: [{ name: "minAvailable", label: "Min available", section: "Budget", defaultValue: "1" }, { name: "selectorKey", label: "Selector key", section: "Selector", defaultValue: "app" }, { name: "selectorValue", label: "Selector value", section: "Selector", defaultValue: "example" }],
  buildResource: (values) => {
    const minimum = shared.stringValue(values.minAvailable, "1");
    return { apiVersion: "policy/v1", kind: "PodDisruptionBudget", metadata: { name: shared.stringValue(values.name, "example-pdb"), namespace: shared.stringValue(values.namespace, "default") }, spec: { minAvailable: /^\d+$/.test(minimum) ? Number(minimum) : minimum, selector: { matchLabels: { [shared.stringValue(values.selectorKey, "app")]: shared.stringValue(values.selectorValue, "example") } } } };
  },
  extraColumns: [{ label: "Allowed", value: (r) => String(shared.getRecord(r.status).disruptionsAllowed || 0) }, { label: "Healthy", value: (r) => `${shared.getRecord(r.status).currentHealthy || 0} / ${shared.getRecord(r.status).desiredHealthy || 0}` }],
});

export const customresourcedefinitionsConfig = extensionResource({
  groupVersion: "apiextensions.k8s.io/v1",
  id: "customresourcedefinitions",
  path: "/kubernetes/cluster/custom-resource-definitions",
  title: "Custom Resource Definitions",
  subtitle: "Inspect installed CRDs, versions, scope, and accepted names",
  kind: "CustomResourceDefinition",
  namespaced: false,
  allowCreate: false,
  detailSections: kubernetesCustomResourceDefinitionDetailSections,
  extraColumns: [{ label: "Group", value: (r) => String(shared.getRecord(r.spec).group || "N/A") }, { label: "Scope", value: (r) => String(shared.getRecord(r.spec).scope || "N/A") }],
});

export const componentstatusesConfig = namedCoreResource({
  id: "componentstatuses",
  path: "/kubernetes/cluster/component-statuses",
  title: "Component Statuses",
  subtitle: "Inspect legacy Kubernetes control plane component health",
  kind: "ComponentStatus",
  namespaced: false,
  allowCreate: false,
  allowDelete: false,
  statusPath: ["conditions", "0", "type"],
  extraColumns: [{ label: "Conditions", value: (r) => String(listValue(shared.getRecord(r).conditions).length) }],
});

export const limitrangesConfig = namedCoreResource({
  id: "limitranges",
  path: "/kubernetes/policy/limit-ranges",
  title: "LimitRanges",
  subtitle: "Manage namespace default and maximum compute/storage limits",
  kind: "LimitRange",
  namespaced: true,
  createFields: [
    { name: "type", label: "Limit type", section: "Limits", type: "select", defaultValue: "Container", options: [{ label: "Container", value: "Container" }, { label: "Pod", value: "Pod" }, { label: "PersistentVolumeClaim", value: "PersistentVolumeClaim" }] },
    { name: "defaultCpu", label: "Default CPU", section: "Limits", defaultValue: "500m", description: "Container only." },
    { name: "defaultMemory", label: "Default memory", section: "Limits", defaultValue: "512Mi", description: "Container only." },
    { name: "min", label: "Minimum resources", section: "Limits", type: "textarea", defaultValue: "", description: "Use cpu and memory for Container or Pod; storage for PersistentVolumeClaim.", placeholder: "cpu=100m\nmemory=128Mi" },
    { name: "max", label: "Maximum resources", section: "Limits", type: "textarea", defaultValue: "", description: "Use cpu and memory for Container or Pod; storage for PersistentVolumeClaim.", placeholder: "cpu=2\nmemory=2Gi" },
  ],
  buildResource: (values) => {
    const type = shared.stringValue(values.type, "Container");
    const min = shared.parseKeyValueText(String(values.min || ""));
    const max = shared.parseKeyValueText(String(values.max || ""));
    return { apiVersion: "v1", kind: "LimitRange", metadata: { name: shared.stringValue(values.name, "example-limits"), namespace: shared.stringValue(values.namespace, "default") }, spec: { limits: [{ type, ...(type === "Container" ? { default: { cpu: shared.stringValue(values.defaultCpu, "500m"), memory: shared.stringValue(values.defaultMemory, "512Mi") } } : {}), ...(Object.keys(min).length ? { min } : {}), ...(Object.keys(max).length ? { max } : {}) }] } };
  },
  extraColumns: [{ label: "Rules", value: (r) => String(listValue(shared.getRecord(r.spec).limits).length) }],
});

export const resourcequotasConfig = namedCoreResource({
  id: "resourcequotas",
  path: "/kubernetes/policy/resource-quotas",
  title: "ResourceQuotas",
  subtitle: "Manage namespace hard resource quotas and usage status",
  kind: "ResourceQuota",
  namespaced: true,
  createFields: [{ name: "hard", label: "Hard limits", section: "Quota", type: "textarea", defaultValue: "pods=10\nrequests.cpu=4\nrequests.memory=8Gi" }],
  buildResource: (values) => ({ apiVersion: "v1", kind: "ResourceQuota", metadata: { name: shared.stringValue(values.name, "example-quota"), namespace: shared.stringValue(values.namespace, "default") }, spec: { hard: shared.parseKeyValueText(String(values.hard || "")) } }),
  extraColumns: [{ label: "Hard", value: (r) => String(Object.keys(shared.getRecord(shared.getRecord(r.status).hard || shared.getRecord(r.spec).hard)).length) }, { label: "Used", value: (r) => String(Object.keys(shared.getRecord(shared.getRecord(r.status).used)).length) }],
});

export const podtemplatesConfig = namedCoreResource({
  id: "podtemplates",
  path: "/kubernetes/workloads/pod-templates",
  title: "PodTemplates",
  subtitle: "Manage reusable PodTemplate specs",
  kind: "PodTemplate",
  namespaced: true,
  createFields: workloadFields.filter((field) => field.name !== "replicas"),
  buildResource: (values) => ({ apiVersion: "v1", kind: "PodTemplate", metadata: { name: shared.stringValue(values.name, "example-podtemplate"), namespace: shared.stringValue(values.namespace, "default") }, template: podTemplate(values) }),
  extraColumns: [{ label: "Containers", value: (r) => String(listValue(shared.getRecord(shared.getRecord(shared.getRecord(r).template).spec).containers).length) }],
});

export const replicationcontrollersConfig = namedCoreResource({
  id: "replicationcontrollers",
  path: "/kubernetes/workloads/replication-controllers",
  title: "ReplicationControllers",
  subtitle: "Manage legacy replication controllers and their pod templates",
  kind: "ReplicationController",
  namespaced: true,
  statusPath: ["status", "replicas"],
  createFields: workloadFields,
  buildResource: (values) => ({ apiVersion: "v1", kind: "ReplicationController", metadata: { name: shared.stringValue(values.name, "example-rc"), namespace: shared.stringValue(values.namespace, "default") }, spec: { replicas: shared.replicaCount(values.replicas), selector: labelsFromValues(values), template: podTemplate(values) } }),
  extraColumns: [{ label: "Ready", value: (r) => `${shared.getRecord(r.status).readyReplicas || 0} / ${shared.getRecord(r.status).replicas || 0}` }],
});

export const controllerrevisionsConfig = extensionResource({
  groupVersion: "apps/v1",
  id: "controllerrevisions",
  path: "/kubernetes/workloads/controller-revisions",
  title: "ControllerRevisions",
  subtitle: "Inspect controller revision history records",
  kind: "ControllerRevision",
  namespaced: true,
  allowCreate: false,
  extraColumns: [{ label: "Revision", value: (r) => String(shared.getRecord(r).revision || "N/A") }],
});

export const leasesConfig = extensionResource({
  groupVersion: "coordination.k8s.io/v1",
  id: "leases",
  path: "/kubernetes/cluster/leases",
  title: "Leases",
  subtitle: "Inspect and manage Kubernetes coordination leases",
  kind: "Lease",
  namespaced: true,
  createFields: [{ name: "holderIdentity", label: "Holder identity", section: "Lease", defaultValue: "" }],
  buildResource: (values) => ({ apiVersion: "coordination.k8s.io/v1", kind: "Lease", metadata: { name: shared.stringValue(values.name, "example-lease"), namespace: shared.stringValue(values.namespace, "default") }, spec: { holderIdentity: shared.stringValue(values.holderIdentity) } }),
  extraColumns: [{ label: "Holder", value: (r) => String(shared.getRecord(r.spec).holderIdentity || "N/A") }, { label: "Renew time", value: (r) => String(shared.getRecord(r.spec).renewTime || "N/A") }],
});

export const certificatesigningrequestsConfig = extensionResource({
  groupVersion: "certificates.k8s.io/v1",
  id: "certificatesigningrequests",
  path: "/kubernetes/security/certificate-signing-requests",
  title: "CertificateSigningRequests",
  subtitle: "Inspect Kubernetes certificate signing requests and approval status",
  kind: "CertificateSigningRequest",
  namespaced: false,
  allowCreate: false,
  statusPath: ["status", "conditions", "0", "type"],
  extraColumns: [{ label: "Signer", value: (r) => String(shared.getRecord(r.spec).signerName || "N/A") }, { label: "Username", value: (r) => String(shared.getRecord(r.spec).username || "N/A") }],
});

const admissionFields = [{ name: "failurePolicy", label: "Failure policy", section: "Policy", type: "select" as const, defaultValue: "Fail", options: [{ label: "Fail", value: "Fail" }, { label: "Ignore", value: "Ignore" }] }];
const admissionWebhook = (values: Record<string, string | boolean>) => [{ name: "example.webhook.local", failurePolicy: shared.stringValue(values.failurePolicy, "Fail"), clientConfig: { service: { namespace: "default", name: "webhook-service", path: "/" } }, admissionReviewVersions: ["v1"], sideEffects: "None" }];

export const mutatingwebhookconfigurationsConfig = extensionResource({
  groupVersion: "admissionregistration.k8s.io/v1",
  id: "mutatingwebhookconfigurations",
  path: "/kubernetes/admission/mutating-webhook-configurations",
  title: "MutatingWebhookConfigurations",
  subtitle: "Manage mutating admission webhooks",
  kind: "MutatingWebhookConfiguration",
  namespaced: false,
  createFields: admissionFields,
  buildResource: (values) => ({ apiVersion: "admissionregistration.k8s.io/v1", kind: "MutatingWebhookConfiguration", metadata: { name: shared.stringValue(values.name, "example-mutating-webhook") }, webhooks: admissionWebhook(values) }),
  extraColumns: [{ label: "Webhooks", value: (r) => String(listValue(shared.getRecord(r).webhooks).length) }],
});

export const validatingwebhookconfigurationsConfig = extensionResource({
  groupVersion: "admissionregistration.k8s.io/v1",
  id: "validatingwebhookconfigurations",
  path: "/kubernetes/admission/validating-webhook-configurations",
  title: "ValidatingWebhookConfigurations",
  subtitle: "Manage validating admission webhooks",
  kind: "ValidatingWebhookConfiguration",
  namespaced: false,
  createFields: admissionFields,
  buildResource: (values) => ({ apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingWebhookConfiguration", metadata: { name: shared.stringValue(values.name, "example-validating-webhook") }, webhooks: admissionWebhook(values) }),
  extraColumns: [{ label: "Webhooks", value: (r) => String(listValue(shared.getRecord(r).webhooks).length) }],
});

export const validatingadmissionpoliciesConfig = extensionResource({
  groupVersion: "admissionregistration.k8s.io/v1",
  id: "validatingadmissionpolicies",
  path: "/kubernetes/admission/validating-admission-policies",
  title: "ValidatingAdmissionPolicies",
  subtitle: "Manage CEL-based validating admission policies",
  kind: "ValidatingAdmissionPolicy",
  namespaced: false,
  createFields: [
    { name: "expression", label: "Validation expression", section: "Validation", defaultValue: "true" },
    { name: "matchConstraints", label: "Match constraints (JSON)", section: "Matching", type: "textarea", defaultValue: JSON.stringify({ resourceRules: [{ apiGroups: [""], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["pods"] }] }, null, 2) },
  ],
  buildResource: (values) => ({ apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicy", metadata: { name: shared.stringValue(values.name, "example-validation-policy") }, spec: { matchConstraints: JSON.parse(shared.stringValue(values.matchConstraints)), validations: [{ expression: shared.stringValue(values.expression, "true") }] } }),
  extraColumns: [{ label: "Validations", value: (r) => String(listValue(shared.getRecord(r.spec).validations).length) }],
});

export const validatingadmissionpolicybindingsConfig = extensionResource({
  groupVersion: "admissionregistration.k8s.io/v1",
  id: "validatingadmissionpolicybindings",
  path: "/kubernetes/admission/validating-admission-policy-bindings",
  title: "ValidatingAdmissionPolicyBindings",
  subtitle: "Bind validating admission policies to resources",
  kind: "ValidatingAdmissionPolicyBinding",
  namespaced: false,
  createFields: [{ name: "policyName", label: "Policy name", section: "Policy", defaultValue: "example-validation-policy" }],
  buildResource: (values) => ({ apiVersion: "admissionregistration.k8s.io/v1", kind: "ValidatingAdmissionPolicyBinding", metadata: { name: shared.stringValue(values.name, "example-validation-binding") }, spec: { policyName: shared.stringValue(values.policyName, "example-validation-policy"), validationActions: ["Warn"] } }),
  extraColumns: [{ label: "Policy", value: (r) => String(shared.getRecord(r.spec).policyName || "N/A") }],
});

export const apiservicesConfig = extensionResource({
  groupVersion: "apiregistration.k8s.io/v1",
  id: "apiservices",
  path: "/kubernetes/cluster/api-services",
  title: "APIServices",
  subtitle: "Inspect aggregated Kubernetes API services",
  kind: "APIService",
  namespaced: false,
  allowCreate: false,
  statusPath: ["status", "conditions", "0", "type"],
  extraColumns: [{ label: "Service", value: (r) => `${shared.getRecord(shared.getRecord(r.spec).service).namespace || ""}/${shared.getRecord(shared.getRecord(r.spec).service).name || ""}` }, { label: "Group", value: (r) => String(shared.getRecord(r.spec).group || "core") }],
});

export const flowschemasConfig = extensionResource({
  groupVersion: "flowcontrol.apiserver.k8s.io/v1",
  id: "flowschemas",
  path: "/kubernetes/flow-control/flow-schemas",
  title: "FlowSchemas",
  subtitle: "Manage API priority and fairness flow schemas",
  kind: "FlowSchema",
  namespaced: false,
  allowCreate: false,
  statusPath: ["status", "conditions", "0", "type"],
  extraColumns: [{ label: "Priority level", value: (r) => String(shared.getRecord(shared.getRecord(r.spec).priorityLevelConfiguration).name || "N/A") }],
});

export const prioritylevelconfigurationsConfig = extensionResource({
  groupVersion: "flowcontrol.apiserver.k8s.io/v1",
  id: "prioritylevelconfigurations",
  path: "/kubernetes/flow-control/priority-level-configurations",
  title: "PriorityLevelConfigurations",
  subtitle: "Manage API priority and fairness priority levels",
  kind: "PriorityLevelConfiguration",
  namespaced: false,
  allowCreate: false,
  statusPath: ["status", "conditions", "0", "type"],
  extraColumns: [{ label: "Type", value: (r) => String(shared.getRecord(r.spec).type || "N/A") }],
});

export const runtimeclassesConfig = extensionResource({
  groupVersion: "node.k8s.io/v1",
  id: "runtimeclasses",
  path: "/kubernetes/cluster/runtime-classes",
  title: "RuntimeClasses",
  subtitle: "Manage container runtime class handlers",
  kind: "RuntimeClass",
  namespaced: false,
  createFields: [{ name: "handler", label: "Handler", section: "Runtime", defaultValue: "runc" }],
  buildResource: (values) => ({ apiVersion: "node.k8s.io/v1", kind: "RuntimeClass", metadata: { name: shared.stringValue(values.name, "example-runtimeclass") }, handler: shared.stringValue(values.handler, "runc") }),
  extraColumns: [{ label: "Handler", value: (r) => String(shared.getRecord(r).handler || "N/A") }],
});

export const priorityclassesConfig = extensionResource({
  groupVersion: "scheduling.k8s.io/v1",
  id: "priorityclasses",
  path: "/kubernetes/cluster/priority-classes",
  title: "PriorityClasses",
  subtitle: "Manage pod scheduling priority classes",
  kind: "PriorityClass",
  namespaced: false,
  createFields: [{ name: "value", label: "Priority value", section: "Priority", type: "number", defaultValue: "1000" }, { name: "globalDefault", label: "Global default", section: "Priority", type: "checkbox", defaultValue: false }],
  buildResource: (values) => ({ apiVersion: "scheduling.k8s.io/v1", kind: "PriorityClass", metadata: { name: shared.stringValue(values.name, "example-priority") }, value: shared.numberValue(values.value, 1000), globalDefault: values.globalDefault === true }),
  extraColumns: [{ label: "Value", value: (r) => String(shared.getRecord(r).value || 0) }, { label: "Default", value: (r) => String(shared.getRecord(r).globalDefault || false) }],
});
