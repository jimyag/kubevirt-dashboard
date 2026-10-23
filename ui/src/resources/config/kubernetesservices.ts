import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubernetesServicesConfig: ResourceConfig = {
    id: "services",
    path: "/networks/kubernetes/services",
    title: "Services",
    subtitle: "Manage Kubernetes Service network endpoints",
    listPath: "/api/v1/services",
    namespaced: true,
    resourcePath: "/api/v1",
    kind: "Service",
    createFields: [
      ...shared.namespaceNameFields("example-service"),
      { name: "type", label: "Type", section: "Service", type: "select", defaultValue: "ClusterIP", options: [{ label: "ClusterIP", value: "ClusterIP" }, { label: "NodePort", value: "NodePort" }, { label: "LoadBalancer", value: "LoadBalancer" }] },
      { name: "selectorKey", label: "Selector key", section: "Selector", defaultValue: "app" },
      { name: "selectorValue", label: "Selector value", section: "Selector", defaultValue: "example" },
      { name: "port", label: "Port", section: "Ports", type: "number", defaultValue: "80" },
      { name: "targetPort", label: "Target port", section: "Ports", type: "number", defaultValue: "80" },
      { name: "protocol", label: "Protocol", section: "Ports", type: "select", defaultValue: "TCP", options: [{ label: "TCP", value: "TCP" }, { label: "UDP", value: "UDP" }, { label: "SCTP", value: "SCTP" }] },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: shared.stringValue(values.name, "example-service"), namespace: shared.stringValue(values.namespace, "default") },
      spec: {
        type: shared.stringValue(values.type, "ClusterIP"),
        selector: { [shared.stringValue(values.selectorKey, "app")]: shared.stringValue(values.selectorValue, "example") },
        ports: [{ port: shared.numberValue(values.port, 80), targetPort: shared.numberValue(values.targetPort, 80), protocol: shared.stringValue(values.protocol, "TCP") }],
      },
    }),
    statusPath: ["spec", "type"],
    detailSections: shared.kubernetesServiceDetailSections,
    extraColumns: [{ label: "Type", value: (r) => String(shared.getRecord(r.spec).type || "N/A") }, { label: "Cluster IP", value: (r) => String(shared.getRecord(r.spec).clusterIP || "N/A") }],
    createTemplate: `apiVersion: v1
kind: Service
metadata:
  name: example-service
  namespace: default
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 80
`,
  };
