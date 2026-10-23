import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const ingressClassesConfig: ResourceConfig = {
    id: "ingressclasses",
    path: "/networks/kubernetes/ingress-classes",
    title: "Ingress Classes",
    subtitle: "Manage Kubernetes IngressClass controller bindings",
    listPath: "/apis/networking.k8s.io/v1/ingressclasses",
    namespaced: false,
    resourcePath: "/apis/networking.k8s.io/v1",
    kind: "IngressClass",
    createFields: [...shared.nameOnlyFields("example-ingress-class"), { name: "controller", label: "Controller", section: "Controller", defaultValue: "k8s.io/ingress-nginx" }, { name: "isDefault", label: "Default class", section: "Controller", type: "checkbox", defaultValue: false }],
    buildCreateResource: (values) => ({
      apiVersion: "networking.k8s.io/v1",
      kind: "IngressClass",
      metadata: {
        name: shared.stringValue(values.name, "example-ingress-class"),
        ...(values.isDefault === true ? { annotations: { "ingressclass.kubernetes.io/is-default-class": "true" } } : {}),
      },
      spec: { controller: shared.stringValue(values.controller, "k8s.io/ingress-nginx") },
    }),
    statusPath: ["spec", "controller"],
    detailSections: shared.kubernetesIngressClassDetailSections,
    extraColumns: [{ label: "Controller", value: (r) => String(shared.getRecord(r.spec).controller || "N/A") }],
    createTemplate: `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: example-ingress-class
spec:
  controller: k8s.io/ingress-nginx
`,
  };
