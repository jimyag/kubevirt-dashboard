import { expect, test } from "bun:test"

Object.assign(globalThis.navigator, { language: "en" })

import type { NavItem } from "../src/lib/navigation"
import type { Discovery, NetworkProfile } from "../src/lib/kube"

const { buildNavSections, findActiveNav, navItemLabel } = await import("../src/lib/navigation")
const { resourceConfigs, vmCreateConfig, dvCreateConfig } = await import("../src/resources/configs")
const { resourceKindLabel, resourceLabel, setLocale } = await import("../src/lib/i18n")
const { resourceKindLabels, resourceLabels } = await import("../src/lib/locales/zh")

const profile: NetworkProfile = {
  id: "pod",
  label: "Pod network",
  description: "",
  vpc: false,
  acl: "networkpolicy",
  aclEngines: [],
  detected: "pod",
  override: "auto",
  kubeOvnInstalled: false,
  ciliumInstalled: false,
  loaded: true,
}

const discovery = (resources: Discovery["resources"], loaded = true): Discovery => ({
  loaded,
  hasGroupVersion: () => false,
  hasResource: (apiVersion, resource) => resources.some((item) => item.apiVersion === apiVersion && item.name === resource),
  resources,
})

const pages = (items: NavItem[]): NavItem[] =>
  items.flatMap((item) => item.children ? pages(item.children) : [item])

const networkResources: Discovery["resources"] = [
  { name: "networkpolicies", apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", namespaced: true },
  { name: "services", apiVersion: "v1", kind: "Service", namespaced: true },
  { name: "endpointslices", apiVersion: "discovery.k8s.io/v1", kind: "EndpointSlice", namespaced: true },
  { name: "endpoints", apiVersion: "v1", kind: "Endpoints", namespaced: true },
  { name: "ingresses", apiVersion: "networking.k8s.io/v1", kind: "Ingress", namespaced: true },
  { name: "ingressclasses", apiVersion: "networking.k8s.io/v1", kind: "IngressClass", namespaced: false },
]

test("network extension leaves use any served candidate API, including Calico v3", () => {
  const sections = buildNavSections(profile, discovery([
    ...networkResources,
    { name: "networkpolicies", apiVersion: "projectcalico.org/v3", kind: "NetworkPolicy", namespaced: true },
    { name: "globalnetworkpolicies", apiVersion: "projectcalico.org/v3", kind: "GlobalNetworkPolicy", namespaced: false },
  ]))
  const extensions = sections.find((section) => section.label === "Networking")?.items.find((item) => item.name === "Network extensions")
  expect(extensions?.name).toBe("Network extensions")
  expect(pages(extensions?.children || []).map((item) => item.path)).toContain("/networks/calico/network-policies")
})

test("the network extensions group is retained when only one provider is served", () => {
  const sections = buildNavSections(profile, discovery([
    ...networkResources,
    { name: "ciliumnetworkpolicies", apiVersion: "cilium.io/v2", kind: "CiliumNetworkPolicy", namespaced: true },
  ]))
  const extensions = sections.find((section) => section.label === "Networking")?.items.find((item) => item.name === "Network extensions")
  expect(extensions?.children?.map((item) => item.name)).toEqual(["Cilium Network Policies"])
  expect(extensions?.path).toBe("/networks/cilium/network-policies")
})

test("Envoy Gateway stays visible before discovery and expands into dynamic CRDs after it loads", () => {
  const before = buildNavSections(profile, discovery([], false))
  const beforeExtensions = before.find((section) => section.label === "Networking")?.items.find((item) => item.name === "Network extensions")
  expect(beforeExtensions?.children?.map((item) => item.name)).toContain("Envoy Gateway")

  const after = buildNavSections(profile, discovery([
    ...networkResources,
    { name: "envoyproxies", apiVersion: "gateway.envoyproxy.io/v1alpha1", kind: "EnvoyProxy", namespaced: true },
    { name: "clienttrafficpolicies", apiVersion: "gateway.envoyproxy.io/v1alpha1", kind: "ClientTrafficPolicy", namespaced: true },
  ]))
  const envoy = after.find((section) => section.label === "Networking")?.items.find((item) => item.name === "Network extensions")?.children?.find((item) => item.name === "Envoy Gateway")
  expect(envoy?.children?.map((item) => item.name)).toEqual(["ClientTrafficPolicy", "EnvoyProxy"])
  expect(findActiveNav("/catalog/crds/gateway.envoyproxy.io/envoyproxies/v1alpha1/default/example", after)?.ancestors.map((item) => item.name))
    .toEqual(["Network extensions", "Envoy Gateway"])
})

test("resource pages use Chinese name and Kubernetes abbreviation consistently", () => {
  setLocale("zh")
  try {
    const items = buildNavSections(profile, discovery([], false)).flatMap((section) => section.items)
    const pvc = pages(items)
      .find((item) => item.path === "/storage/kubernetes/persistent-volume-claims")
    const storageClass = pages(items)
      .find((item) => item.path === "/storage/kubernetes/storage-classes")

    expect(pvc && navItemLabel(pvc)).toBe("持久卷声明（PVC）")
    expect(storageClass && navItemLabel(storageClass)).toBe("存储类（StorageClass）")
    expect(resourceLabel("PersistentVolumeClaims")).toBe("持久卷声明（PVC）")
  } finally {
    setLocale("en")
  }
})

test("resource labels leave English navigation unchanged", () => {
  setLocale("en")
  const pvc = pages(buildNavSections(profile, discovery([], false)).flatMap((section) => section.items))
    .find((item) => item.path === "/storage/kubernetes/persistent-volume-claims")

  expect(pvc && navItemLabel(pvc)).toBe("PersistentVolumeClaims")
  expect(resourceLabel("PersistentVolumeClaims")).toBe("PersistentVolumeClaims")
})

test("every static resource title has a Chinese resource label", () => {
  const titles = new Set([...Object.values(resourceConfigs), vmCreateConfig, dvCreateConfig].map((config) => config.title))
  expect([...titles].filter((title) => !resourceLabels[title])).toEqual([])
})

test("resource label falls back to a known Kind for dynamic pages", () => {
  setLocale("zh")
  try {
    expect(resourceKindLabels.EnvoyProxy).toBeUndefined()
    expect(resourceLabel("EnvoyProxy")).toBe("EnvoyProxy")
    expect(resourceKindLabel("EnvoyProxy")).toBe("EnvoyProxy")
    expect(resourceLabel("VirtualMachine")).toBe("虚拟机（VM）")
    expect(resourceKindLabel("Secret")).toBe("Secret")
    expect(resourceKindLabel("IPPool")).toBe("IPPool")
    expect(resourceLabel("Secrets")).toBe("保密字典（Secret）")
  } finally {
    setLocale("en")
  }
})

test("navigation prefers the exact page path when prefixes tie", () => {
  const sections = buildNavSections(profile, discovery([
    ...networkResources,
    { name: "virtualmachineinstances", apiVersion: "kubevirt.io/v1", kind: "VirtualMachineInstance", namespaced: true },
    { name: "ciliumnetworkpolicies", apiVersion: "cilium.io/v2", kind: "CiliumNetworkPolicy", namespaced: true },
  ]))

  expect(findActiveNav("/kubevirt/virtualization/virtual-machine-instances", sections)?.item.name).toBe("Running instances")
  expect(findActiveNav("/networks/cilium/network-policies", sections)?.item.name).toBe("Cilium Network Policies")
})

test("navigation groups keep ordinary translations instead of resource labels", () => {
  setLocale("zh")
  try {
    const extensions = buildNavSections(profile, discovery([], false))
      .find((section) => section.label === "Networking")?.items.find((item) => item.name === "Network extensions")
    expect(extensions && navItemLabel(extensions)).toBe("网络扩展")
    expect(extensions && navItemLabel(extensions)).not.toBe("网络扩展（Network extensions）")
  } finally {
    setLocale("en")
  }
})
