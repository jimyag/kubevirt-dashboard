import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const httproutesConfig: ResourceConfig = {
    id: "httproutes",
    path: "/networks/gateway-api/http-routes",
    title: "HTTP Routes",
    subtitle: "Manage Gateway API HTTPRoute resources",
    listPath: "/apis/gateway.networking.k8s.io/v1/httproutes",
    namespaced: true,
    resourcePath: "/apis/gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    createFields: [
      ...shared.namespaceNameFields("example-http-route"),
      { name: "parentGateway", label: "Parent gateway", section: "Parent", defaultValue: "example-gateway" },
      { name: "sectionName", label: "Listener section", section: "Parent", defaultValue: "http", placeholder: "optional" },
      { name: "host", label: "Hostname", section: "Match", defaultValue: "example.local" },
      { name: "path", label: "Path prefix", section: "Match", defaultValue: "/" },
      { name: "serviceName", label: "Backend service", section: "Backend", defaultValue: "example-service" },
      { name: "servicePort", label: "Backend port", section: "Backend", type: "number", defaultValue: "80" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "HTTPRoute",
      metadata: { name: shared.stringValue(values.name, "example-http-route"), namespace: shared.stringValue(values.namespace, "default") },
      spec: {
        parentRefs: [{ name: shared.stringValue(values.parentGateway, "example-gateway"), ...(shared.stringValue(values.sectionName) ? { sectionName: shared.stringValue(values.sectionName) } : {}) }],
        hostnames: [shared.stringValue(values.host, "example.local")],
        rules: [{
          matches: [{ path: { type: "PathPrefix", value: shared.stringValue(values.path, "/") } }],
          backendRefs: [{ name: shared.stringValue(values.serviceName, "example-service"), port: shared.numberValue(values.servicePort, 80) }],
        }],
      },
    }),
    statusPath: ["status", "parents", "0", "conditions", "0", "type"],
    detailSections: shared.httpRouteDetailSections,
    extraColumns: [{ label: "Hostnames", value: (r) => (shared.getRecord(r.spec).hostnames as string[] | undefined)?.join(", ") || "N/A" }],
    createTemplate: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: example-http-route
  namespace: default
spec:
  parentRefs: []
  rules: []
`,
  };
