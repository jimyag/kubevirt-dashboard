import { useState, useEffect, useRef } from "react";
import { Maximize2, Minimize2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import RFB from "../vendor/novnc.all.js";

type RfbClient = {
  scaleViewport: boolean;
  resizeSession: boolean;
  focusOnClick: boolean;
  sendCtrlAltDel: () => void;
  disconnect: () => void;
  addEventListener: (type: "connect" | "disconnect", listener: (event: Event & { detail?: { clean?: boolean } }) => void) => void;
}

type RfbConstructor = new (target: HTMLElement, url: string, options?: { wsProtocols?: string[] }) => RfbClient;

export function VncConsole({ namespace, name }: { namespace: string, name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbClient | null>(null);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [showCADModal, setShowCADModal] = useState(false);

  const toggleTheaterMode = () => setIsTheaterMode(!isTheaterMode);
  const sendCAD = () => { rfbRef.current?.sendCtrlAltDel(); setShowCADModal(false); };

  useEffect(() => {
    if (isTheaterMode) {
      const hE = (e: KeyboardEvent) => { if (e.key === "Escape") setIsTheaterMode(false); };
      window.addEventListener("keydown", hE); return () => window.removeEventListener("keydown", hE);
    }
  }, [isTheaterMode]);

  useEffect(() => {
    if (!containerRef.current) return;
    let rfb: RfbClient | null = null;
    const startVnc = () => {
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ctx = localStorage.getItem("kube-context") || "";
        const wsUrl = `${protocol}//${window.location.host}/api/v1/ws?namespace=${namespace}&vmi=${name}&type=vnc&context=${ctx}`;
        setStatus("connecting");
        const moduleValue = RFB as { default?: unknown };
        const RFBC = (moduleValue.default || RFB) as RfbConstructor;
        if (typeof RFBC !== "function") { setErrorMsg("VNC 引擎载入失败：找不到有效的构造函数。"); setStatus("error"); return; }
        rfb = new RFBC(containerRef.current!, wsUrl, { wsProtocols: ["binary"] });
        rfb.scaleViewport = true; rfb.resizeSession = true; rfb.focusOnClick = true;
        rfb.addEventListener("connect", () => setStatus("connected"));
        rfb.addEventListener("disconnect", (e) => { setStatus("disconnected"); if (e.detail && e.detail.clean === false) { setStatus("error"); setErrorMsg("VNC 连接异常中断"); } });
        rfbRef.current = rfb;
      } catch (e) { setStatus("error"); setErrorMsg(e instanceof Error ? e.message : "本地 VNC 引擎初始化失败"); }
    };
    startVnc(); return () => { if (rfb) rfb.disconnect(); };
  }, [namespace, name]);

  return (
    <div className={cn("bg-card shadow-2xl overflow-hidden flex flex-col transition-all duration-300 relative", isTheaterMode ? "fixed inset-0 z-[100] h-screen w-screen rounded-none" : "rounded-lg border h-[calc(100vh-280px)] min-h-[600px] w-full")}>
      <div className="flex items-center justify-between gap-2 bg-muted/50 border-b p-3 px-5">
         <div className="flex items-center gap-3">
            <div className={cn("w-2.5 h-2.5 rounded-full", status === "connected" ? "bg-green-600" : status === "error" ? "bg-destructive" : "bg-muted-foreground")} />
            <span className="text-[10px] font-semibold text-muted-foreground">{status === "connected" ? (isTheaterMode ? `VNC: ${namespace}/${name}` : "VNC session active") : status === "error" ? "Connection error" : "Initializing VNC..."}</span>
         </div>
         {status === "connected" && (
           <div className="flex gap-2">
              <button onClick={() => setShowCADModal(true)} className="flex items-center gap-2 px-3 py-1 bg-destructive/10 hover:bg-destructive text-destructive hover:text-primary-foreground rounded-md text-[10px] font-bold transition-all border border-destructive/30 shadow-sm active:scale-95"><ShieldAlert size={12} /> Ctrl+Alt+Del</button>
              <button onClick={toggleTheaterMode} className="flex items-center gap-2 px-3 py-1 bg-background hover:bg-muted/50 text-foreground rounded-md text-[10px] font-bold transition-all border shadow-sm">{isTheaterMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {isTheaterMode ? "Exit" : "Theater"}</button>
           </div>
         )}
      </div>
      <div ref={containerRef} className="flex-1 bg-background flex items-center justify-center overflow-auto pointer-events-auto" />
      {status === "error" && (
        <div className="absolute inset-0 top-12 bg-background/90 backdrop-blur-sm flex items-center justify-center p-8 z-10 text-center">
           <div className="max-w-md space-y-4">
              <div className="bg-destructive/10 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
                 <ShieldAlert className="text-destructive" size={32} />
              </div>
              <h3 className="text-foreground font-semibold text-sm">VNC 连接失败</h3>
              <p className="text-muted-foreground text-xs font-medium leading-relaxed">{errorMsg || "无法建立 VNC 握手。"}</p>
              <button onClick={() => window.location.reload()} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-[10px] font-semibold hover:bg-primary/90 transition-all">重试</button>
           </div>
        </div>
      )}
      {showCADModal && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center p-4 bg-background/60 backdrop-blur-md">
           <div className="bg-card rounded-lg shadow-2xl border max-w-sm w-full p-8 animate-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center space-y-4">
                 <div className="bg-destructive/10 p-4 rounded-full"><ShieldAlert className="text-destructive" size={32} /></div>
                 <h3 className="text-lg font-semibold text-foreground">确认发送指令？</h3>
                 <p className="text-muted-foreground text-xs font-medium leading-relaxed">发送 Ctrl+Alt+Del 可能会导致虚拟机重启。请确认已保存所有工作。</p>
                 <div className="flex flex-col w-full gap-3 pt-4">
                    <button onClick={sendCAD} className="w-full py-3 bg-destructive hover:bg-destructive/90 text-primary-foreground rounded-lg text-[11px] font-semibold transition-all shadow-lg active:scale-95">确认发送</button>
                    <button onClick={() => setShowCADModal(false)} className="w-full py-3 bg-muted hover:bg-muted/50 text-foreground rounded-lg text-[11px] font-semibold transition-all active:scale-95">取消操作</button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
