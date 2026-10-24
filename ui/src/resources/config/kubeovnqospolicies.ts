import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";
import { t } from "@/lib/i18n";

export const kubeOvnQoSPoliciesConfig: ResourceConfig = shared.kubeOvnResourceConfig({
    plural: "qos-policies",
    path: "/networks/kube-ovn/qos-policies",
    title: "Kube-OVN QoS Policies",
    subtitle: "Manage Kube-OVN QoSPolicy resources",
    kind: "QoSPolicy",
    createFields: [
      { name: "bindingType", label: "Binding type", section: "QoS", type: "select", defaultValue: "EIP", options: [{ label: "EIP", value: "EIP" }, { label: "NATGW", value: "NATGW" }] },
      { name: "shared", label: "Shared", section: "QoS", type: "checkbox", defaultValue: false },
      { name: "bandwidthLimitRules", label: "Bandwidth limit rules (JSON)", section: "QoS", type: "textarea", defaultValue: "[]", placeholder: '[{"name":"egress","rateMax":"1","burstMax":"1","priority":1,"direction":"egress"}]' },
    ],
    buildSpec: (values) => {
      const bindingType = shared.stringValue(values.bindingType, "EIP");
      const isShared = values.shared === true;
      if (bindingType === "NATGW" && !isShared) throw new Error(t("NAT gateway QoS policies must be shared."));
      return { bindingType, shared: isShared, bandwidthLimitRules: JSON.parse(shared.stringValue(values.bandwidthLimitRules, "[]")) };
    },
    extraColumns: [
      { label: "Binding type", value: (r) => String(shared.getRecord(r.spec).bindingType || "N/A") },
      { label: "Shared", value: (r) => String(shared.getRecord(r.spec).shared ?? false) },
    ],
  });
