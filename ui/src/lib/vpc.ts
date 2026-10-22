import { apiFetch, asList, asRecord, requestJson, str, type KubeObject, type UnknownRecord } from "./kube"
import { cidrsOverlap, ipv4Cidr, ipv4ToNumber, parseIPv4Cidr } from "./validate"
import { t } from "./i18n"

/** Kube-OVN VPC helpers shared by the VPC, route table, peering and IP pool pages. */

export const OVN = "/apis/kubeovn.io/v1"
export const DEFAULT_VPC = "ovn-cluster"

export const mergePatch = (url: string, body: unknown) =>
  requestJson(url, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify(body) })

export const getVpc = async (name: string) => {
  const res = await apiFetch(`${OVN}/vpcs/${name}`)
  if (!res.ok) throw new Error(t("VPC {vpc} not found", { vpc: name }))
  return await res.json() as KubeObject
}

export const isIp = (value: string) => value.includes(":") || ipv4ToNumber(value) !== null
export const isCidr = (value: string) => value.includes(":") ? value.includes("/") : parseIPv4Cidr(value) !== null
export const withoutPrefix = (cidr: string) => cidr.split("/")[0]

// --- Routes ---

export type StaticRoute = { cidr: string; nextHopIP: string; policy: string; extra: UnknownRecord }
export type PolicyRoute = { priority: string; match: string; action: string; nextHopIP: string }

export const readStatic = (spec: UnknownRecord): StaticRoute[] =>
  asList(spec.staticRoutes).map(({ cidr, nextHopIP, policy, ...extra }) => ({ cidr: str(cidr), nextHopIP: str(nextHopIP), policy: str(policy, "policyDst"), extra }))

export const readPolicy = (spec: UnknownRecord): PolicyRoute[] =>
  asList(spec.policyRoutes).map((route) => ({ priority: str(route.priority, "1000"), match: str(route.match), action: str(route.action, "allow"), nextHopIP: str(route.nextHopIP) }))

// --- Peering ---

export type Peering = { remoteVpc: string; localConnectIP: string }

export const readPeerings = (vpc: KubeObject | undefined): Peering[] =>
  asList(asRecord(vpc?.spec).vpcPeerings).map((peering) => ({ remoteVpc: str(peering.remoteVpc), localConnectIP: str(peering.localConnectIP) }))

/** Picks a free /30 in 169.254.0.0/16 that no peering of any VPC uses yet. */
export const freeConnectCidr = (vpcs: KubeObject[]) => {
  const used = vpcs.flatMap((vpc) => readPeerings(vpc).map((peering) => peering.localConnectIP))
  for (let block = 0; block < 16384; block++) {
    const third = Math.floor(block / 64)
    const fourth = (block % 64) * 4
    const cidr = `169.254.${third}.${fourth}/30`
    if (!used.some((item) => cidrsOverlap(item, cidr))) return cidr
  }
  return "169.254.0.0/30"
}

/** The two usable addresses of a /30: [local, remote]. */
export const connectPair = (cidr: string) => {
  const range = parseIPv4Cidr(cidr)
  if (!range || range.prefix !== 30) return null
  const toIp = (value: number) => [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".")
  return [`${toIp(range.start + 1)}/30`, `${toIp(range.start + 2)}/30`]
}

export const subnetCidrs = (subnets: KubeObject[], vpc: string) =>
  subnets.filter((subnet) => str(asRecord(subnet.spec).vpc, DEFAULT_VPC) === vpc).map((subnet) => ipv4Cidr(str(asRecord(subnet.spec).cidrBlock))).filter(Boolean)

/** Removes a peering, and the routes through it, from both VPCs. */
export const removePeering = async (localName: string, peering: Peering) => {
  const [local, remote] = await Promise.all([getVpc(localName), getVpc(peering.remoteVpc).catch(() => null)])
  const remotePeering = readPeerings(remote ?? undefined).find((item) => item.remoteVpc === localName)
  const strip = (obj: KubeObject, remoteVpc: string, peerIp: string | undefined) => ({
    spec: {
      vpcPeerings: asList(asRecord(obj.spec).vpcPeerings).filter((item) => str(item.remoteVpc) !== remoteVpc),
      staticRoutes: asList(asRecord(obj.spec).staticRoutes).filter((route) => !peerIp || str(route.nextHopIP) !== peerIp),
    },
  })
  await mergePatch(`${OVN}/vpcs/${localName}`, strip(local, peering.remoteVpc, remotePeering && withoutPrefix(remotePeering.localConnectIP)))
  if (remote) await mergePatch(`${OVN}/vpcs/${peering.remoteVpc}`, strip(remote, localName, withoutPrefix(peering.localConnectIP)))
}

/** Active when both VPCs list each other, Pending when only one side does, Missing when the peer VPC is gone. */
export const peeringStatus = (local: string, peering: Peering, byName: Map<string, KubeObject>) => {
  const remote = byName.get(peering.remoteVpc)
  return !remote ? "Missing" : readPeerings(remote).some((item) => item.remoteVpc === local) ? "Active" : "Pending"
}

// --- IP pools ---

export const poolStatus = (pool: KubeObject) => {
  const ready = asList(asRecord(pool.status).conditions).find((condition) => condition.type === "Ready")
  return !ready ? "Pending" : ready.status === "True" ? "Ready" : "NotReady"
}
