import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const ingressesConfig: ResourceConfig = {
    id: "ingresses",
    path: "/networks/kubernetes/ingresses",
    title: "Ingresses",
    subtitle: "Manage Kubernetes Ingress HTTP routing resources",
    listPath: "/apis/networking.k8s.io/v1/ingresses",
    namespaced: true,
    resourcePath: "/apis/networking.k8s.io/v1",
    kind: "Ingress",
    createFields: [
      ...shared.namespaceNameFields("example-ingress"),
      { name: "className", label: "Ingress class", section: "Routing", defaultValue: "nginx", placeholder: "optional" },
      { name: "host", label: "Host", section: "Routing", defaultValue: "example.local" },
      { name: "path", label: "Path", section: "Routing", defaultValue: "/" },
      { name: "serviceName", label: "Service name", section: "Backend", defaultValue: "example-service" },
      { name: "servicePort", label: "Service port", section: "Backend", type: "number", defaultValue: "80" },
      { name: "tlsSecretName", label: "TLS secret", section: "TLS", defaultValue: "", placeholder: "optional" },
    ],
    buildCreateResource: (values) => {
      const host = shared.stringValue(values.host, "example.local");
      const tlsSecretName = shared.stringValue(values.tlsSecretName);
      return {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: shared.stringValue(values.name, "example-ingress"), namespace: shared.stringValue(values.namespace, "default") },
        spec: {
          ...(shared.stringValue(values.className) ? { ingressClassName: shared.stringValue(values.className) } : {}),
          rules: [{
            host,
            http: {
              paths: [{
                path: shared.stringValue(values.path, "/"),
                pathType: "Prefix",
                backend: { service: { name: shared.stringValue(values.serviceName, "example-service"), port: { number: shared.numberValue(values.servicePort, 80) } } },
              }],
            },
          }],
          ...(tlsSecretName ? { tls: [{ hosts: [host], secretName: tlsSecretName }] } : {}),
        },
      };
    },
    statusPath: ["spec", "ingressClassName"],
    detailSections: shared.kubernetesIngressDetailSections,
    extraColumns: [
      { label: "Class", value: (r) => String(shared.getRecord(r.spec).ingressClassName || "N/A") },
      { label: "Hosts", value: (r) => (Array.isArray(shared.getRecord(r.spec).rules) ? (shared.getRecord(r.spec).rules as Record<string, unknown>[]).map((rule) => rule.host).filter(Boolean).join(", ") : "") || "N/A" },
    ],
    createTemplate: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: example-ingress
  namespace: default
spec:
  rules: []
`,
  };
