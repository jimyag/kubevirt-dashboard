import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, RefreshCw, ScrollText, Terminal as TerminalIcon } from "lucide-react"
import { Terminal as XTerm } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import "xterm/css/xterm.css"

import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/console"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { t } from "@/lib/i18n"

type ContainerInfo = {
  name: string
  ready?: boolean
  restartCount?: number
}

export type PodSummary = {
  metadata: {
    name: string
    namespace?: string
    uid?: string
    labels?: Record<string, string>
    creationTimestamp?: string
  }
  spec?: {
    nodeName?: string
    containers?: ContainerInfo[]
  }
  status?: {
    phase?: string
    podIP?: string
    containerStatuses?: ContainerInfo[]
  }
}

type RelatedPodsCardProps = {
  title?: string
  description?: string
  namespace: string
  selector?: Record<string, string>
  selectors?: Array<Record<string, string>>
  podName?: string
  pods?: PodSummary[]
  className?: string
}

const getContext = () => localStorage.getItem("kube-context") || ""

const apiFetch = (url: string, options: RequestInit = {}) => {
  const ctx = getContext()
  const headers = new Headers(options.headers || {})
  if (ctx) headers.set("X-Kube-Context", ctx)
  return fetch(url, { ...options, headers })
}

const selectorText = (selector?: Record<string, string>) =>
  Object.entries(selector || {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(",")

const containersForPod = (pod: PodSummary) => {
  const declared = pod.spec?.containers || []
  const statuses = pod.status?.containerStatuses || []
  return declared.map((container) => {
    const status = statuses.find((item) => item.name === container.name)
    return {
      ...container,
      ready: status?.ready,
      restartCount: status?.restartCount,
    }
  })
}

function PodLogDialog({ pod }: { pod: PodSummary }) {
  const containers = containersForPod(pod)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState(containers[0]?.name || "")
  const [logs, setLogs] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const selectedContainer = container || containers[0]?.name || ""

  const loadLogs = useCallback(async () => {
    if (!pod.metadata.namespace || !pod.metadata.name) return
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ tailLines: "500", timestamps: "true" })
      if (selectedContainer) params.set("container", selectedContainer)
      const response = await apiFetch(`/api/v1/namespaces/${pod.metadata.namespace}/pods/${pod.metadata.name}/log?${params.toString()}`)
      if (!response.ok) throw new Error(await response.text())
      setLogs(await response.text())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pod logs")
      setLogs("")
    } finally {
      setLoading(false)
    }
  }, [pod.metadata.name, pod.metadata.namespace, selectedContainer])

  useEffect(() => {
    if (open) loadLogs()
  }, [loadLogs, open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <ScrollText className="h-4 w-4" />{t("Logs")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("Pod Logs")}</DialogTitle>
          <DialogDescription>{pod.metadata.namespace}/{pod.metadata.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            value={selectedContainer}
            onChange={(event) => setContainer(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          >
            {containers.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={loadLogs} className="gap-2" disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}
          </Button>
        </div>
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <span className="break-words">{error}</span>
          </div>
        ) : (
          <pre className="max-h-[65vh] min-h-[420px] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs text-foreground whitespace-pre-wrap">
            {loading ? t("Loading...") : logs || t("No logs returned")}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PodShellDialog({ pod }: { pod: PodSummary }) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const terminalDataCleanupRef = useRef<(() => void) | null>(null)
  const containers = containersForPod(pod)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState(containers[0]?.name || "")
  const [command, setCommand] = useState("sh")
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "closed" | "error">("idle")
  const selectedContainer = container || containers[0]?.name || ""

  const createTerminal = () => {
    if (terminalRef.current) return terminalRef.current
    if (!termRef.current) return null

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono)",
      theme: { background: "transparent" },
      convertEol: true,
      scrollback: 10000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()
    terminalRef.current = term
    fitAddonRef.current = fitAddon
    setStatus("idle")
    term.writeln("Choose a container and command, then press Enter or Connect.")

    const dataDisposable = term.onData((data) => {
      if (websocketRef.current?.readyState === WebSocket.OPEN) websocketRef.current.send(data)
    })
    terminalDataCleanupRef.current = () => dataDisposable.dispose()

    const handleResize = () => fitAddon.fit()
    window.addEventListener("resize", handleResize)
    resizeCleanupRef.current = () => window.removeEventListener("resize", handleResize)
    return term
  }

  useEffect(() => {
    if (!open || !pod.metadata.namespace || !pod.metadata.name) return

    const frame = window.requestAnimationFrame(() => {
      createTerminal()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      websocketRef.current?.close()
      websocketRef.current = null
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      terminalDataCleanupRef.current?.()
      terminalDataCleanupRef.current = null
      resizeCleanupRef.current?.()
      resizeCleanupRef.current = null
      setStatus("idle")
    }
  }, [open, pod.metadata.name, pod.metadata.namespace])

  const connectShell = () => {
    const term = createTerminal()
    if (!term || !pod.metadata.namespace || !pod.metadata.name) {
      setStatus("error")
      return
    }

    websocketRef.current?.close()
    websocketRef.current = null
    term.clear()
    term.writeln(`Connecting to ${pod.metadata.namespace}/${pod.metadata.name} with "${command || "sh"}"...`)
    setStatus("connecting")

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const params = new URLSearchParams({
      namespace: pod.metadata.namespace,
      pod: pod.metadata.name,
      command: command || "sh",
      context: getContext(),
    })
    if (selectedContainer) params.set("container", selectedContainer)

    const websocket = new WebSocket(`${protocol}//${window.location.host}/api/v1/pod-exec?${params.toString()}`)
    websocket.binaryType = "arraybuffer"
    websocketRef.current = websocket

    websocket.onopen = () => {
      setStatus("connected")
      term.writeln("Connected.")
      term.focus()
    }
    websocket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new TextDecoder().decode(event.data))
        return
      }
      if (typeof event.data === "string" && event.data.startsWith("exec error")) {
        setStatus("error")
        term.writeln(`\r\n${event.data}`)
        return
      }
      if (typeof event.data === "string") {
        term.writeln(event.data)
      }
    }
    websocket.onerror = () => {
      setStatus("error")
      term.writeln("\r\nWebSocket error while connecting to pod exec.")
    }
    websocket.onclose = () => {
      if (websocketRef.current === websocket) setStatus("closed")
    }
  }

  const disconnectShell = () => {
    websocketRef.current?.close()
    websocketRef.current = null
    setStatus("closed")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <TerminalIcon className="h-4 w-4" />{t("Shell")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("Pod Shell")}</DialogTitle>
          <DialogDescription>{pod.metadata.namespace}/{pod.metadata.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:items-center">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("Container")}</span>
            <select
              value={selectedContainer}
              onChange={(event) => setContainer(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {containers.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t("Command")}</span>
            <Input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") connectShell()
              }}
              placeholder={t("sh, bash, ash, or /bin/sh")}
            />
          </label>
          <Button type="button" size="sm" onClick={status === "connected" ? disconnectShell : connectShell} disabled={status === "connecting"}>
            {status === "connected" ? t("Disconnect") : t("Connect")}
          </Button>
          <Badge variant={status === "connected" ? "success" : status === "error" ? "danger" : "outline"}>{status}</Badge>
        </div>
        <div className="h-[60vh] min-h-[420px] overflow-hidden rounded-lg border bg-muted/30 p-2">
          <div ref={termRef} className="h-full" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PodAccessButtons({ pod }: { pod: PodSummary }) {
  if (!pod.metadata.namespace || !pod.metadata.name) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PodLogDialog pod={pod} />
      <PodShellDialog pod={pod} />
    </div>
  )
}

export function RelatedPodsCard({ title = "Related Pods", description, namespace, selector, selectors, podName, pods, className }: RelatedPodsCardProps) {
  const [items, setItems] = useState<PodSummary[]>(pods || [])
  const [loading, setLoading] = useState(!pods)
  const [error, setError] = useState("")
  const selectorValues = useMemo(
    () => (selectors && selectors.length > 0 ? selectors : selector ? [selector] : []).map(selectorText).filter(Boolean),
    [selector, selectors]
  )
  const load = useCallback(async () => {
    if (pods) {
      setItems(pods)
      setLoading(false)
      return
    }
    if (!namespace || (selectorValues.length === 0 && !podName)) return
    setLoading(true)
    setError("")
    try {
      if (podName) {
        const response = await apiFetch(`/api/v1/namespaces/${namespace}/pods/${podName}`)
        if (!response.ok) throw new Error(await response.text())
        setItems([await response.json()])
        return
      }

      let lastError = ""
      for (const nextSelector of selectorValues) {
        const response = await apiFetch(`/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(nextSelector)}`)
        if (!response.ok) {
          lastError = await response.text()
          continue
        }
        const data = await response.json()
        if ((data.items || []).length > 0) {
          setItems(data.items || [])
          return
        }
      }
      if (lastError) throw new Error(lastError)
      setItems([])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load related pods")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [namespace, podName, pods, selectorValues])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button size="sm" variant="ghost" onClick={load} className="gap-2" disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />{t("Refresh")}
        </Button>
      </header>
      {error ? (
        <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm break-words text-destructive">{error}</div>
      ) : loading ? (
        <div className="flex h-20 items-center justify-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <span className="text-sm text-muted-foreground">{t("Loading...")}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("No pods")}</div>
      ) : (
        <div className="divide-y">
          {items.map((pod) => (
            <div key={pod.metadata.uid || pod.metadata.name} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                <div className="min-w-0">
                  <Link to={`/kubernetes/workloads/pods/${pod.metadata.namespace}/${pod.metadata.name}`} className="font-medium hover:text-primary transition-colors">
                    {pod.metadata.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{pod.metadata.namespace}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusDot status={pod.status?.phase} />
                  {pod.status?.podIP && <span className="font-mono text-xs text-muted-foreground">{pod.status.podIP}</span>}
                </div>
                <div className="min-w-0 text-xs text-muted-foreground">
                  <div className="break-words">{pod.spec?.nodeName || "unscheduled"}</div>
                  <div className="break-words">{containersForPod(pod).map((item) => item.name).join(", ") || t("no containers")}</div>
                </div>
              </div>
              <PodAccessButtons pod={pod} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
