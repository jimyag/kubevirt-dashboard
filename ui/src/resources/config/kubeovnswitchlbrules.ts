import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const kubeOvnSwitchLBRulesConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "switch-lb-rules",
    path: "/networks/kube-ovn/switch-lb-rules",
    title: "Kube-OVN Switch LB Rules",
    subtitle: "Manage Kube-OVN SwitchLBRule resources",
    kind: "SwitchLBRule",
    createFields: [
      { name: "vip", label: "VIP", section: "Load Balancer", defaultValue: "10.16.0.100" },
      { name: "serviceNamespace", label: "Service namespace", section: "Load Balancer", defaultValue: "default" },
      { name: "ports", label: "Ports (JSON)", section: "Load Balancer", type: "textarea", defaultValue: '[{"name":"http","port":80,"targetPort":80,"protocol":"TCP"}]' },
      { name: "endpoints", label: "Endpoint IPs", section: "Load Balancer", defaultValue: "10.0.0.1", placeholder: "comma-separated" },
      { name: "sessionAffinity", label: "Session affinity", section: "Load Balancer", type: "select", defaultValue: "None", options: [{ label: "None", value: "None" }, { label: "ClientIP", value: "ClientIP" }] },
    ],
    buildSpec: (values) => ({ vip: shared.stringValue(values.vip), namespace: shared.stringValue(values.serviceNamespace, "default"), ports: JSON.parse(shared.stringValue(values.ports)), endpoints: shared.csvList(values.endpoints), ...(shared.stringValue(values.sessionAffinity) ? { sessionAffinity: shared.stringValue(values.sessionAffinity) } : {}) }),
    statusPath: ["status", "service"],
    extraColumns: [{ label: "VIP", value: (r) => String(shared.getRecord(r.spec).vip || "N/A") }],
  });
