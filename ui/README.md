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
| `src/App.tsx` | Routes, instance detail and disk pages |
| `src/pages/` | Console pages: overview, instances and create wizard, VPCs and subnets, elastic IPs and NAT, security groups, events, settings |
| `src/components/console.tsx` | Shared console components (page header, tables, panels, status, dialogs) |
| `src/components/resource-management.tsx` | Generic list, detail, manifest, create and edit views used by the Resource Catalog |
| `src/components/ui/` | shadcn/ui components; do not edit them directly |
| `src/resources/config/` | One `ResourceConfig` per API resource: paths, columns, create form and actions |
| `src/lib/kube.ts` | API fetch helpers, discovery and network stack detection |
| `src/lib/navigation.ts` | Navigation sections shared by the sidebar, breadcrumbs and command palette |
| `src/lib/security-groups.ts` | Security group model and its Kube-OVN / Cilium mappings |
| `src/lib/metrics.ts` | metrics-server and Prometheus queries |
| `src/lib/filter.ts` | `field:value` list filtering, namespace scoping and paging |
| `src/lib/nat.ts` | Kube-OVN NAT kinds (VPC NAT gateway and OVN native): columns, forms and specs |

All requests go to the Kubernetes API through the Go backend proxy (`/api`, `/apis`) with the selected context in the `X-Kube-Context` header.

Theme, components and copy rules are in [../AGENTS.md](../AGENTS.md).
