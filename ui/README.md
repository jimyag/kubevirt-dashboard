# KubeVirt Dashboard UI

React + TypeScript + Vite frontend, embedded into the Go binary from `ui/dist`.

## Commands

```bash
bun install        # install dependencies (bun.lock is the only lock file)
bun run dev        # Vite dev server; proxies /api and /apis to 127.0.0.1:11111
bun run build      # type-check and build into dist/
bun run lint       # ESLint
```

Run the Go binary (`./kubevirt-dashboard --listen 127.0.0.1:11111`) for the dev server to proxy to.

## Layout

| Path | Contents |
|------|----------|
| `src/App.tsx` | Routes |
| `src/pages/` | Console pages: overview, instances and create wizard, VPCs and subnets, elastic IPs and NAT, security groups, events, settings |
| `src/pages/instance-detail.tsx`, `src/pages/disks.tsx` | Instance detail tabs; disk list and detail |
| `src/pages/reserved-ips.tsx`, `src/pages/address-groups.tsx` | Reserved IPs (Kube-OVN `Vip`); Cilium address groups (`CiliumCIDRGroup`) |
| `src/components/console.tsx` | Shared console components (page header, tables, panels, status, dialogs) |
| `src/components/resource-management.tsx` | Generic list, detail, manifest, create and edit views used by the Resource Catalog |
| `src/components/resource-overviews.tsx`, `src/components/detail-parts.tsx` | Pod, workload and node detail layouts; shared detail tables and sections |
| `src/components/instance-eip.tsx` | Elastic IP bindings on the instance network tab |
| `src/components/instance-network.tsx`, `src/lib/vm-network.ts` | Instance NICs (Multus attachments) and bandwidth limits |
| `src/components/vpc-routing.tsx`, `src/components/ip-pools.tsx`, `src/lib/vpc.ts` | Route table and peering editors, IP pool tables and dialogs, and their Kube-OVN helpers |
| `src/pages/vpc-network.tsx` | Route table, peering connection and IP pool list pages |
| `src/components/yaml-editor.tsx`, `src/components/manifest.tsx` | YAML viewer and editor (search, folding, diff) and the manifest tab |
| `src/components/ui/` | shadcn/ui components; do not edit them directly |
| `src/resources/config/` | One `ResourceConfig` per API resource: paths, columns, create form and actions |
| `src/lib/kube.ts` | API fetch helpers, discovery and network stack detection |
| `src/lib/navigation.ts` | Navigation sections and their second-level groups, shared by the sidebar, breadcrumbs and command palette |
| `src/lib/security-groups.ts` | Security group model and its Kube-OVN / Cilium mappings |
| `src/lib/metrics.ts` | metrics-server and Prometheus queries |
| `src/lib/i18n.ts`, `src/lib/locales/` | `t()` translations (English keys, Simplified Chinese dictionary) |
| `src/lib/filter.ts` | `field:value` list filtering, namespace scoping and paging |
| `src/lib/polling.ts` | `usePolling`: interval refresh that pauses while the tab is hidden |
| `src/lib/detail-values.ts`, `src/lib/vm-pages.ts` | Value helpers for detail views; VM types and helpers |
| `src/lib/nat.ts` | Kube-OVN NAT kinds (VPC NAT gateway and OVN native): columns, forms and specs |

All requests go to the Kubernetes API through the Go backend proxy (`/api`, `/apis`) with the selected context in the `X-Kube-Context` header.

Theme, components and copy rules are in [../AGENTS.md](../AGENTS.md).
