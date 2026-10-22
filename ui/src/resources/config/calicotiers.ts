import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const calicoTiersConfig: ResourceConfig = shared.calicoResourceConfig({
    plural: "tiers",
    path: "/networks/calico/tiers",
    title: "Calico Tiers",
    subtitle: "Manage Calico policy ordering tiers",
    kind: "Tier",
    createFields: [{ name: "order", label: "Order", section: "Tier", type: "number", defaultValue: "100" }, { name: "defaultAction", label: "Default action", section: "Tier", type: "select", defaultValue: "Deny", options: [{ label: "Deny", value: "Deny" }, { label: "Pass", value: "Pass" }] }],
    buildSpec: (values) => ({ order: shared.numberValue(values.order, 100), defaultAction: shared.stringValue(values.defaultAction, "Deny") }),
    statusPath: ["spec", "order"],
    extraColumns: [{ label: "Order", value: (r) => String(shared.getRecord(r.spec).order || "N/A") }],
  });
