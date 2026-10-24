/** Types and helpers shared by the instance and disk detail pages. */

export interface ResourceMetadata { name: string; namespace: string; uid: string; creationTimestamp: string; labels?: Record<string, string>; annotations?: Record<string, string>; }
export type UnknownRecord = Record<string, unknown>;
export interface VmDisk { name?: string; bootOrder?: number; disk?: UnknownRecord; cdrom?: UnknownRecord; lun?: UnknownRecord }
export interface VmVolume { name: string; dataVolume?: { name: string }; persistentVolumeClaim?: { claimName?: string }; containerDisk?: { image?: string }; cloudInitNoCloud?: UnknownRecord }
export interface VM { metadata: ResourceMetadata; spec: { running?: boolean; runStrategy?: string; instancetype?: { name?: string }; template?: { metadata?: { labels?: Record<string, string>; annotations?: Record<string, string>; }; spec?: { architecture?: string; priorityClassName?: string; domain?: { machine?: { type?: string }; cpu?: { cores?: number, sockets?: number, threads?: number }; resources?: { requests?: { cpu?: string, memory?: string } }; devices?: { interfaces?: Array<{ name: string, model?: string }>; disks?: VmDisk[] }; }; networks?: Array<{ name: string, pod?: unknown }>; volumes?: VmVolume[]; }; }; }; status?: { printableStatus?: string; conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; }; }
export interface VMI { metadata: ResourceMetadata; spec?: NonNullable<VM["spec"]["template"]>["spec"]; status: { phase: string; interfaces?: Array<{ ipAddress?: string; name: string }>; nodeName?: string }; }
export interface DVStorageSpec { storageClassName?: string; accessModes?: string[]; volumeMode?: string; resources?: { requests?: { storage?: string } } }
export interface DV { metadata: ResourceMetadata; status?: { phase: string; progress?: string; claimName?: string; conditions?: Array<{ type: string; status: string; message?: string; reason?: string }>; }; spec: { storage?: DVStorageSpec; pvc?: DVStorageSpec; source?: Record<string, unknown>; }; }
export interface DiskPVC { metadata: ResourceMetadata; spec?: DVStorageSpec; status?: { capacity?: { storage?: string } } }
export const diskSize = (dv: DV, pvc?: DiskPVC | null) => pvc?.spec?.resources?.requests?.storage || dv.spec.storage?.resources?.requests?.storage || dv.spec.pvc?.resources?.requests?.storage || "N/A";

// --- Utils ---
export const getContext = () => localStorage.getItem("kube-context") || "";
export const apiFetch = (url: string, options: RequestInit = {}) => {
  const ctx = getContext(); const headers = new Headers(options.headers || {});
  if (ctx) headers.set("X-Kube-Context", ctx);
  return fetch(url, { ...options, headers });
};
export const asRecord = (value: unknown): UnknownRecord => value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
export const isVm = (value: unknown): value is VM => Boolean(asRecord(value).metadata && asRecord(value).spec);
export const vmRuntimeSpec = (vm: VM, vmi?: VMI | null) => vmi?.spec ?? vm.spec.template?.spec;
export const vmPodSelectors = (name: string): Array<Record<string, string>> => [
  { "vm.kubevirt.io/name": name },
  { "vmi.kubevirt.io/id": name },
  { "las.qiniu.io/vm-id": name },
  { "kubevirt.io/domain": name },
];
