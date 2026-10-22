import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoIPPoolsConfig: ResourceConfig = {
    id: "ippools",
    path: "/networks/calico/ip-pools",
    title: "Calico IP Pools",
    subtitle: "Manage Calico IPPool resources",
    listPath: "/apis/crd.projectcalico.org/v1/ippools",
    namespaced: false,
    resourcePath: "/apis/crd.projectcalico.org/v1",
    kind: "IPPool",
    createFields: [
      ...shared.nameOnlyFields("example-pool"),
      { name: "cidr", label: "CIDR", section: "Pool", defaultValue: "10.244.0.0/16" },
      { name: "encapsulation", label: "Encapsulation", section: "Pool", type: "select", defaultValue: "VXLAN", options: [{ label: "VXLAN", value: "VXLAN" }, { label: "IPIP", value: "IPIP" }, { label: "None", value: "None" }] },
      { name: "natOutgoing", label: "NAT outgoing", section: "Pool", type: "checkbox", defaultValue: true },
      { name: "disabled", label: "Disabled", section: "Pool", type: "checkbox", defaultValue: false },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "crd.projectcalico.org/v1",
      kind: "IPPool",
      metadata: { name: shared.stringValue(values.name, "example-pool") },
      spec: { cidr: shared.stringValue(values.cidr, "10.244.0.0/16"), encapsulation: shared.stringValue(values.encapsulation, "VXLAN"), natOutgoing: values.natOutgoing === true, disabled: values.disabled === true },
    }),
    statusPath: ["spec", "cidr"],
    detailSections: shared.calicoDetailSections,
    extraColumns: [{ label: "CIDR", value: (r) => String(shared.getRecord(r.spec).cidr || "N/A") }],
    createTemplate: `apiVersion: crd.projectcalico.org/v1
kind: IPPool
metadata:
  name: example-pool
spec:
  cidr: 10.244.0.0/16
`,
  };
