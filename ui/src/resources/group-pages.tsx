import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ResourceConfig } from "@/components/resource-management";
import { DataTable, EmptyState, PageHeader, Section } from "@/components/console";
import {
  apiVersionFromListPath,
  expandListPaths as listPathCandidates,
  resourceNameFromListPath,
} from "./api-paths";
import { dvCreateConfig, resourceConfigs, vmCreateConfig } from "./configs";

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

function ResourceConfigTable({ resources }: { resources: ResourceConfig[] }) {
  const available = useAvailableResources(resources)
  const visibleResources = useMemo(() => resources.filter((config) => available[config.path] !== false), [available, resources])
  const hidden = resources.length - visibleResources.length

  if (Object.keys(available).length > 0 && visibleResources.length === 0) {
    return <p className="text-sm text-muted-foreground">Not served by this cluster.</p>
  }

  return (
    <div className="space-y-2">
      <DataTable
        rows={visibleResources}
        rowKey={(config) => config.path}
        minWidth={640}
        empty={<EmptyState title="Not served by this cluster" />}
        columns={[
          { header: "Resource", cell: (config) => <Link to={config.path} className="font-medium hover:text-primary transition-colors">{config.title}</Link> },
          { header: "Kind", cell: (config) => <span className="font-mono text-xs">{config.kind}</span> },
          { header: "API", cell: (config) => <span className="font-mono text-xs text-muted-foreground">{apiVersionFromListPath(config.listPath) || "v1"}</span> },
          { header: "Scope", className: "text-right", cell: (config) => <span className="text-sm text-muted-foreground">{config.namespaced ? "Namespaced" : "Cluster"}</span> },
        ]}
      />
      {hidden > 0 && <p className="text-xs text-muted-foreground">{hidden} not served by this cluster, hidden.</p>}
    </div>
  )
}

type ResourceGroup = {
  slug: string
  title: string
  description: string
  resources: ResourceConfig[]
}

function GroupIndexPage({ title, base, groups }: { title: string; base: string; groups: ResourceGroup[] }) {
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Resource Catalog", to: "/catalog" }, { label: title }]} title={title} />
      {groups.map((group) => (
        <Section key={group.slug} title={<Link to={`${base}/${group.slug}`} className="hover:text-primary transition-colors">{group.title}</Link>}>
          <ResourceConfigTable resources={group.resources} />
        </Section>
      ))}
    </div>
  )
}

function GroupCategoryPage({ title, base, groups }: { title: string; base: string; groups: ResourceGroup[] }) {
  const { category } = useParams()
  const group = groups.find((item) => item.slug === category)
  if (!group) return <EmptyState title={`${title} category not found`} />
  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "Resource Catalog", to: "/catalog" }, { label: title, to: base }, { label: group.title }]}
        title={group.title}
        subtitle={group.description}
      />
      <ResourceConfigTable resources={group.resources} />
    </div>
  )
}


const kubernetesResourceGroups: ResourceGroup[] = [
  {
    slug: "workloads",
    title: "Workloads And Scaling",
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
    title: "Cluster Definitions",
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
    title: "Flow Control",
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
    title: "CDI Storage",
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
      resourceConfigs.virtualmachineclusterinstancetypes,
      resourceConfigs.virtualmachineclusterpreferences,
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

export const KubernetesManagementPage = () => <GroupIndexPage title="Kubernetes" base="/kubernetes" groups={kubernetesResourceGroups} />
export const KubernetesCategoryPage = () => <GroupCategoryPage title="Kubernetes" base="/kubernetes" groups={kubernetesResourceGroups} />
export const KubeVirtManagementPage = () => <GroupIndexPage title="KubeVirt" base="/kubevirt" groups={kubevirtResourceGroups} />
export const KubeVirtCategoryPage = () => <GroupCategoryPage title="KubeVirt" base="/kubevirt" groups={kubevirtResourceGroups} />
export const StorageManagementPage = () => <GroupIndexPage title="Storage" base="/storage" groups={storageResourceGroups} />
export const StorageCategoryPage = () => <GroupCategoryPage title="Storage" base="/storage" groups={storageResourceGroups} />
export const NetworkManagementPage = () => <GroupIndexPage title="Networks" base="/networks" groups={networkResourceGroups} />
export const NetworkCategoryPage = () => <GroupCategoryPage title="Networks" base="/networks" groups={networkResourceGroups} />
