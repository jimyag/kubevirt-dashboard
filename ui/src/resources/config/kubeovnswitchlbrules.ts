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
      { name: "ports", label: "Ports", section: "Load Balancer", defaultValue: "80" },
      { name: "sessionAffinity", label: "Session affinity", section: "Load Balancer", defaultValue: "", placeholder: "optional" },
    ],
    buildSpec: (values) => ({ vip: shared.stringValue(values.vip), ports: shared.csvList(values.ports), ...(shared.stringValue(values.sessionAffinity) ? { sessionAffinity: shared.stringValue(values.sessionAffinity) } : {}) }),
    statusPath: ["status", "service"],
    extraColumns: [{ label: "VIP", value: (r) => String(shared.getRecord(r.spec).vip || "N/A") }],
  });
