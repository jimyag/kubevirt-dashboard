import type { ResourceConfig } from "@/components/resource-management";

const versionFallbacks: Record<string, string[]> = {
  autoscaling: ["v2", "v2beta2", "v2beta1", "v1"],
  "cdi.kubevirt.io": ["v1beta1", "v1alpha1"],
  "cilium.io": ["v2", "v2alpha1"],
  "crd.projectcalico.org": ["v1"],
  "discovery.k8s.io": ["v1", "v1beta1"],
  "gateway.networking.k8s.io": ["v1", "v1beta1", "v1alpha2", "v1alpha1"],
  "instancetype.kubevirt.io": ["v1beta1", "v1alpha2", "v1alpha1"],
  "k8s.cni.cncf.io": ["v1", "v1beta1", "v1alpha1"],
  "kubeovn.io": ["v1", "v1alpha1"],
  "kubevirt.io": ["v1", "v1alpha3", "v1alpha2", "v1alpha1"],
  "networking.k8s.io": ["v1", "v1beta1", "v1alpha1"],
  "pool.kubevirt.io": ["v1beta1", "v1alpha1"],
  "projectcalico.org": ["v3"],
  "snapshot.kubevirt.io": ["v1beta1", "v1alpha1"],
  "snapshot.storage.k8s.io": ["v1", "v1beta1", "v1alpha1"],
  "storage.k8s.io": ["v1", "v1beta1", "v1alpha1"],
};

type ApiPathParts = {
  prefix: "api" | "apis";
  group: string;
  version: string;
  resource?: string;
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const parseApiPath = (path: string): ApiPathParts | null => {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1]) {
    return { prefix: "api", group: "", version: parts[1], resource: parts[2] };
  }
  if (parts[0] === "apis" && parts[1] && parts[2]) {
    return { prefix: "apis", group: parts[1], version: parts[2], resource: parts[3] };
  }
  return null;
};

const pathFor = (parts: ApiPathParts, version: string) => {
  if (parts.prefix === "api") {
    return `/${["api", version, parts.resource].filter(Boolean).join("/")}`;
  }
  return `/${["apis", parts.group, version, parts.resource].filter(Boolean).join("/")}`;
};

const versionCandidates = (parts: ApiPathParts) => {
  if (parts.prefix === "api") return [parts.version];
  return unique([parts.version, ...(versionFallbacks[parts.group] || [])]);
};

const calicoV3Path = (parts: ApiPathParts) => {
  if (parts.prefix !== "apis" || parts.group !== "crd.projectcalico.org" || !parts.resource) return "";
  return `/apis/projectcalico.org/v3/${parts.resource}`;
};

const calicoV3ResourcePath = (parts: ApiPathParts) => {
  if (parts.prefix !== "apis" || parts.group !== "crd.projectcalico.org") return "";
  return "/apis/projectcalico.org/v3";
};

export const expandListPaths = (config: ResourceConfig) => {
  const configured = [config.listPath, ...(config.listPathAlternates || [])];
  if (config.schema) return configured;
  const expanded = configured.flatMap((path) => {
    const parts = parseApiPath(path);
    if (!parts) return [path];
    return unique([...versionCandidates(parts).map((version) => pathFor(parts, version)), calicoV3Path(parts)]);
  });
  return unique(expanded);
};

export const expandResourcePaths = (config: ResourceConfig) => {
  const configured = [config.resourcePath, ...(config.resourcePathAlternates || [])];
  if (config.schema) return configured;
  const expanded = configured.flatMap((path) => {
    const parts = parseApiPath(path);
    if (!parts) return [path];
    return unique([...versionCandidates(parts).map((version) => pathFor({ ...parts, resource: undefined }, version)), calicoV3ResourcePath(parts)]);
  });
  return unique(expanded);
};

export const discoveryPathFromListPath = (listPath: string) => {
  const parts = parseApiPath(listPath);
  if (!parts) return listPath;
  return pathFor({ ...parts, resource: undefined }, parts.version);
};

export const resourcePathFromListPath = (listPath: string) => discoveryPathFromListPath(listPath);

export const resourceNameFromListPath = (listPath: string, fallback: string) => {
  const parts = parseApiPath(listPath);
  return parts?.resource || fallback;
};

export const apiVersionFromResourcePath = (resourcePath: string) => {
  const parts = parseApiPath(resourcePath);
  if (!parts) return "";
  return parts.prefix === "api" ? parts.version : `${parts.group}/${parts.version}`;
};

export const apiVersionFromListPath = (listPath: string) => apiVersionFromResourcePath(discoveryPathFromListPath(listPath));
