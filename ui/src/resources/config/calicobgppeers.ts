import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoBGPPeersConfig: ResourceConfig = shared.calicoResourceConfig({ plural: "bgppeers", path: "/networks/calico/bgp-peers", title: "Calico BGP Peers", subtitle: "Manage Calico BGPPeer resources", kind: "BGPPeer", createFields: [{ name: "peerIP", label: "Peer IP", section: "BGP", defaultValue: "192.0.2.1" }, { name: "asNumber", label: "Peer AS number", section: "BGP", type: "number", defaultValue: "64512" }], buildSpec: (values) => ({ peerIP: shared.stringValue(values.peerIP, "192.0.2.1"), asNumber: shared.numberValue(values.asNumber, 64512) }), statusPath: ["spec", "peerIP"] });
