import type { ResourceConfig } from "@/components/resource-management";
import * as shared from "./shared";

export const secretsConfig: ResourceConfig = {
    id: "secrets",
    path: "/kubevirt/operations/ssh-keys",
    title: "SSH Keys",
    subtitle: "Manage Secret resources used for SSH access",
    listPath: "/api/v1/secrets",
    listQuery: "labelSelector=kubevirt-manager.io/managed%3Dtrue,kubevirt-manager.io/ssh%3Dtrue",
    namespaced: true,
    resourcePath: "/api/v1",
    kind: "Secret",
    createFields: [
      ...shared.namespaceNameFields("example-ssh-key"),
      { name: "key", label: "SSH public key", type: "textarea", defaultValue: "ssh-rsa AAAA..." },
    ],
    buildCreateResource: (values) => ({
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: shared.stringValue(values.name, "example-ssh-key"),
        namespace: shared.stringValue(values.namespace, "default"),
        labels: { "kubevirt-manager.io/managed": "true", "kubevirt-manager.io/ssh": "true" },
      },
      type: "Opaque",
      stringData: { key: shared.stringValue(values.key, "ssh-rsa AAAA...") },
    }),
    statusPath: ["type"],
    detailSections: (r) => [{
      title: "Secret",
      items: [
        { label: "Type", value: r.type },
        { label: "Keys", value: Object.keys(shared.getRecord(r.data)) },
        { label: "String data keys", value: Object.keys(shared.getRecord(r.stringData)) },
      ],
    }],
    extraColumns: [
      { label: "Type", value: (r) => String((r as unknown as { type?: string }).type || "Opaque") },
    ],
    createTemplate: `apiVersion: v1
kind: Secret
metadata:
  name: example-ssh-key
  namespace: default
  labels:
    kubevirt-manager.io/managed: "true"
    kubevirt-manager.io/ssh: "true"
type: Opaque
stringData:
  key: ssh-rsa AAAA...
`,
  };
