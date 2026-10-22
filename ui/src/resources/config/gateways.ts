import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const gatewaysConfig: ResourceConfig = {
    id: "gateways",
    path: "/networks/gateway-api/gateways",
    title: "Gateways",
    subtitle: "Manage Gateway API Gateway listeners",
    listPath: "/apis/gateway.networking.k8s.io/v1/gateways",
    namespaced: true,
    resourcePath: "/apis/gateway.networking.k8s.io/v1",
    kind: "Gateway",
    createFields: [
      ...shared.namespaceNameFields("example-gateway"),
      { name: "gatewayClassName", label: "Gateway class", section: "Gateway", defaultValue: "example-gateway-class" },
      { name: "listenerName", label: "Listener name", section: "Listener", defaultValue: "http" },
      { name: "hostname", label: "Hostname", section: "Listener", defaultValue: "", placeholder: "optional" },
      { name: "port", label: "Port", section: "Listener", type: "number", defaultValue: "80" },
      { name: "protocol", label: "Protocol", section: "Listener", type: "select", defaultValue: "HTTP", options: [{ label: "HTTP", value: "HTTP" }, { label: "HTTPS", value: "HTTPS" }, { label: "TCP", value: "TCP" }, { label: "TLS", value: "TLS" }] },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "Gateway",
      metadata: { name: shared.stringValue(values.name, "example-gateway"), namespace: shared.stringValue(values.namespace, "default") },
      spec: {
        gatewayClassName: shared.stringValue(values.gatewayClassName, "example-gateway-class"),
        listeners: [{
          name: shared.stringValue(values.listenerName, "http"),
          ...(shared.stringValue(values.hostname) ? { hostname: shared.stringValue(values.hostname) } : {}),
          port: shared.numberValue(values.port, 80),
          protocol: shared.stringValue(values.protocol, "HTTP"),
        }],
      },
    }),
    statusPath: ["status", "conditions", "0", "type"],
    detailSections: shared.gatewayDetailSections,
    extraColumns: [{ label: "Class", value: (r) => String(shared.getRecord(r.spec).gatewayClassName || "N/A") }, { label: "Listeners", value: (r) => String((shared.getRecord(r.spec).listeners as unknown[] | undefined)?.length || 0) }],
    createTemplate: `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: example-gateway
  namespace: default
spec:
  gatewayClassName: example-gateway-class
  listeners: []
`,
  };
