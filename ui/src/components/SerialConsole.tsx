import { useState, useEffect, useRef } from "react";
import { RefreshCw, Maximize2, Minimize2, AlertCircle } from "lucide-react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { cn } from "@/lib/utils";
import "xterm/css/xterm.css";

export function SerialConsole({ namespace, name }: { namespace: string, name: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [connStatus, setConnStatus] = useState<"connecting" | "connected" | "error" | "closed">("connecting");

  const syncSize = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current && fitAddonRef.current) {
      fitAddonRef.current.fit();
      const term = xtermRef.current;
      wsRef.current.send(`\x15export TERM=xterm-256color LANG=C.UTF-8; stty cols ${term.cols} rows ${term.rows}\r`);
      term.focus();
    }
  };

  useEffect(() => {
    if (!termRef.current) return;
    const term = new XTerm({ cursorBlink: true, fontSize: 14, fontFamily: "var(--font-mono)", theme: { background: "transparent" }, convertEol: true, scrollback: 10000 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ctx = localStorage.getItem("kube-context") || "";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/ws?namespace=${namespace}&vmi=${name}&type=serial&context=${ctx}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => { setConnStatus("connected"); term.clear(); term.focus(); };
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) term.write(new TextDecoder().decode(e.data));
      else if (typeof e.data === "string" && e.data.startsWith("console error")) setConnStatus("error");
    };
    ws.onclose = () => setConnStatus("closed");
    ws.onerror = () => setConnStatus("error");

    term.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
    
    // Enable automatic copy-on-select
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);
    return () => { ws.close(); term.dispose(); window.removeEventListener("resize", handleResize); };
  }, [namespace, name]);

  return (
    <div className={cn("bg-card shadow-2xl overflow-hidden flex flex-col transition-all duration-300 relative", isTheaterMode ? "fixed inset-0 z-[100] h-screen w-screen rounded-none" : "rounded-lg border h-[calc(100vh-280px)] min-h-[600px] w-full")}>
      <div className="flex items-center justify-between gap-2 bg-muted/50 border-b p-3 px-5">
         <div className="flex items-center gap-3">
            <div className={cn("w-2.5 h-2.5 rounded-full", connStatus === "connected" ? "bg-green-600" : connStatus === "error" ? "bg-destructive" : "bg-muted-foreground")} />
            <div className="flex flex-col">
               <span className="text-[10px] font-semibold text-muted-foreground">{connStatus === "connected" ? "Serial console active" : "Offline"}</span>
               {connStatus === "connected" && (
                 <div className="flex items-center gap-1.5 text-primary animate-in slide-in-from-top-1">
                    <AlertCircle size={10} />
                    <span className="text-[9px] font-bold text-primary">选中文字自动复制</span>
                 </div>
               )}
            </div>
         </div>
         <div className="flex gap-2">
            <button onClick={syncSize} className="flex items-center gap-2 px-3 py-1 bg-background hover:bg-muted/50 text-foreground rounded-md text-[10px] font-bold transition-all border active:scale-95"><RefreshCw size={12} /> Sync Size</button>
            <button onClick={() => setIsTheaterMode(!isTheaterMode)} className="flex items-center gap-2 px-3 py-1 bg-background hover:bg-muted/50 text-foreground rounded-md text-[10px] font-bold transition-all border">{isTheaterMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {isTheaterMode ? "Exit" : "Theater"}</button>
         </div>
      </div>
      <div ref={termRef} className="flex-1 p-2" />
    </div>
  );
}
