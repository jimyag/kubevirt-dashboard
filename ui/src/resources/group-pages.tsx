import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import type { ResourceConfig } from "@/components/resource-management";
import { DataTable, EmptyState, FilterInput, PageHeader, Section, Toolbar } from "@/components/console";
import { useFilteredRows, type FilterField } from "@/lib/filter";
import {
  apiVersionFromListPath,
  expandListPaths as listPathCandidates,
  resourceNameFromListPath,
} from "./api-paths";
import { dvCreateConfig, resourceConfigs, vmCreateConfig } from "./configs";
import { resourceLabel, t } from "@/lib/i18n";

const getContext = () => localStorage.getItem("kube-context") || "";

const apiFetch = (url: string) => {
  const headers = new Headers({ Accept: "application/json" });
  const ctx = getContext();
  if (ctx) headers.set("X-Kube-Context", ctx);
  return fetch(url, { headers });
};

type DiscoveryData = {
  apiVersions: string[];
  apiResources: Array<{ name: string; apiVersion: string }>;
};

function useAvailableResources(resources: ResourceConfig[]) {
  const [available, setAvailable] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/v1/discovery").then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return await response.json() as DiscoveryData;
    }).then((data) => {
      if (cancelled) return;
      const apiVersions = new Set(data.apiVersions || []);
      const apiResources = new Set((data.apiResources || []).map((resource) => `${resource.apiVersion}/${resource.name}`));
      setAvailable(Object.fromEntries(resources.map((config) => {
        const served = listPathCandidates(config).some((listPath) => {
          const apiVersion = apiVersionFromListPath(listPath);
          const resourceName = resourceNameFromListPath(listPath, config.id);
          return apiVersions.has(apiVersion) && apiResources.has(`${apiVersion}/${resourceName}`);
        });
        return [config.path, served];
      })));
    }).catch(() => {
      if (cancelled) return;
      setAvailable(Object.fromEntries(resources.map((config) => [config.path, false])));
    });

    return () => {
      cancelled = true;
    };
  }, [resources]);

  return available;
}

const configFields: FilterField<ResourceConfig>[] = [
  // Match both the English and the translated title.
  { key: "name", label: "Name", value: (config) => [config.title, resourceLabel(config.title)] },
  { key: "kind", label: "Kind", value: (config) => config.kind },
  { key: "api", label: "API", value: (config) => apiVersionFromListPath(config.listPath) || "v1" },
  { key: "scope", label: "Scope", value: (config) => (config.namespaced ? "Namespaced" : "Cluster") },
]

function ResourceConfigTable({ resources, query = "" }: { resources: ResourceConfig[]; query?: string }) {
  const available = useAvailableResources(resources)
  const visibleResources = useMemo(() => resources.filter((config) => available[config.path] !== false), [available, resources])
  const matched = useFilteredRows(visibleResources, configFields, query)
  const hidden = resources.length - visibleResources.length

  if (Object.keys(available).length > 0 && visibleResources.length === 0) {
    return query ? null : <p className="text-sm text-muted-foreground">{t("Not served by this cluster.")}</p>
  }
  if (query.trim() && matched.length === 0) return null

  return (
    <div className="space-y-2">
      <DataTable
        rows={matched}
        rowKey={(config) => config.path}
        minWidth={640}
        empty={<EmptyState title={t("Not served by this cluster")} />}
        columns={[
          { header: t("Resource"), cell: (config) => <Link to={config.path} className="font-medium hover:text-primary transition-colors">{resourceLabel(config.title)}</Link> },
          { header: t("Kind"), cell: (config) => <span className="font-mono text-xs">{config.kind}</span> },
          { header: t("API"), cell: (config) => <span className="font-mono text-xs text-muted-foreground">{apiVersionFromListPath(config.listPath) || "v1"}</span> },
          { header: t("Scope"), className: "text-right", cell: (config) => <span className="text-sm text-muted-foreground">{config.namespaced ? t("Namespaced") : t("Cluster")}</span> },
        ]}
      />
      {hidden > 0 && !query.trim() && <p className="text-xs text-muted-foreground">{t("{count} not served by this cluster, hidden.", { count: hidden })}</p>}
    </div>
  )
}

export type ResourceGroup = {
  slug: string
  title: string
  description: string
  resources: ResourceConfig[]
}

const allResources = (groups: ResourceGroup[]) => groups.flatMap((group) => group.resources)

function GroupIndexPage({ title, base, groups }: { title: string; base: string; groups: ResourceGroup[] }) {
  const [query, setQuery] = useState("")
  const rows = useMemo(() => allResources(groups), [groups])
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: t("Resource Catalog"), to: "/catalog" }, { label: title }]} title={title} />
      <Toolbar right={<FilterInput value={query} onChange={setQuery} fields={configFields} rows={rows} placeholder={t("Filter, e.g. pod kind:Deployment")} />} />
      {groups.map((group) => (
        <GroupSection key={group.slug} group={group} base={base} query={query} />
      ))}
    </div>
  )
}

/** A group's table under its title; renders nothing when a query matches none of its resources. */
function GroupSection({ group, base, query }: { group: ResourceGroup; base: string; query: string }) {
  const matched = useFilteredRows(group.resources, configFields, query)
  if (query.trim() && matched.length === 0) return null
  return (
    <Section title={<Link to={`${base}/${group.slug}`} className="hover:text-primary transition-colors">{t(group.title)}</Link>}>
      <ResourceConfigTable resources={group.resources} query={query} />
    </Section>
  )
}

/**
 * Search over every catalog resource for the Resource Catalog page; shows `children` (the
 * provider list) while the query is empty.
 */
export function ResourceCatalogSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")
  const rows = useMemo(
    () => allResources([...kubevirtResourceGroups, ...storageResourceGroups, ...networkResourceGroups, ...kubernetesResourceGroups])
      .filter((config, index, list) => list.findIndex((item) => item.path === config.path) === index),
    [],
  )
  const matched = useFilteredRows(rows, configFields, query)
  return (
    <div className="space-y-4">
      <Toolbar right={<FilterInput value={query} onChange={setQuery} fields={configFields} rows={rows} placeholder={t("Filter, e.g. pod kind:Deployment")} />} />
      {!query.trim() ? children : matched.length === 0 ? (
        <div className="rounded-lg border bg-card"><EmptyState title={t("No matching resources")} /></div>
      ) : (
        <ResourceConfigTable resources={rows} query={query} />
      )}
    </div>
  )
}

function GroupCategoryPage({ title, base, groups }: { title: string; base: string; groups: ResourceGroup[] }) {
  const { category } = useParams()
  const [query, setQuery] = useState("")
  const group = groups.find((item) => item.slug === category)
  if (!group) return <EmptyState title={t("{v0} category not found", { v0: title })} />
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: t("Resource Catalog"), to: "/catalog" }, { label: title, to: base }, { label: group.title }]}
        title={t(group.title)}
        subtitle={t(group.description)}
      />
      <Toolbar right={<FilterInput value={query} onChange={setQuery} fields={configFields} rows={group.resources} placeholder={t("Filter, e.g. pod kind:Deployment")} />} />
      <ResourceConfigTable resources={group.resources} query={query} />
    </div>
  )
}


const kubernetesResourceGroups: ResourceGroup[] = [
  {
    slug: "workloads",
    title: "Workloads and scaling",
    description: "Pods, workload controllers, Jobs, CronJobs, and HorizontalPodAutoscalers.",
    resources: [
      resourceConfigs.pods,
      resourceConfigs.deployments,
      resourceConfigs.statefulsets,
      resourceConfigs.daemonsets,
      resourceConfigs.replicasets,
      resourceConfigs.replicationcontrollers,
      resourceConfigs.controllerrevisions,
      resourceConfigs.podtemplates,
      resourceConfigs.jobs,
      resourceConfigs.cronjobs,
      resourceConfigs.horizontalpodautoscalers,
    ],
  },
  {
    slug: "config",
    title: "Config",
    description: "ConfigMaps and Secrets used by Kubernetes workloads.",
    resources: [
      resourceConfigs.configmaps,
      resourceConfigs.kubernetesSecrets,
    ],
  },
  {
    slug: "security",
    title: "Security",
    description: "ServiceAccounts, Roles, RoleBindings, ClusterRoles, and ClusterRoleBindings.",
    resources: [
      resourceConfigs.serviceaccounts,
      resourceConfigs.roles,
      resourceConfigs.rolebindings,
      resourceConfigs.clusterroles,
      resourceConfigs.clusterrolebindings,
    ],
  },
  {
    slug: "policy",
    title: "Policy",
    description: "Disruption and scheduling-adjacent Kubernetes policy resources.",
    resources: [
      resourceConfigs.poddisruptionbudgets,
      resourceConfigs.limitranges,
      resourceConfigs.resourcequotas,
    ],
  },
  {
    slug: "cluster",
    title: "Cluster definitions",
    description: "Namespaces, Events, CRDs, API services, leases, runtime classes, and scheduling classes.",
    resources: [
      resourceConfigs.namespaces,
      resourceConfigs.events,
      resourceConfigs.componentstatuses,
      resourceConfigs.customresourcedefinitions,
      resourceConfigs.apiservices,
      resourceConfigs.leases,
      resourceConfigs.runtimeclasses,
      resourceConfigs.priorityclasses,
    ],
  },
  {
    slug: "admission",
    title: "Admission",
    description: "Webhook and CEL admission policy resources.",
    resources: [
      resourceConfigs.mutatingwebhookconfigurations,
      resourceConfigs.validatingwebhookconfigurations,
      resourceConfigs.validatingadmissionpolicies,
      resourceConfigs.validatingadmissionpolicybindings,
    ],
  },
  {
    slug: "flow-control",
    title: "Flow control",
    description: "API priority and fairness flow schemas and priority levels.",
    resources: [
      resourceConfigs.flowschemas,
      resourceConfigs.prioritylevelconfigurations,
    ],
  },
  {
    slug: "certificates",
    title: "Certificates",
    description: "Certificate signing request inspection and lifecycle.",
    resources: [
      resourceConfigs.certificatesigningrequests,
    ],
  },
];



const kubevirtResourceGroups: ResourceGroup[] = [
  {
    slug: "virtualization",
    title: "Virtualization",
    description: "VirtualMachine, live VMI, pools, replica sets, and KubeVirt installation resources.",
    resources: [
      vmCreateConfig,
      resourceConfigs.virtualmachineinstances,
      resourceConfigs.virtualmachinepools,
      resourceConfigs.virtualmachineinstancereplicasets,
      resourceConfigs.kubevirts,
    ],
  },
  {
    slug: "cdi",
    title: "CDI storage",
    description: "DataVolume, DataSource, StorageProfile, import, upload, clone, and transfer resources.",
    resources: [
      dvCreateConfig,
      resourceConfigs.datasources,
      resourceConfigs.storageprofiles,
      resourceConfigs.dataimportcrons,
      resourceConfigs.volumeimportsources,
      resourceConfigs.volumeuploadsources,
      resourceConfigs.volumeclonesources,
      resourceConfigs.objecttransfers,
    ],
  },
  {
    slug: "templates",
    title: "Templates",
    description: "KubeVirt instance type and preference resources.",
    resources: [
      resourceConfigs.virtualmachineinstancetypes,
      resourceConfigs.virtualmachinepreferences,
    ],
  },
  {
    slug: "snapshots",
    title: "Snapshots",
    description: "VirtualMachine snapshot, restore, and snapshot content resources.",
    resources: [
      resourceConfigs.virtualmachinesnapshots,
      resourceConfigs.virtualmachinerestores,
      resourceConfigs.virtualmachinesnapshotcontents,
    ],
  },
  {
    slug: "operations",
    title: "Operations",
    description: "KubeVirt migration and operational resources.",
    resources: [
      resourceConfigs.virtualmachineinstancemigrations,
      resourceConfigs.secrets,
    ],
  },
];



const storageResourceGroups: ResourceGroup[] = [
  {
    slug: "kubernetes",
    title: "Kubernetes",
    description: "Native StorageClass, PersistentVolume, and PersistentVolumeClaim resources.",
    resources: [
      resourceConfigs.storageclasses,
      resourceConfigs.persistentvolumes,
      resourceConfigs.persistentvolumeclaims,
      resourceConfigs.csidrivers,
      resourceConfigs.csinodes,
      resourceConfigs.csistoragecapacities,
      resourceConfigs.volumeattachments,
      resourceConfigs.volumeattributesclasses,
      resourceConfigs.volumesnapshotclasses,
      resourceConfigs.volumesnapshots,
      resourceConfigs.volumesnapshotcontents,
    ],
  },
];



const networkResourceGroups: ResourceGroup[] = [
  {
    slug: "kubernetes",
    title: "Kubernetes",
    description: "Core Service, Endpoint, Ingress, NetworkPolicy, IngressClass, and Multus resources.",
    resources: [
      resourceConfigs.kubernetesServices,
      resourceConfigs.endpoints,
      resourceConfigs.endpointSlices,
      resourceConfigs["network-attachment-definitions"],
      resourceConfigs.networkpolicies,
      resourceConfigs.ingresses,
      resourceConfigs.ingressClasses,
    ],
  },
  {
    slug: "gateway-api",
    title: "Gateway API",
    description: "GatewayClass, Gateway, and HTTPRoute routing resources.",
    resources: [
      resourceConfigs.gatewayclasses,
      resourceConfigs.gateways,
      resourceConfigs.httproutes,
    ],
  },
  {
    slug: "calico",
    title: "Calico",
    description: "Calico policy, BGP, IPAM, host endpoint, tier, and controller resources.",
    resources: [
      resourceConfigs.calicoNetworkPolicies,
      resourceConfigs.calicoGlobalNetworkPolicies,
      resourceConfigs.calicoIPPools,
      resourceConfigs.calicoTiers,
      resourceConfigs.calicoNetworkSets,
      resourceConfigs.calicoGlobalNetworkSets,
      resourceConfigs.calicoStagedNetworkPolicies,
      resourceConfigs.calicoStagedGlobalNetworkPolicies,
      resourceConfigs.calicoStagedKubernetesNetworkPolicies,
      resourceConfigs.calicoHostEndpoints,
      resourceConfigs.calicoBGPConfigurations,
      resourceConfigs.calicoBGPPeers,
      resourceConfigs.calicoBGPFilters,
      resourceConfigs.calicoFelixConfigurations,
      resourceConfigs.calicoKubeControllersConfigurations,
      resourceConfigs.calicoIPReservations,
      resourceConfigs.calicoBlockAffinities,
      resourceConfigs.calicoCalicoNodeStatuses,
      resourceConfigs.calicoClusterInformations,
      resourceConfigs.calicoIPAMBlocks,
      resourceConfigs.calicoIPAMConfigs,
      resourceConfigs.calicoIPAMHandles,
    ],
  },
  {
    slug: "cilium",
    title: "Cilium",
    description: "Cilium policy, endpoint, BGP, Envoy, IP pool, egress, L2, and Gateway resources.",
    resources: [
      resourceConfigs.ciliumNetworkPolicies,
      resourceConfigs.ciliumClusterwideNetworkPolicies,
      resourceConfigs.ciliumNodes,
      resourceConfigs.ciliumEndpoints,
      resourceConfigs.ciliumEndpointSlices,
      resourceConfigs.ciliumIdentities,
      resourceConfigs.ciliumEnvoyConfigs,
      resourceConfigs.ciliumClusterwideEnvoyConfigs,
      resourceConfigs.ciliumCIDRGroups,
      resourceConfigs.ciliumEgressGatewayPolicies,
      resourceConfigs.ciliumLoadBalancerIPPools,
      resourceConfigs.ciliumLocalRedirectPolicies,
      resourceConfigs.ciliumL2AnnouncementPolicies,
      resourceConfigs.ciliumPodIPPools,
      resourceConfigs.ciliumGatewayClassConfigs,
      resourceConfigs.ciliumNodeConfigs,
      resourceConfigs.ciliumDatapathPlugins,
      resourceConfigs.ciliumBGPAdvertisements,
      resourceConfigs.ciliumBGPClusterConfigs,
      resourceConfigs.ciliumBGPNodeConfigs,
      resourceConfigs.ciliumBGPNodeConfigOverrides,
      resourceConfigs.ciliumBGPPeerConfigs,
    ],
  },
  {
    slug: "kube-ovn",
    title: "Kube-OVN",
    description: "Kube-OVN subnet, VPC, NAT, egress, IP, policy, and provider network resources.",
    resources: [
      resourceConfigs.kubeOvnSubnets,
      resourceConfigs.kubeOvnVpcs,
      resourceConfigs.kubeOvnProviderNetworks,
      resourceConfigs.kubeOvnVlans,
      resourceConfigs.kubeOvnIPPools,
      resourceConfigs.kubeOvnIPs,
      resourceConfigs.kubeOvnVpcNatGateways,
      resourceConfigs.kubeOvnIptablesEIPs,
      resourceConfigs.kubeOvnIptablesDnatRules,
      resourceConfigs.kubeOvnIptablesSnatRules,
      resourceConfigs.kubeOvnIptablesFIPRules,
      resourceConfigs.kubeOvnOvnEips,
      resourceConfigs.kubeOvnOvnDnatRules,
      resourceConfigs.kubeOvnOvnSnatRules,
      resourceConfigs.kubeOvnOvnFips,
      resourceConfigs.kubeOvnVips,
      resourceConfigs.kubeOvnSwitchLBRules,
      resourceConfigs.kubeOvnVpcDnses,
      resourceConfigs.kubeOvnVpcEgressGateways,
      resourceConfigs.kubeOvnQoSPolicies,
      resourceConfigs.kubeOvnSecurityGroups,
      resourceConfigs.kubeOvnBgpConfs,
      resourceConfigs.kubeOvnEvpnConfs,
      resourceConfigs.kubeOvnDNSNameResolvers,
    ],
  },
];

export const KubernetesManagementPage = () => <GroupIndexPage title={t("Kubernetes")} base="/kubernetes" groups={kubernetesResourceGroups} />
export const KubernetesCategoryPage = () => <GroupCategoryPage title={t("Kubernetes")} base="/kubernetes" groups={kubernetesResourceGroups} />
export const KubeVirtManagementPage = () => <GroupIndexPage title={t("KubeVirt")} base="/kubevirt" groups={kubevirtResourceGroups} />
export const KubeVirtCategoryPage = () => <GroupCategoryPage title={t("KubeVirt")} base="/kubevirt" groups={kubevirtResourceGroups} />
export const StorageManagementPage = () => <GroupIndexPage title={t("Storage")} base="/storage" groups={storageResourceGroups} />
export const StorageCategoryPage = () => <GroupCategoryPage title={t("Storage")} base="/storage" groups={storageResourceGroups} />
export const NetworkManagementPage = () => <GroupIndexPage title={t("Networks")} base="/networks" groups={networkResourceGroups} />
export const NetworkCategoryPage = () => <GroupCategoryPage title={t("Networks")} base="/networks" groups={networkResourceGroups} />
