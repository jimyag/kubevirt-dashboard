import { knownRepositories } from "./helm"

/**
 * Monitoring stacks the Settings page can deploy with Helm. Each preset's values already make the
 * stack scrape KubeVirt's metrics service (kubevirt/kubevirt-prometheus-metrics, HTTPS on 8443)
 * with honorLabels, so kubevirt_vmi_* keep the VMI namespace in the namespace label.
 */

export type MonitoringBackend = "prometheus" | "victoriametrics"
export type DeployMethod = "operator" | "single"

export type MonitoringPreset = {
  id: string
  backend: MonitoringBackend
  method: DeployMethod
  /** English; translated where shown. */
  title: string
  description: string
  repo: string
  chart: string
  release: string
  namespace: string
  values: string
}

const kubevirtSelector = `namespaceSelector:
        matchNames: [kubevirt]
      selector:
        matchLabels:
          prometheus.kubevirt.io: "true"
      endpoints:
        - port: metrics
          scheme: https
          honorLabels: true
          tlsConfig:
            insecureSkipVerify: true`

const kubevirtScrapeJob = (indent: string) => `- job_name: kubevirt
  honor_labels: true
  scheme: https
  tls_config:
    insecure_skip_verify: true
  kubernetes_sd_configs:
    - role: endpoints
      namespaces:
        names: [kubevirt]
  relabel_configs:
    - source_labels: [__meta_kubernetes_service_name]
      regex: kubevirt-prometheus-metrics
      action: keep`.split("\n").map((line) => indent + line).join("\n")

export const monitoringPresets: MonitoringPreset[] = [
  {
    id: "kube-prometheus-stack",
    backend: "prometheus",
    method: "operator",
    title: "Prometheus Operator",
    description: "kube-prometheus-stack: operator, Prometheus, Alertmanager and exporters. Scrapes ServiceMonitors.",
    repo: knownRepositories[0].value,
    chart: "kube-prometheus-stack",
    release: "kube-prometheus-stack",
    namespace: "monitoring",
    values: `prometheus:
  prometheusSpec:
    retention: 15d
    # Pick up ServiceMonitors and PodMonitors from every release, not only this one.
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false
  additionalServiceMonitors:
    - name: kubevirt
      ${kubevirtSelector}
grafana:
  enabled: false
`,
  },
  {
    id: "prometheus",
    backend: "prometheus",
    method: "single",
    title: "Prometheus server",
    description: "prometheus chart: one Prometheus server with a scrape config, no operator.",
    repo: knownRepositories[0].value,
    chart: "prometheus",
    release: "prometheus",
    namespace: "monitoring",
    values: `server:
  retention: 15d
alertmanager:
  enabled: false
prometheus-pushgateway:
  enabled: false
extraScrapeConfigs: |
${kubevirtScrapeJob("  ")}
`,
  },
  {
    id: "victoria-metrics-k8s-stack",
    backend: "victoriametrics",
    method: "operator",
    title: "VictoriaMetrics Operator",
    description: "victoria-metrics-k8s-stack: operator, VMSingle, VMAgent and exporters. Scrapes VMServiceScrapes and ServiceMonitors.",
    repo: knownRepositories[2].value,
    chart: "victoria-metrics-k8s-stack",
    release: "vmks",
    namespace: "monitoring",
    values: `vmsingle:
  spec:
    retentionPeriod: 15d
grafana:
  enabled: false
extraObjects:
  - apiVersion: operator.victoriametrics.com/v1beta1
    kind: VMServiceScrape
    metadata:
      name: kubevirt
    spec:
      ${kubevirtSelector}
`,
  },
  {
    id: "victoria-metrics-single",
    backend: "victoriametrics",
    method: "single",
    title: "VictoriaMetrics single",
    description: "victoria-metrics-single: one VictoriaMetrics server with built-in scraping, no operator.",
    repo: knownRepositories[2].value,
    chart: "victoria-metrics-single",
    release: "victoria-metrics",
    namespace: "monitoring",
    values: `server:
  retentionPeriod: 15d
  scrape:
    enabled: true
    extraScrapeConfigs:
${kubevirtScrapeJob("      ")}
`,
  },
]

/** Charts the Settings page lists as monitoring deployments. */
export const monitoringCharts = new Set([...monitoringPresets.map((preset) => preset.chart), "victoria-metrics-operator", "victoria-metrics-cluster"])
