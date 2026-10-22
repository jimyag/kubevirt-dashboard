import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const volumeattachmentsConfig: ResourceConfig = {
    id: "volumeattachments",
    path: "/storage/kubernetes/volume-attachments",
    title: "Volume Attachments",
    subtitle: "Manage Kubernetes VolumeAttachment attach intent objects",
    listPath: "/apis/storage.k8s.io/v1/volumeattachments",
    listPathAlternates: ["/apis/storage.k8s.io/v1beta1/volumeattachments", "/apis/storage.k8s.io/v1alpha1/volumeattachments"],
    namespaced: false,
    resourcePath: "/apis/storage.k8s.io/v1",
    resourcePathAlternates: ["/apis/storage.k8s.io/v1beta1", "/apis/storage.k8s.io/v1alpha1"],
    kind: "VolumeAttachment",
    createFields: [
      ...shared.nameOnlyFields("example-attachment"),
      { name: "attacher", label: "Attacher", section: "Attachment", defaultValue: "example.csi.io" },
      { name: "nodeName", label: "Node name", section: "Attachment", defaultValue: "example-node" },
      { name: "persistentVolumeName", label: "Persistent volume", section: "Source", defaultValue: "example-pv" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "storage.k8s.io/v1",
      kind: "VolumeAttachment",
      metadata: { name: shared.stringValue(values.name, "example-attachment") },
      spec: {
        attacher: shared.stringValue(values.attacher, "example.csi.io"),
        nodeName: shared.stringValue(values.nodeName, "example-node"),
        source: { persistentVolumeName: shared.stringValue(values.persistentVolumeName, "example-pv") },
      },
    }),
    statusPath: ["status", "attached"],
    detailSections: shared.volumeAttachmentDetailSections,
    extraColumns: [
      { label: "Attacher", value: (r) => String(shared.getRecord(r.spec).attacher || "N/A") },
      { label: "Node", value: (r) => String(shared.getRecord(r.spec).nodeName || "N/A") },
      { label: "Attached", value: (r) => String(shared.getRecord(r.status).attached ?? "N/A") },
    ],
    createTemplate: `apiVersion: storage.k8s.io/v1
kind: VolumeAttachment
metadata:
  name: example-attachment
spec:
  attacher: example.csi.io
  nodeName: example-node
  source:
    persistentVolumeName: example-pv
`,
  };
