import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoIPAMConfigsConfig: ResourceConfig = {
  ...shared.calicoResourceConfig({ plural: "ipamconfigs", path: "/networks/calico/ipam-configs", title: "Calico IPAM Configs", subtitle: "Inspect Calico IPAMConfig resources", kind: "IPAMConfig", allowCreate: false, allowDelete: false }),
  listPathAlternates: ["/apis/projectcalico.org/v3/ipamconfigurations"],
};
