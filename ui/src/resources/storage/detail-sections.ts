import type { DetailSection } from "@/components/resource-management"
import { formatStorageSize } from "../../lib/metrics"

type KubeLikeResource = {
  metadata?: Record<string, unknown>
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
  [key: string]: unknown
}

const getRecord = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {})
const joinList = (value: unknown) => Array.isArray(value) ? value.filter(Boolean).join(", ") : ""

const conditions = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value.map((condition) => ({
    type: condition.type,
    status: condition.status,
    reason: condition.reason,
    message: condition.message,
    lastTransitionTime: condition.lastTransitionTime,
  }))
}

const volumeSource = (spec: Record<string, unknown>) => {
  const sourceKeys = [
    "awsElasticBlockStore",
    "azureDisk",
    "azureFile",
    "cephfs",
    "cinder",
    "csi",
    "fc",
    "flexVolume",
    "flocker",
    "gcePersistentDisk",
    "glusterfs",
    "hostPath",
    "iscsi",
    "local",
    "nfs",
    "photonPersistentDisk",
    "portworxVolume",
    "quobyte",
    "rbd",
    "scaleIO",
    "storageos",
    "vsphereVolume",
  ]
  return Object.fromEntries(sourceKeys.filter((key) => spec[key]).map((key) => [key, spec[key]]))
}

export const storageClassDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const parameters = getRecord(resource.parameters)
  const metadata = getRecord(resource.metadata)

  return [
    {
      title: "Provisioner",
      items: [
        { label: "Provisioner", value: resource.provisioner },
        { label: "Reclaim Policy", value: resource.reclaimPolicy },
        { label: "Volume Binding Mode", value: resource.volumeBindingMode },
        { label: "Allow Expansion", value: resource.allowVolumeExpansion },
        { label: "Default Class", value: getRecord(metadata.annotations)["storageclass.kubernetes.io/is-default-class"] },
      ],
    },
    {
      title: "Parameters",
      items: [{ label: "Parameters", value: parameters, fullWidth: true }],
    },
    {
      title: "Mount Options",
      items: [{ label: "Mount Options", value: resource.mountOptions, fullWidth: true }],
    },
  ]
}

export const persistentVolumeClaimDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)
  const status = getRecord(resource.status)
  const requests = getRecord(getRecord(status.capacity).storage ? status.capacity : getRecord(getRecord(spec.resources).requests))
  const selector = getRecord(spec.selector)

  return [
    {
      title: "Claim",
      items: [
        { label: "Phase", value: status.phase },
        { label: "Volume", value: spec.volumeName },
        { label: "Storage Class", value: spec.storageClassName },
        { label: "Volume Mode", value: spec.volumeMode },
        { label: "Access Modes", value: joinList(spec.accessModes) },
      ],
    },
    {
      title: "Capacity",
      items: [
        { label: "Requested Storage", value: formatStorageSize(getRecord(getRecord(spec.resources).requests).storage) },
        { label: "Bound Capacity", value: formatStorageSize(requests.storage) },
        { label: "Allocated Resources", value: status.allocatedResources, fullWidth: true },
        { label: "Allocated Resource Statuses", value: status.allocatedResourceStatuses, fullWidth: true },
      ],
    },
    {
      title: "Selector",
      items: [
        { label: "Match Labels", value: selector.matchLabels, fullWidth: true },
        { label: "Match Expressions", value: selector.matchExpressions, fullWidth: true },
      ],
    },
    {
      title: "Conditions",
      items: [{ label: "Conditions", value: conditions(status.conditions), fullWidth: true }],
    },
  ]
}

export const persistentVolumeDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)
  const status = getRecord(resource.status)
  const claimRef = getRecord(spec.claimRef)

  return [
    {
      title: "Volume",
      items: [
        { label: "Phase", value: status.phase },
        { label: "Capacity", value: formatStorageSize(getRecord(spec.capacity).storage) },
        { label: "Storage Class", value: spec.storageClassName },
        { label: "Volume Mode", value: spec.volumeMode },
        { label: "Access Modes", value: joinList(spec.accessModes) },
        { label: "Reclaim Policy", value: spec.persistentVolumeReclaimPolicy },
        { label: "Mount Options", value: spec.mountOptions, fullWidth: true },
      ],
    },
    {
      title: "Claim",
      items: [
        { label: "Namespace", value: claimRef.namespace },
        { label: "Name", value: claimRef.name },
        { label: "UID", value: claimRef.uid },
      ],
    },
    {
      title: "Source",
      items: [{ label: "Volume Source", value: volumeSource(spec), fullWidth: true }],
    },
    {
      title: "Node Affinity",
      items: [{ label: "Node Affinity", value: spec.nodeAffinity, fullWidth: true }],
    },
    {
      title: "Conditions",
      items: [{ label: "Conditions", value: conditions(status.conditions), fullWidth: true }],
    },
  ]
}

export const csiDriverDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)

  return [
    {
      title: "Driver",
      items: [
        { label: "Attach Required", value: spec.attachRequired },
        { label: "Pod Info On Mount", value: spec.podInfoOnMount },
        { label: "Storage Capacity", value: spec.storageCapacity },
        { label: "Requires Republish", value: spec.requiresRepublish },
        { label: "FS Group Policy", value: spec.fsGroupPolicy },
        { label: "SELinux Mount", value: spec.seLinuxMount },
        { label: "Volume Lifecycle Modes", value: joinList(spec.volumeLifecycleModes) },
      ],
    },
    {
      title: "Token Requests",
      items: [{ label: "Token Requests", value: spec.tokenRequests, fullWidth: true }],
    },
  ]
}

export const csiNodeDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)

  return [
    {
      title: "Drivers",
      items: [{ label: "Drivers", value: spec.drivers, fullWidth: true }],
    },
  ]
}

export const csiStorageCapacityDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const nodeTopology = getRecord(getRecord(resource.nodeTopology || getRecord(resource.spec).nodeTopology).matchLabels)

  return [
    {
      title: "Capacity",
      items: [
        { label: "Storage Class", value: resource.storageClassName || getRecord(resource.spec).storageClassName },
        { label: "Capacity", value: resource.capacity || getRecord(resource.spec).capacity },
        { label: "Maximum Volume Size", value: resource.maximumVolumeSize || getRecord(resource.spec).maximumVolumeSize },
      ],
    },
    {
      title: "Topology",
      items: [{ label: "Node Topology", value: nodeTopology, fullWidth: true }],
    },
  ]
}

export const volumeAttachmentDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)
  const status = getRecord(resource.status)
  const source = getRecord(spec.source)

  return [
    {
      title: "Attachment",
      items: [
        { label: "Attacher", value: spec.attacher },
        { label: "Node", value: spec.nodeName },
        { label: "Persistent Volume", value: source.persistentVolumeName },
        { label: "Attached", value: status.attached },
      ],
    },
    {
      title: "Source",
      items: [{ label: "Source", value: source, fullWidth: true }],
    },
    {
      title: "Status",
      items: [
        { label: "Attachment Metadata", value: status.attachmentMetadata, fullWidth: true },
        { label: "Attach Error", value: status.attachError, fullWidth: true },
        { label: "Detach Error", value: status.detachError, fullWidth: true },
      ],
    },
  ]
}

export const volumeAttributesClassDetailSections = (resource: KubeLikeResource): DetailSection[] => [
  {
    title: "Volume Attributes",
    items: [
      { label: "Driver", value: resource.driverName },
      { label: "Parameters", value: resource.parameters, fullWidth: true },
    ],
  },
]

export const volumeSnapshotClassDetailSections = (resource: KubeLikeResource): DetailSection[] => [
  {
    title: "Snapshot Class",
    items: [
      { label: "Driver", value: resource.driver },
      { label: "Deletion Policy", value: resource.deletionPolicy },
      { label: "Parameters", value: resource.parameters, fullWidth: true },
    ],
  },
]

export const volumeSnapshotDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)
  const status = getRecord(resource.status)
  const source = getRecord(spec.source)

  return [
    {
      title: "Snapshot",
      items: [
        { label: "Class", value: spec.volumeSnapshotClassName },
        { label: "Bound Content", value: status.boundVolumeSnapshotContentName },
        { label: "Ready To Use", value: status.readyToUse },
        { label: "Restore Size", value: status.restoreSize },
        { label: "Creation Time", value: status.creationTime },
      ],
    },
    {
      title: "Source",
      items: [
        { label: "Persistent Volume Claim", value: source.persistentVolumeClaimName },
        { label: "Volume Snapshot Content", value: source.volumeSnapshotContentName },
      ],
    },
    {
      title: "Errors",
      items: [{ label: "Error", value: status.error, fullWidth: true }],
    },
  ]
}

export const volumeSnapshotContentDetailSections = (resource: KubeLikeResource): DetailSection[] => {
  const spec = getRecord(resource.spec)
  const status = getRecord(resource.status)
  const snapshotRef = getRecord(spec.volumeSnapshotRef)

  return [
    {
      title: "Content",
      items: [
        { label: "Class", value: spec.volumeSnapshotClassName },
        { label: "Driver", value: spec.driver },
        { label: "Deletion Policy", value: spec.deletionPolicy },
        { label: "Snapshot Handle", value: spec.snapshotHandle },
        { label: "Ready To Use", value: status.readyToUse },
        { label: "Restore Size", value: status.restoreSize },
      ],
    },
    {
      title: "Snapshot Ref",
      items: [
        { label: "Namespace", value: snapshotRef.namespace },
        { label: "Name", value: snapshotRef.name },
        { label: "UID", value: snapshotRef.uid },
      ],
    },
    {
      title: "Source",
      items: [{ label: "Source", value: getRecord(spec.source), fullWidth: true }],
    },
    {
      title: "Errors",
      items: [{ label: "Error", value: status.error, fullWidth: true }],
    },
  ]
}
