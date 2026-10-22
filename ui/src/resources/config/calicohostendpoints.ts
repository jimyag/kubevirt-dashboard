import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoHostEndpointsConfig: ResourceConfig = shared.calicoResourceConfig({
    plural: "hostendpoints",
    path: "/networks/calico/host-endpoints",
    title: "Calico Host Endpoints",
    subtitle: "Manage Calico HostEndpoint resources",
    kind: "HostEndpoint",
    createFields: [{ name: "node", label: "Node", section: "Endpoint", defaultValue: "" }, { name: "interfaceName", label: "Interface name", section: "Endpoint", defaultValue: "*" }, { name: "expectedIPs", label: "Expected IPs", section: "Endpoint", defaultValue: "", placeholder: "comma-separated IPs" }],
    buildSpec: (values) => ({ ...(shared.stringValue(values.node) ? { node: shared.stringValue(values.node) } : {}), interfaceName: shared.stringValue(values.interfaceName, "*"), ...(shared.csvList(values.expectedIPs).length ? { expectedIPs: shared.csvList(values.expectedIPs) } : {}) }),
    statusPath: ["spec", "node"],
  });
