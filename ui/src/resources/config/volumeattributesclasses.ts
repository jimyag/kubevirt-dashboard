import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const volumeattributesclassesConfig: ResourceConfig = {
    id: "volumeattributesclasses",
    path: "/storage/kubernetes/volume-attributes-classes",
    title: "Volume Attributes Classes",
    subtitle: "Manage CSI VolumeAttributesClass parameter sets",
    listPath: "/apis/storage.k8s.io/v1/volumeattributesclasses",
    listPathAlternates: ["/apis/storage.k8s.io/v1beta1/volumeattributesclasses", "/apis/storage.k8s.io/v1alpha1/volumeattributesclasses"],
    namespaced: false,
    resourcePath: "/apis/storage.k8s.io/v1",
    resourcePathAlternates: ["/apis/storage.k8s.io/v1beta1", "/apis/storage.k8s.io/v1alpha1"],
    kind: "VolumeAttributesClass",
    createFields: [
      ...shared.nameOnlyFields("example-volume-attributes"),
      { name: "driverName", label: "Driver name", section: "Driver", defaultValue: "example.csi.io" },
      { name: "parameters", label: "Parameters", section: "Driver", type: "textarea", defaultValue: "", placeholder: "iops=3000\nthroughput=125" },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "storage.k8s.io/v1",
      kind: "VolumeAttributesClass",
      metadata: { name: shared.stringValue(values.name, "example-volume-attributes") },
      driverName: shared.stringValue(values.driverName, "example.csi.io"),
      parameters: shared.parseKeyValueText(shared.stringValue(values.parameters)),
    }),
    statusPath: ["driverName"],
    detailSections: shared.volumeAttributesClassDetailSections,
    extraColumns: [
      { label: "Driver", value: (r) => String(shared.getRecord(r).driverName || "N/A") },
      { label: "Parameters", value: (r) => String(Object.keys(shared.getRecord(shared.getRecord(r).parameters)).length) },
    ],
    createTemplate: `apiVersion: storage.k8s.io/v1
kind: VolumeAttributesClass
metadata:
  name: example-volume-attributes
driverName: example.csi.io
parameters: {}
`,
  };
