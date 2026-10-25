import type { ResourceConfig } from "@/components/resource-management";
export { keyValueText, mergePatch, jsonPost, jsonPut, numberValue, parseKeyValueText, stringValue } from "./config/shared";
export { vmCreateConfig } from "./config/virtualmachines";
export { dvCreateConfig } from "./config/datavolume-create";
import { virtualmachinepoolsConfig } from "./config/virtualmachinepools";
import { virtualmachineinstancesConfig } from "./config/virtualmachineinstances";
import { virtualmachineinstancemigrationsConfig } from "./config/virtualmachineinstancemigrations";
import { virtualmachineinstancereplicasetsConfig } from "./config/virtualmachineinstancereplicasets";
import { kubevirtsConfig } from "./config/kubevirts";
import { nodesConfig } from "./config/nodes";
import { networkAttachmentDefinitionsConfig } from "./config/network-attachment-definitions";
import { virtualmachineinstancetypesConfig } from "./config/virtualmachineinstancetypes";
import { virtualmachinepreferencesConfig } from "./config/virtualmachinepreferences";
import { virtualmachinesnapshotsConfig } from "./config/virtualmachinesnapshots";
import { virtualmachinerestoresConfig } from "./config/virtualmachinerestores";
import { virtualmachinesnapshotcontentsConfig } from "./config/virtualmachinesnapshotcontents";
import { datavolumesConfig } from "./config/datavolumes";
import { datasourcesConfig } from "./config/datasources";
import { storageprofilesConfig } from "./config/storageprofiles";
import { dataimportcronsConfig } from "./config/dataimportcrons";
import { volumeimportsourcesConfig } from "./config/volumeimportsources";
import { volumeuploadsourcesConfig } from "./config/volumeuploadsources";
import { volumeclonesourcesConfig } from "./config/volumeclonesources";
import { objecttransfersConfig } from "./config/objecttransfers";
import { secretsConfig } from "./config/secrets";
import { storageclassesConfig } from "./config/storageclasses";
import { persistentvolumeclaimsConfig } from "./config/persistentvolumeclaims";
import { persistentvolumesConfig } from "./config/persistentvolumes";
import { csidriversConfig } from "./config/csidrivers";
import { csinodesConfig } from "./config/csinodes";
import { csistoragecapacitiesConfig } from "./config/csistoragecapacities";
import { volumeattachmentsConfig } from "./config/volumeattachments";
import { volumeattributesclassesConfig } from "./config/volumeattributesclasses";
import { volumesnapshotclassesConfig } from "./config/volumesnapshotclasses";
import { volumesnapshotsConfig } from "./config/volumesnapshots";
import { volumesnapshotcontentsConfig } from "./config/volumesnapshotcontents";
import { networkpoliciesConfig } from "./config/networkpolicies";
import { ingressesConfig } from "./config/ingresses";
import { kubernetesServicesConfig } from "./config/kubernetesservices";
import { endpointsConfig } from "./config/endpoints";
import { endpointSlicesConfig } from "./config/endpointslices";
import { ingressClassesConfig } from "./config/ingressclasses";
import { gatewayclassesConfig } from "./config/gatewayclasses";
import { gatewaysConfig } from "./config/gateways";
import { httproutesConfig } from "./config/httproutes";
import { calicoNetworkPoliciesConfig } from "./config/caliconetworkpolicies";
import { calicoGlobalNetworkPoliciesConfig } from "./config/calicoglobalnetworkpolicies";
import { calicoIPPoolsConfig } from "./config/calicoippools";
import { calicoTiersConfig } from "./config/calicotiers";
import { calicoNetworkSetsConfig } from "./config/caliconetworksets";
import { calicoGlobalNetworkSetsConfig } from "./config/calicoglobalnetworksets";
import { calicoStagedNetworkPoliciesConfig } from "./config/calicostagednetworkpolicies";
import { calicoStagedGlobalNetworkPoliciesConfig } from "./config/calicostagedglobalnetworkpolicies";
import { calicoStagedKubernetesNetworkPoliciesConfig } from "./config/calicostagedkubernetesnetworkpolicies";
import { calicoHostEndpointsConfig } from "./config/calicohostendpoints";
import { calicoBGPConfigurationsConfig } from "./config/calicobgpconfigurations";
import { calicoBGPPeersConfig } from "./config/calicobgppeers";
import { calicoBGPFiltersConfig } from "./config/calicobgpfilters";
import { calicoFelixConfigurationsConfig } from "./config/calicofelixconfigurations";
import { calicoKubeControllersConfigurationsConfig } from "./config/calicokubecontrollersconfigurations";
import { calicoIPReservationsConfig } from "./config/calicoipreservations";
import { calicoBlockAffinitiesConfig } from "./config/calicoblockaffinities";
import { calicoCalicoNodeStatusesConfig } from "./config/calicocaliconodestatuses";
import { calicoClusterInformationsConfig } from "./config/calicoclusterinformations";
import { calicoIPAMBlocksConfig } from "./config/calicoipamblocks";
import { calicoIPAMConfigsConfig } from "./config/calicoipamconfigs";
import { calicoIPAMHandlesConfig } from "./config/calicoipamhandles";
import { ciliumNetworkPoliciesConfig } from "./config/ciliumnetworkpolicies";
import { ciliumClusterwideNetworkPoliciesConfig } from "./config/ciliumclusterwidenetworkpolicies";
import { ciliumNodesConfig } from "./config/ciliumnodes";
import { ciliumEndpointsConfig } from "./config/ciliumendpoints";
import { ciliumEndpointSlicesConfig } from "./config/ciliumendpointslices";
import { ciliumIdentitiesConfig } from "./config/ciliumidentities";
import { ciliumEnvoyConfigsConfig } from "./config/ciliumenvoyconfigs";
import { ciliumClusterwideEnvoyConfigsConfig } from "./config/ciliumclusterwideenvoyconfigs";
import { ciliumCIDRGroupsConfig } from "./config/ciliumcidrgroups";
import { ciliumEgressGatewayPoliciesConfig } from "./config/ciliumegressgatewaypolicies";
import { ciliumLoadBalancerIPPoolsConfig } from "./config/ciliumloadbalancerippools";
import { ciliumLocalRedirectPoliciesConfig } from "./config/ciliumlocalredirectpolicies";
import { ciliumL2AnnouncementPoliciesConfig } from "./config/ciliuml2announcementpolicies";
import { ciliumPodIPPoolsConfig } from "./config/ciliumpodippools";
import { ciliumGatewayClassConfigsConfig } from "./config/ciliumgatewayclassconfigs";
import { ciliumNodeConfigsConfig } from "./config/ciliumnodeconfigs";
import { ciliumDatapathPluginsConfig } from "./config/ciliumdatapathplugins";
import { ciliumBGPAdvertisementsConfig } from "./config/ciliumbgpadvertisements";
import { ciliumBGPClusterConfigsConfig } from "./config/ciliumbgpclusterconfigs";
import { ciliumBGPNodeConfigsConfig } from "./config/ciliumbgpnodeconfigs";
import { ciliumBGPNodeConfigOverridesConfig } from "./config/ciliumbgpnodeconfigoverrides";
import { ciliumBGPPeerConfigsConfig } from "./config/ciliumbgppeerconfigs";
import { kubeOvnSubnetsConfig } from "./config/kubeovnsubnets";
import { kubeOvnVpcsConfig } from "./config/kubeovnvpcs";
import { kubeOvnProviderNetworksConfig } from "./config/kubeovnprovidernetworks";
import { kubeOvnVlansConfig } from "./config/kubeovnvlans";
import { kubeOvnIPPoolsConfig } from "./config/kubeovnippools";
import { kubeOvnIPsConfig } from "./config/kubeovnips";
import { kubeOvnVpcNatGatewaysConfig } from "./config/kubeovnvpcnatgateways";
import { kubeOvnIptablesEIPsConfig } from "./config/kubeovniptableseips";
import { kubeOvnIptablesDnatRulesConfig } from "./config/kubeovniptablesdnatrules";
import { kubeOvnIptablesSnatRulesConfig } from "./config/kubeovniptablessnatrules";
import { kubeOvnIptablesFIPRulesConfig } from "./config/kubeovniptablesfiprules";
import { kubeOvnOvnEipsConfig } from "./config/kubeovnovneips";
import { kubeOvnOvnDnatRulesConfig } from "./config/kubeovnovndnatrules";
import { kubeOvnOvnSnatRulesConfig } from "./config/kubeovnovnsnatrules";
import { kubeOvnOvnFipsConfig } from "./config/kubeovnovnfips";
import { kubeOvnVipsConfig } from "./config/kubeovnvips";
import { kubeOvnSwitchLBRulesConfig } from "./config/kubeovnswitchlbrules";
import { kubeOvnVpcDnsesConfig } from "./config/kubeovnvpcdnses";
import { kubeOvnVpcEgressGatewaysConfig } from "./config/kubeovnvpcegressgateways";
import { kubeOvnQoSPoliciesConfig } from "./config/kubeovnqospolicies";
import { kubeOvnSecurityGroupsConfig } from "./config/kubeovnsecuritygroups";
import { kubeOvnBgpConfsConfig } from "./config/kubeovnbgpconfs";
import { kubeOvnEvpnConfsConfig } from "./config/kubeovnevpnconfs";
import { kubeOvnDNSNameResolversConfig } from "./config/kubeovndnsnameresolvers";
import { horizontalpodautoscalersConfig } from "./config/horizontalpodautoscalers";
import {
  apiservicesConfig,
  certificatesigningrequestsConfig,
  clusterrolebindingsConfig,
  clusterrolesConfig,
  componentstatusesConfig,
  configmapsConfig,
  controllerrevisionsConfig,
  cronjobsConfig,
  customresourcedefinitionsConfig,
  daemonsetsConfig,
  deploymentsConfig,
  eventsConfig,
  flowschemasConfig,
  jobsConfig,
  kubernetesSecretsConfig,
  leasesConfig,
  limitrangesConfig,
  mutatingwebhookconfigurationsConfig,
  namespacesConfig,
  poddisruptionbudgetsConfig,
  podsConfig,
  podtemplatesConfig,
  priorityclassesConfig,
  prioritylevelconfigurationsConfig,
  replicasetsConfig,
  replicationcontrollersConfig,
  resourcequotasConfig,
  rolebindingsConfig,
  rolesConfig,
  runtimeclassesConfig,
  serviceaccountsConfig,
  statefulsetsConfig,
  validatingadmissionpoliciesConfig,
  validatingadmissionpolicybindingsConfig,
  validatingwebhookconfigurationsConfig,
} from "./config/kubernetes-core";

export const resourceConfigs: Record<string, ResourceConfig> = {
  virtualmachinepools: virtualmachinepoolsConfig,
  virtualmachineinstances: virtualmachineinstancesConfig,
  virtualmachineinstancemigrations: virtualmachineinstancemigrationsConfig,
  virtualmachineinstancereplicasets: virtualmachineinstancereplicasetsConfig,
  kubevirts: kubevirtsConfig,
  nodes: nodesConfig,
  "network-attachment-definitions": networkAttachmentDefinitionsConfig,
  virtualmachineinstancetypes: virtualmachineinstancetypesConfig,
  virtualmachinepreferences: virtualmachinepreferencesConfig,
  virtualmachinesnapshots: virtualmachinesnapshotsConfig,
  virtualmachinerestores: virtualmachinerestoresConfig,
  virtualmachinesnapshotcontents: virtualmachinesnapshotcontentsConfig,
  datavolumes: datavolumesConfig,
  datasources: datasourcesConfig,
  storageprofiles: storageprofilesConfig,
  dataimportcrons: dataimportcronsConfig,
  volumeimportsources: volumeimportsourcesConfig,
  volumeuploadsources: volumeuploadsourcesConfig,
  volumeclonesources: volumeclonesourcesConfig,
  objecttransfers: objecttransfersConfig,
  secrets: secretsConfig,
  storageclasses: storageclassesConfig,
  persistentvolumeclaims: persistentvolumeclaimsConfig,
  persistentvolumes: persistentvolumesConfig,
  csidrivers: csidriversConfig,
  csinodes: csinodesConfig,
  csistoragecapacities: csistoragecapacitiesConfig,
  volumeattachments: volumeattachmentsConfig,
  volumeattributesclasses: volumeattributesclassesConfig,
  volumesnapshotclasses: volumesnapshotclassesConfig,
  volumesnapshots: volumesnapshotsConfig,
  volumesnapshotcontents: volumesnapshotcontentsConfig,
  networkpolicies: networkpoliciesConfig,
  ingresses: ingressesConfig,
  kubernetesServices: kubernetesServicesConfig,
  endpoints: endpointsConfig,
  endpointSlices: endpointSlicesConfig,
  ingressClasses: ingressClassesConfig,
  gatewayclasses: gatewayclassesConfig,
  gateways: gatewaysConfig,
  httproutes: httproutesConfig,
  calicoNetworkPolicies: calicoNetworkPoliciesConfig,
  calicoGlobalNetworkPolicies: calicoGlobalNetworkPoliciesConfig,
  calicoIPPools: calicoIPPoolsConfig,
  calicoTiers: calicoTiersConfig,
  calicoNetworkSets: calicoNetworkSetsConfig,
  calicoGlobalNetworkSets: calicoGlobalNetworkSetsConfig,
  calicoStagedNetworkPolicies: calicoStagedNetworkPoliciesConfig,
  calicoStagedGlobalNetworkPolicies: calicoStagedGlobalNetworkPoliciesConfig,
  calicoStagedKubernetesNetworkPolicies: calicoStagedKubernetesNetworkPoliciesConfig,
  calicoHostEndpoints: calicoHostEndpointsConfig,
  calicoBGPConfigurations: calicoBGPConfigurationsConfig,
  calicoBGPPeers: calicoBGPPeersConfig,
  calicoBGPFilters: calicoBGPFiltersConfig,
  calicoFelixConfigurations: calicoFelixConfigurationsConfig,
  calicoKubeControllersConfigurations: calicoKubeControllersConfigurationsConfig,
  calicoIPReservations: calicoIPReservationsConfig,
  calicoBlockAffinities: calicoBlockAffinitiesConfig,
  calicoCalicoNodeStatuses: calicoCalicoNodeStatusesConfig,
  calicoClusterInformations: calicoClusterInformationsConfig,
  calicoIPAMBlocks: calicoIPAMBlocksConfig,
  calicoIPAMConfigs: calicoIPAMConfigsConfig,
  calicoIPAMHandles: calicoIPAMHandlesConfig,
  ciliumNetworkPolicies: ciliumNetworkPoliciesConfig,
  ciliumClusterwideNetworkPolicies: ciliumClusterwideNetworkPoliciesConfig,
  ciliumNodes: ciliumNodesConfig,
  ciliumEndpoints: ciliumEndpointsConfig,
  ciliumEndpointSlices: ciliumEndpointSlicesConfig,
  ciliumIdentities: ciliumIdentitiesConfig,
  ciliumEnvoyConfigs: ciliumEnvoyConfigsConfig,
  ciliumClusterwideEnvoyConfigs: ciliumClusterwideEnvoyConfigsConfig,
  ciliumCIDRGroups: ciliumCIDRGroupsConfig,
  ciliumEgressGatewayPolicies: ciliumEgressGatewayPoliciesConfig,
  ciliumLoadBalancerIPPools: ciliumLoadBalancerIPPoolsConfig,
  ciliumLocalRedirectPolicies: ciliumLocalRedirectPoliciesConfig,
  ciliumL2AnnouncementPolicies: ciliumL2AnnouncementPoliciesConfig,
  ciliumPodIPPools: ciliumPodIPPoolsConfig,
  ciliumGatewayClassConfigs: ciliumGatewayClassConfigsConfig,
  ciliumNodeConfigs: ciliumNodeConfigsConfig,
  ciliumDatapathPlugins: ciliumDatapathPluginsConfig,
  ciliumBGPAdvertisements: ciliumBGPAdvertisementsConfig,
  ciliumBGPClusterConfigs: ciliumBGPClusterConfigsConfig,
  ciliumBGPNodeConfigs: ciliumBGPNodeConfigsConfig,
  ciliumBGPNodeConfigOverrides: ciliumBGPNodeConfigOverridesConfig,
  ciliumBGPPeerConfigs: ciliumBGPPeerConfigsConfig,
  kubeOvnSubnets: kubeOvnSubnetsConfig,
  kubeOvnVpcs: kubeOvnVpcsConfig,
  kubeOvnProviderNetworks: kubeOvnProviderNetworksConfig,
  kubeOvnVlans: kubeOvnVlansConfig,
  kubeOvnIPPools: kubeOvnIPPoolsConfig,
  kubeOvnIPs: kubeOvnIPsConfig,
  kubeOvnVpcNatGateways: kubeOvnVpcNatGatewaysConfig,
  kubeOvnIptablesEIPs: kubeOvnIptablesEIPsConfig,
  kubeOvnIptablesDnatRules: kubeOvnIptablesDnatRulesConfig,
  kubeOvnIptablesSnatRules: kubeOvnIptablesSnatRulesConfig,
  kubeOvnIptablesFIPRules: kubeOvnIptablesFIPRulesConfig,
  kubeOvnOvnEips: kubeOvnOvnEipsConfig,
  kubeOvnOvnDnatRules: kubeOvnOvnDnatRulesConfig,
  kubeOvnOvnSnatRules: kubeOvnOvnSnatRulesConfig,
  kubeOvnOvnFips: kubeOvnOvnFipsConfig,
  kubeOvnVips: kubeOvnVipsConfig,
  kubeOvnSwitchLBRules: kubeOvnSwitchLBRulesConfig,
  kubeOvnVpcDnses: kubeOvnVpcDnsesConfig,
  kubeOvnVpcEgressGateways: kubeOvnVpcEgressGatewaysConfig,
  kubeOvnQoSPolicies: kubeOvnQoSPoliciesConfig,
  kubeOvnSecurityGroups: kubeOvnSecurityGroupsConfig,
  kubeOvnBgpConfs: kubeOvnBgpConfsConfig,
  kubeOvnEvpnConfs: kubeOvnEvpnConfsConfig,
  kubeOvnDNSNameResolvers: kubeOvnDNSNameResolversConfig,
  horizontalpodautoscalers: horizontalpodautoscalersConfig,
  pods: podsConfig,
  deployments: deploymentsConfig,
  statefulsets: statefulsetsConfig,
  daemonsets: daemonsetsConfig,
  replicasets: replicasetsConfig,
  jobs: jobsConfig,
  cronjobs: cronjobsConfig,
  configmaps: configmapsConfig,
  componentstatuses: componentstatusesConfig,
  limitranges: limitrangesConfig,
  resourcequotas: resourcequotasConfig,
  podtemplates: podtemplatesConfig,
  replicationcontrollers: replicationcontrollersConfig,
  controllerrevisions: controllerrevisionsConfig,
  kubernetesSecrets: kubernetesSecretsConfig,
  namespaces: namespacesConfig,
  events: eventsConfig,
  leases: leasesConfig,
  serviceaccounts: serviceaccountsConfig,
  roles: rolesConfig,
  rolebindings: rolebindingsConfig,
  clusterroles: clusterrolesConfig,
  clusterrolebindings: clusterrolebindingsConfig,
  certificatesigningrequests: certificatesigningrequestsConfig,
  poddisruptionbudgets: poddisruptionbudgetsConfig,
  customresourcedefinitions: customresourcedefinitionsConfig,
  mutatingwebhookconfigurations: mutatingwebhookconfigurationsConfig,
  validatingwebhookconfigurations: validatingwebhookconfigurationsConfig,
  validatingadmissionpolicies: validatingadmissionpoliciesConfig,
  validatingadmissionpolicybindings: validatingadmissionpolicybindingsConfig,
  apiservices: apiservicesConfig,
  flowschemas: flowschemasConfig,
  prioritylevelconfigurations: prioritylevelconfigurationsConfig,
  runtimeclasses: runtimeclassesConfig,
  priorityclasses: priorityclassesConfig,
};
