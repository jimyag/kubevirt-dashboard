import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoBGPConfigurationsConfig: ResourceConfig = shared.calicoResourceConfig({ plural: "bgpconfigurations", path: "/networks/calico/bgp-configurations", title: "Calico BGP Configurations", subtitle: "Manage Calico BGPConfiguration resources", kind: "BGPConfiguration", createFields: [{ name: "asNumber", label: "AS number", section: "BGP", type: "number", defaultValue: "64512" }], buildSpec: (values) => ({ asNumber: shared.numberValue(values.asNumber, 64512) }), statusPath: ["spec", "asNumber"] });
