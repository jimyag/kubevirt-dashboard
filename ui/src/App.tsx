import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AppSidebar } from "./components/app-sidebar";
import { ResourceDetail, ResourceEvents, ResourceList, ResourceManifest, type ResourceConfig } from "./components/resource-management";
import { SiteHeader } from "./components/site-header";
import { SidebarInset, SidebarProvider } from "./components/ui/sidebar";
import { Toaster } from "./components/ui/sonner";
import { resourceConfigs } from "./resources/configs";
import { CreateInstancePage, InstanceListPage } from "./pages/instances";
import { OverviewPage } from "./pages/overview";
import { EventsPage } from "./pages/events";
import { SecurityGroupDetailPage, SecurityGroupListPage } from "./pages/security-groups";
import { CatalogPage, SettingsPage } from "./pages/settings";
import { SubnetDetailPage, SubnetListPage, VpcDetailPage, VpcListPage } from "./pages/vpc";
import { ElasticIpPage, NatGatewayPage } from "./pages/nat";
import { KubernetesCategoryPage, KubernetesManagementPage, KubeVirtCategoryPage, KubeVirtManagementPage, NetworkCategoryPage, NetworkManagementPage, StorageCategoryPage, StorageManagementPage } from "./resources/group-pages";
import { t, useLocale } from "@/lib/i18n";
import { VMDetailContent } from "./pages/instance-detail";
import { DVDetailContent, DVList } from "./pages/disks";

function resourceRoutes(config: ResourceConfig) {
  return [
    <Route key={`${config.path}-list`} path={config.path} element={<ResourceList config={config} />} />,
    <Route key={`${config.path}-detail`} path={`${config.path}/:namespace/:name`} element={<ResourceDetail config={config} />} />,
    <Route key={`${config.path}-manifest`} path={`${config.path}/:namespace/:name/manifest`} element={<ResourceManifest config={config} />} />,
    <Route key={`${config.path}-events`} path={`${config.path}/:namespace/:name/events`} element={<ResourceEvents config={config} />} />,
  ];
}

function App() {
  // Changing the language remounts the console so every t() call renders again.
  const locale = useLocale();
  return (
    <BrowserRouter>
      <SidebarProvider key={locale}>
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-y-auto">
          <SiteHeader />
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 lg:px-8 lg:py-8">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/vpc/vpcs" element={<VpcListPage />} />
              <Route path="/vpc/vpcs/:name" element={<VpcDetailPage />} />
              <Route path="/vpc/subnets" element={<SubnetListPage />} />
              <Route path="/vpc/subnets/:name" element={<SubnetDetailPage />} />
              <Route path="/vpc/elastic-ips" element={<ElasticIpPage />} />
              <Route path="/vpc/nat-gateways" element={<NatGatewayPage />} />
              <Route path="/vpc/security-groups" element={<SecurityGroupListPage />} />
              <Route path="/vpc/security-groups/:provider/:name" element={<SecurityGroupDetailPage />} />
              <Route path="/vpc/security-groups/:provider/:namespace/:name" element={<SecurityGroupDetailPage />} />
              <Route path="/kubernetes" element={<KubernetesManagementPage />} />
              <Route path="/kubernetes/:category" element={<KubernetesCategoryPage />} />
              <Route path="/kubevirt" element={<KubeVirtManagementPage />} />
              <Route path="/kubevirt/:category" element={<KubeVirtCategoryPage />} />
              <Route path="/kubevirt/virtualization/virtual-machines" element={<InstanceListPage />} />
              <Route path="/kubevirt/virtualization/virtual-machines/create" element={<CreateInstancePage />} />
              <Route path="/kubevirt/virtualization/virtual-machines/:namespace/:name" element={<Navigate to="overview" replace />} />
              <Route path="/kubevirt/virtualization/virtual-machines/:namespace/:name/:tab" element={<VMDetailContent />} />
              <Route path="/kubevirt/cdi/data-volumes" element={<DVList />} />
              <Route path="/kubevirt/cdi/data-volumes/:namespace/:name" element={<Navigate to="overview" replace />} />
              <Route path="/kubevirt/cdi/data-volumes/:namespace/:name/:tab" element={<DVDetailContent />} />
              <Route path="/storage" element={<StorageManagementPage />} />
              <Route path="/storage/:category" element={<StorageCategoryPage />} />
              <Route path="/networks" element={<NetworkManagementPage />} />
              <Route path="/networks/:category" element={<NetworkCategoryPage />} />
              {Object.values(resourceConfigs).flatMap(resourceRoutes)}
              <Route path="*" element={<div className="p-20 text-center text-muted-foreground border-2 border-dashed rounded-lg mt-12">{t("Page not found")}</div>} />
            </Routes>
          </div>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </BrowserRouter>
  );
}

export default App;
