import { useState, useEffect, useRef } from "react";
import { Maximize2, Minimize2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import RFB from "../vendor/novnc.all.js";
import { t } from "@/lib/i18n";
import { ConfirmDialog } from "./console";

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
        if (typeof RFBC !== "function") { setErrorMsg("Could not load the VNC engine."); setStatus("error"); return; }
        rfb = new RFBC(containerRef.current!, wsUrl, { wsProtocols: ["binary"] });
        rfb.scaleViewport = true; rfb.resizeSession = true; rfb.focusOnClick = true;
        rfb.addEventListener("connect", () => setStatus("connected"));
        rfb.addEventListener("disconnect", (e) => { setStatus("disconnected"); if (e.detail && e.detail.clean === false) { setStatus("error"); setErrorMsg("The VNC connection was interrupted."); } });
        rfbRef.current = rfb;
      } catch (e) { setStatus("error"); setErrorMsg(e instanceof Error ? e.message : "Could not initialize the VNC engine."); }
    };
    startVnc(); return () => { if (rfb) rfb.disconnect(); };
  }, [namespace, name]);

  return (
    <div className={cn("bg-card shadow-2xl overflow-hidden flex flex-col transition-all duration-300 relative", isTheaterMode ? "fixed inset-0 z-[100] h-screen w-screen rounded-none" : "rounded-lg border h-[calc(100vh-280px)] min-h-[600px] w-full")}>
      <div className="flex items-center justify-between gap-2 bg-muted/50 border-b p-3 px-5">
         <div className="flex items-center gap-3">
            <div className={cn("w-2.5 h-2.5 rounded-full", status === "connected" ? "bg-green-600" : status === "error" ? "bg-destructive" : "bg-muted-foreground")} />
            <span className="text-[10px] font-semibold text-muted-foreground">{status === "connected" ? (isTheaterMode ? `VNC: ${namespace}/${name}` : t("VNC session active")) : status === "error" ? t("Connection error") : status === "disconnected" ? t("Offline") : t("Initializing VNC...")}</span>
         </div>
         {status === "connected" && (
           <div className="flex gap-2">
              <button onClick={() => setShowCADModal(true)} className="flex items-center gap-2 px-3 py-1 bg-destructive/10 hover:bg-destructive text-destructive hover:text-primary-foreground rounded-md text-[10px] font-bold transition-all border border-destructive/30 shadow-sm active:scale-95"><ShieldAlert size={12} /> {t("Ctrl+Alt+Del")}</button>
              <button onClick={toggleTheaterMode} className="flex items-center gap-2 px-3 py-1 bg-background hover:bg-muted/50 text-foreground rounded-md text-[10px] font-bold transition-all border shadow-sm">{isTheaterMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {isTheaterMode ? t("Exit") : t("Theater")}</button>
           </div>
         )}
      </div>
      <div ref={containerRef} className="flex-1 bg-background flex items-center justify-center overflow-auto pointer-events-auto" />
      {(status === "error" || status === "disconnected") && (
        <div className="absolute inset-0 top-12 bg-background/90 backdrop-blur-sm flex items-center justify-center p-8 z-10 text-center">
           <div className="max-w-md space-y-4">
              <div className="bg-destructive/10 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
                 <ShieldAlert className="text-destructive" size={32} />
              </div>
              <h3 className="text-foreground font-semibold text-sm">{t("VNC connection failed")}</h3>
              <p className="text-muted-foreground text-xs font-medium leading-relaxed">{errorMsg ? t(errorMsg) : t("Could not complete the VNC handshake.")}</p>
              <button onClick={() => window.location.reload()} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-[10px] font-semibold hover:bg-primary/90 transition-all">{t("Retry")}</button>
           </div>
        </div>
      )}
      <ConfirmDialog
        open={showCADModal}
        onOpenChange={setShowCADModal}
        title={t("Send Ctrl+Alt+Del?")}
        description={t("Sending Ctrl+Alt+Del may restart the VM. Make sure all work is saved.")}
        confirmLabel={t("Send")}
        onConfirm={sendCAD}
        destructive
      />
    </div>
  );
}
