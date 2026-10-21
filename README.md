# KubeVirt Dashboard

A lightweight, single-binary, and modern web-based management console for KubeVirt clusters.

![Dashboard Overview](images/dashboard.png)

## Features

- **Multi-Cluster Support**: Manage multiple Kubernetes clusters by switching contexts directly from the UI.
- **Discovery-Aware Resource Management**: The backend exposes Kubernetes API versions and resources, and the UI only calls APIs served by the selected cluster.
- **Kubernetes Management**: Manage workloads, config, RBAC, policy, admission, flow control, certificates, leases, runtime classes, priority classes, API services, and CRDs.
- **KubeVirt Management**: Manage VirtualMachines, VMIs, pools, replica sets, migrations, snapshots, restores, instance types, preferences, and KubeVirt installation resources.
- **CDI And Storage Management**: Manage DataVolumes, DataSources, StorageProfiles, import/upload/clone sources, ObjectTransfers, PV/PVC, StorageClasses, CSI resources, and VolumeSnapshot resources.
- **Network Management**: Manage Kubernetes networking, Gateway API resources, NetworkAttachmentDefinitions, Calico, Cilium, and Kube-OVN resources such as subnets, VPCs, NAT gateways, SNAT/DNAT/FIP rules, EIPs, VIPs, and security groups.
- **Structured Creation Flows**: Resource creation uses human-friendly forms with generated YAML preview and an advanced YAML editor when direct edits are needed.
- **Resource-Specific Details**: Details are rendered by resource domain instead of raw YAML dumps: Pods, workloads, networks, storage, nodes, KubeVirt/CDI, and remaining resources each get structured overview sections.
- **Pod Access**: Related Pods are shown from owning resources such as Deployments, Services, NetworkPolicies, and KubeVirt VMs. Pod logs and interactive shell access are available from the details UI.
- **VM Console**: Serial console and VNC access are available for VirtualMachines.
- **Clean Manifests**: Manifest routes show YAML separately from the overview pages.
- **Single Binary**: All static assets are embedded into the Go binary for easy deployment.

## UI Preview

### Dashboard Overview
![Dashboard Overview](images/dashboard.png)

### Virtual Machine List
![Virtual Machine List](images/machines.png)

### Virtual Machine Details
![Virtual Machine Details](images/vm-detail.png)

### Resource Details
![Resource Details](images/resource-detail.png)

### Resource Creation Flow
![Resource Creation Flow](images/resource-create.png)

## Installation

### From Binary

Download the latest binary from the [Releases](https://github.com/jimyag/kubevirt-dashboard/releases) page.

```bash
# Run the dashboard (uses your local kubeconfig)
./kubevirt-dashboard --listen 127.0.0.1:11111
```

### In-Cluster Deployment

The dashboard can be deployed directly into your Kubernetes cluster:

```bash
kubectl apply -f manifest/deploy.yaml
```

After deployment, expose it locally:

```bash
kubectl port-forward -n kubevirt-dashboard svc/kubevirt-dashboard 8080:80
```

## Development

### Prerequisites

- Go 1.27+

The KubeVirt client SDK and its Kubernetes dependencies are updated together.
KubeVirt SDK 1.9 uses Kubernetes 0.34; OpenShift and kube-openapi replacements
follow the SDK's own `go.mod`. Review those compatibility pins when upgrading the
SDK instead of updating the replacement modules independently.
- Node.js & Bun (for frontend build)

### Build from source

```bash
# Build both UI and Go binary
make
```

### Running locally

```bash
# Build and start the embedded dashboard
make && ./kubevirt-dashboard --listen 127.0.0.1:11111
```

## License

MIT
