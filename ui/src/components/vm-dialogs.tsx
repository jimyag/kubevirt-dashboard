import { useEffect, useState } from "react";
import {
  Check,
  Copy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/console";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import { apiFetch } from "@/lib/vm-pages";

export function StatusBadge({ status }: { status?: string }) {
  return <StatusDot status={status} />;
}

export function CopyableText({ text, label }: { text: string, label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="group relative flex flex-col gap-1 w-full bg-muted/30 p-2.5 rounded-lg border hover:border-border transition-all">
      {label && <div className="text-[9px] font-medium text-muted-foreground">{label}</div>}
      <div className="flex items-start justify-between gap-4">
        <div className="text-[11px] font-mono text-foreground break-all leading-relaxed flex-1">{text}</div>
        <button onClick={onCopy} className="p-1 hover:bg-background rounded-lg border border-transparent hover:border-border transition-all text-muted-foreground hover:text-foreground shrink-0 mt-0.5">
          {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

export type VmDialogField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea";
  defaultValue: string;
  options?: Array<{ label: string; value: string }>;
};

export function VmActionDialog({
  label,
  description,
  fields,
  buildRequest,
  onDone,
  variant = "outline",
  open: controlledOpen,
  onOpenChange,
}: {
  label: string;
  description: string;
  fields: VmDialogField[];
  buildRequest: (values: Record<string, string>) => { url: string; options: RequestInit };
  onDone: () => void;
  variant?: "default" | "outline" | "destructive" | "secondary";
  /** When provided, the dialog is controlled and renders no trigger button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setUncontrolledOpen(next));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, field.defaultValue])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) setValues(Object.fromEntries(fields.map((field) => [field.name, field.defaultValue])));
  }, [fields, open]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const request = buildRequest(values);
      const res = await apiFetch(request.url, request.options);
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button size="sm" variant={variant}>{label}</Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{t(field.label)}</span>
              {field.type === "textarea" ? (
                <textarea
                  value={values[field.name] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="min-h-28 rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : field.type === "select" ? (
                <select
                  value={values[field.name] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {(field.options || []).map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                </select>
              ) : (
                <Input
                  type={field.type === "number" ? "number" : "text"}
                  value={values[field.name] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
          <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={submit} disabled={saving}>{saving ? t("Applying...") : t("Apply")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Views ---
