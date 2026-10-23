import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const gatewayclassesConfig: ResourceConfig = {
    id: "gatewayclasses",
    path: "/networks/gateway-api/gateway-classes",
    title: "Gateway Classes",
    subtitle: "Manage Gateway API cluster-scoped GatewayClass resources",
    listPath: "/apis/gateway.networking.k8s.io/v1/gatewayclasses",
    namespaced: false,
    resourcePath: "/apis/gateway.networking.k8s.io/v1",
    kind: "GatewayClass",
    createFields: [
      ...shared.nameOnlyFields("example-gateway-class"),
      { name: "controllerName", label: "Controller name", section: "Gateway", defaultValue: "example.com/gateway-controller" },
      { name: "description", label: "Description", section: "Gateway", defaultValue: "" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "GatewayClass",
      metadata: { name: shared.stringValue(values.name, "example-gateway-class") },
      spec: {
        controllerName: shared.stringValue(values.controllerName, "example.com/gateway-controller"),
        ...(shared.stringValue(values.description) ? { description: shared.stringValue(values.description) } : {}),
      },
    }),
    statusPath: ["status", "conditions", "0", "type"],
    detailSections: shared.gatewayClassDetailSections,
    extraColumns: [{ label: "Controller", value: (r) => String(shared.getRecord(r.spec).controllerName || "N/A") }],
    createTemplate: `apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: example-gateway-class
spec:
  controllerName: example.com/gateway-controller
`,
  };
