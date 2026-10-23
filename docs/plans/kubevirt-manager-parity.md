# KubeVirt Manager Parity Plan

> **Status (2026-10):** steps 1–4 and 6 are implemented; step 5 (CAPI/CAPK cluster flow) is not. The routes below predate the console redesign and no longer exist. Current equivalents: VMs `/kubevirt/virtualization/virtual-machines`, instance types `/kubevirt/templates/cluster-instance-types`, pools `/kubevirt/virtualization/vm-pools`, disks `/kubevirt/cdi/data-volumes`, load balancers `/networks/kubernetes/services`, firewalls `/vpc/security-groups` and `/networks/kubernetes/network-policies`, autoscaling `/kubevirt/operations/autoscaling`, images `/kubevirt/cdi/data-sources`, settings `/settings`. Page code now lives in `ui/src/pages/` and `ui/src/resources/config/`, not only `ui/src/App.tsx`. "YAML is allowed only as preview and advanced override" still holds.

## Goal

Bring this dashboard to functional parity with `kubevirt-manager`, then extend it with structured field management for Kubernetes/KubeVirt resources instead of YAML-only workflows.

## Scope

- Keep API traffic on the existing Go-embedded Kubernetes proxy paths: `/api` and `/apis`.
- Do not add `/api/v1/managed-resources`.
- Every resource gets a first-class route and a typed list/detail/create/edit surface.
- YAML is allowed only as preview and advanced override.
- UI must follow `AGENTS.md` theme rules.

## Current Gaps

1. VM operations: start, stop, restart, pause, unpause, power off, migrate, resize CPU/memory, run strategy, instance type, priority class, disk editing, hotplug/unplug, snapshots.
2. VM pool operations: start, stop, scale replicas, resize CPU/memory, run strategy, instance type, priority class, detach/remove VMs.
3. DataVolume/PVC operations: create from blank/http/registry/upload-style source, resize PVC, inspect PVC/PV binding, delete related PVC/PV safely.
4. Load balancers/services: create with multiple ports/selectors/annotations, change type, classify ingress/ports/selectors.
5. Cluster instance types: edit CPU/memory and display compute shape fields.
6. Snapshots/restores: create/delete with structured source/target selection and status rendering.
7. SSH keys/secrets: create structured keys, preview data keys without leaking secret values by default.
8. Firewalls/network policies: structured ingress/egress/port/CIDR fields, not just selector and type.
9. Autoscaling: structured target refs, min/max, metrics, and autoscaler annotations where relevant.
10. CAPI/CAPK clusters: full create flow across Cluster, KubevirtCluster, KubeadmControlPlane, KubevirtMachineTemplate, KubeadmConfigTemplate, MachineDeployment, MachineHealthCheck, ClusterResourceSet, RBAC/config maps/secrets where needed; detail pages must show control plane, worker pools, VMs, services, kubeconfig/SSH actions.
11. kubevirt-manager extra pages: images and settings need first-class pages.
12. Dashboard-only additions beyond kubevirt-manager: generic patch/edit actions, raw event views, health/status summaries, and resource relationship views.

## Implementation Steps

### 1. Generic Resource Actions
- Modify: `ui/src/components/resource-management.tsx`
- Add typed action dialogs for PUT/PATCH/POST/DELETE operations with input fields and optional JSON/YAML preview.
- Verify: `bun run build`, open `/instance-types`, edit CPU/memory dialog.

### 2. VM Management Completion
- Modify: `ui/src/App.tsx`
- Add buttons/dialogs for KubeVirt subresources and VM spec patching.
- Add disk/network/storage detail cards and typed patch forms.
- Verify: build and browser check `/vms/:namespace/:name/overview`.

### 3. VM Pool Management Completion
- Modify: `ui/src/App.tsx`
- Add start/stop, scale replicas, resize template, run strategy, instance type, priority class actions.
- Verify: build and browser check `/vmpools/:namespace/:name`.

### 4. Storage, Networking, Firewall, Autoscaling Actions
- Modify: `ui/src/App.tsx`
- Add DataVolume/PVC resize, Service type edit, NetworkPolicy rule fields, HPA metric fields.
- Verify: build and browser checks for `/dvs`, `/load-balancers`, `/firewalls`, `/autoscaling`.

### 5. CAPK Cluster Full Flow
- Modify: `ui/src/App.tsx`; add small helpers if needed.
- Build multi-object create for CAPK cluster stacks and detail relationship fetching.
- Verify: generated resources preview includes all dependent objects; POST order is explicit and error-handled.

### 6. Images and Settings Pages
- Modify: `ui/src/App.tsx`, `ui/src/components/app-sidebar.tsx`
- Add first-class images/settings routes and structured forms.
- Verify: build and browser route checks.

### 7. Final Verification
- Run `bun run build`.
- Run theme scans for prohibited classes.
- Run Go tests if local Go toolchain is consistent.
- Browser-check major routes and create/action dialogs.
