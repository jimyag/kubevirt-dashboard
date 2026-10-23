import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const endpointSlicesConfig: ResourceConfig = {
    id: "endpointslices",
    path: "/networks/kubernetes/endpoint-slices",
    title: "Endpoint Slices",
    subtitle: "Inspect Kubernetes discovery EndpointSlice resources",
    listPath: "/apis/discovery.k8s.io/v1/endpointslices",
    namespaced: true,
    resourcePath: "/apis/discovery.k8s.io/v1",
    kind: "EndpointSlice",
    allowCreate: false,
    allowDelete: false,
    statusPath: ["addressType"],
    detailSections: shared.kubernetesEndpointSliceDetailSections,
    extraColumns: [{ label: "Address type", value: (r) => String(shared.getRecord(r).addressType || "N/A") }, { label: "Endpoints", value: (r) => String((shared.getRecord(r).endpoints as unknown[] | undefined)?.length || 0) }],
    createTemplate: `apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: example-endpoint-slice
  namespace: default
addressType: IPv4
`,
  };
