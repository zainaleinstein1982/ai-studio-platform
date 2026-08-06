import { api } from "@/convex/_generated/api";
import { KEY_SCOPES, isKeyActive, scopeLabel } from "@/convex/keyPolicy";
import { useMutation, useQuery } from "convex/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { EmptyState, SectionTitle, fmtShortTime } from "./bits";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import type { Id } from "@/convex/_generated/dataModel";

interface KeyRow {
  id: Id<"apiKeys">;
  name: string;
  prefix: string;
  scopes?: string[];
  dailyLimit?: number;
  monthlyLimit?: number;
  quota?: number;
  expiresAt?: number;
  webhookSet: boolean;
  webhookPrefix?: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

interface KeyForm {
  name: string;
  scopes: string[];
  dailyLimit: string;
  monthlyLimit: string;
  quota: string;
  expiresAt: string; // yyyy-mm-dd
}

const EMPTY_FORM: KeyForm = {
  name: "",
  scopes: [...KEY_SCOPES],
  dailyLimit: "",
  monthlyLimit: "",
  quota: "",
  expiresAt: "",
};

const AUDIT_LABELS: Record<string, string> = {
  "key.created": "Key created",
  "key.updated": "Key policy updated",
  "key.rotated": "Key rotated",
  "key.revoked": "Key revoked",
  "key.expired": "Key expired",
  "webhook.regenerated": "Webhook secret regenerated",
  "role.changed": "Role changed",
  "org.created": "Organization created",
  "org.member_invited": "Member invited",
  "org.member_removed": "Member removed",
};

function toNumber(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function dateToTs(v: string): number | undefined {
  if (!v) return undefined;
  const ts = new Date(`${v}T00:00:00`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

/* ------------------------------------------------------------------ */
/* Key form dialog (create + edit)                                     */
/* ------------------------------------------------------------------ */

function KeyFormDialog({
  open,
  onOpenChange,
  title,
  initial,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial: KeyForm;
  submitting: boolean;
  onSubmit: (form: KeyForm) => void;
}) {
  // Note: callers pass a `key` prop so the dialog remounts (and resets state)
  // whenever `initial` changes between open sessions.
  const [form, setForm] = useState<KeyForm>(initial);

  const set = (patch: Partial<KeyForm>) => setForm((f) => ({ ...f, ...patch }));

  const toggleScope = (scope: string, checked: boolean) =>
    set({
      scopes: checked ? [...form.scopes, scope] : form.scopes.filter((s) => s !== scope),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-thin max-h-[90vh] overflow-y-auto rounded-lg border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-normal tracking-tight">{title}</DialogTitle>
          <DialogDescription className="text-[13px]">
            Scopes grant routes; limits cap usage. The secret is shown once after saving.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-5">
          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Name
            </Label>
            <Input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. production-server"
              className="mt-2 border-border bg-background"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Scopes · routes this key may call
            </Label>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {KEY_SCOPES.map((s) => (
                <label
                  key={s}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[12.5px] transition-colors",
                    form.scopes.includes(s)
                      ? "border-foreground/25 bg-accent/50"
                      : "border-border bg-background hover:border-foreground/20",
                  )}
                >
                  <Checkbox
                    checked={form.scopes.includes(s)}
                    onCheckedChange={(c) => toggleScope(s, Boolean(c))}
                  />
                  <span className="truncate">{scopeLabel(s)}</span>
                </label>
              ))}
            </div>
            {form.scopes.length === 0 && (
              <p className="mt-1.5 text-[11.5px] text-destructive">Grant at least one scope.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Daily limit
              </Label>
              <Input
                type="number"
                min={1}
                value={form.dailyLimit}
                onChange={(e) => set({ dailyLimit: e.target.value })}
                placeholder="—"
                className="mt-2 border-border bg-background"
              />
            </div>
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Monthly
              </Label>
              <Input
                type="number"
                min={1}
                value={form.monthlyLimit}
                onChange={(e) => set({ monthlyLimit: e.target.value })}
                placeholder="—"
                className="mt-2 border-border bg-background"
              />
            </div>
            <div>
              <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Credit quota
              </Label>
              <Input
                type="number"
                min={1}
                value={form.quota}
                onChange={(e) => set({ quota: e.target.value })}
                placeholder="—"
                className="mt-2 border-border bg-background"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Expiration
            </Label>
            <Input
              type="date"
              value={form.expiresAt}
              onChange={(e) => set({ expiresAt: e.target.value })}
              className="mt-2 border-border bg-background"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            disabled={submitting || form.scopes.length === 0}
            onClick={() => onSubmit(form)}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Save key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* One-time reveal                                                     */
/* ------------------------------------------------------------------ */

function RevealDialog({
  label,
  secret,
  onClose,
}: {
  label: string;
  secret: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Clipboard unavailable — copy manually.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-lg border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-normal tracking-tight">
            {label} — copy it now
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Shown exactly once, then stored as a sha-256 hash.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background p-3">
          <KeyRound className="size-4 shrink-0 text-chart-1" />
          <code className="scrollbar-thin min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px]">
            {secret}
          </code>
        </div>
        <DialogFooter className="mt-2">
          <Button
            onClick={() => void copy()}
            className={cn(
              "gap-2",
              copied ? "bg-chart-2 text-white hover:bg-chart-2/90" : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Copy className="size-4" />
            {copied ? "Copied" : "Copy secret"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Key row + expanded detail                                           */
/* ------------------------------------------------------------------ */

function KeyRowCard({
  row,
  now,
  expanded,
  onToggle,
  onEdit,
  onRotate,
  onRevoke,
  onWebhook,
}: {
  row: KeyRow;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onWebhook: () => void;
}) {
  const detail = useQuery(api.apiKeys.detail, expanded ? { id: row.id } : "skip");
  const active = isKeyActive(row, now);
  const scopes = row.scopes ?? [];
  const usage = detail?.usage;

  return (
    <div className="border-b border-border/70 last:border-b-0">
      {/* header row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
            {row.name}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                !active
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-chart-2/50 bg-chart-2/10 text-chart-2",
              )}
            >
              {!active ? (row.revokedAt ? "Revoked" : "Expired") : "Active"}
            </span>
          </p>
          <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">{row.prefix}</p>
        </button>

        {/* scope chips */}
        <div className="hidden max-w-56 flex-wrap gap-1 md:flex">
          {scopes.length > 4 ? (
            <>
              {scopes.slice(0, 4).map((s) => (
                <ScopeChip key={s} scope={s} />
              ))}
              <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                +{scopes.length - 4}
              </span>
            </>
          ) : (
            scopes.map((s) => <ScopeChip key={s} scope={s} />)
          )}
        </div>

        <div className="text-right text-[11.5px] text-muted-foreground">
          <p>Created {fmtShortTime(row.createdAt)}</p>
          <p>{row.lastUsedAt ? `Used ${formatDistanceToNow(row.lastUsedAt, { addSuffix: true })}` : "Never used"}</p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onEdit} title="Edit policy">
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onRotate} title="Rotate key">
            <KeyRound className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRevoke}
            title="Revoke key"
          >
            <ShieldAlert className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onToggle} title="Usage & webhooks">
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </div>

      {/* expanded detail */}
      {expanded && (
        <div className="grid gap-5 border-t border-border/60 bg-card-foreground/[0.015] px-5 py-5 md:grid-cols-2">
          {/* usage */}
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Usage statistics
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                ["Requests", usage?.totalRequests ?? "—"],
                ["Completed", usage?.completedRequests ?? "—"],
                ["Credits", usage?.creditsTotal ?? "—"],
                ["Today", usage?.dailyUsed ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-border bg-background p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="mt-1 font-display text-lg font-light text-chart-1">{v}</p>
                </div>
              ))}
            </div>

            {/* 7-day chart */}
            <div className="mt-3 h-28">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usage?.byDay ?? []} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "oklch(0.52 0.016 75)" }} />
                  <Tooltip
                    cursor={{ fill: "oklch(0.92 0.015 84 / 0.5)" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid oklch(0.885 0.011 85)",
                      background: "oklch(0.992 0.004 90)",
                      fontSize: 11,
                      fontFamily: "Inter, sans-serif",
                    }}
                    formatter={(value: number | string) => [`${value} requests`, "Calls"]}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="oklch(0.585 0.075 55)" maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* limit meters */}
            <div className="mt-3 space-y-2.5">
              {row.dailyLimit != null && (
                <LimitMeter label="Daily" used={usage?.dailyUsed ?? 0} limit={row.dailyLimit} />
              )}
              {row.monthlyLimit != null && (
                <LimitMeter label="Monthly" used={usage?.monthlyUsed ?? 0} limit={row.monthlyLimit} />
              )}
              {row.quota != null && (
                <LimitMeter label="Credit quota" used={usage?.quotaUsed ?? 0} limit={row.quota} />
              )}
              {!row.dailyLimit && !row.monthlyLimit && !row.quota && (
                <p className="text-[11.5px] text-muted-foreground">No limits set — unlimited usage.</p>
              )}
            </div>
          </div>

          {/* policy + webhook */}
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Policy
            </p>
            <dl className="mt-3 space-y-1.5 font-mono text-[11.5px] text-muted-foreground">
              <PolicyRow label="Scopes" value={scopes.length ? scopes.map(scopeLabel).join(" · ") : "all routes"} />
              <PolicyRow label="Daily limit" value={row.dailyLimit ? String(row.dailyLimit) : "unlimited"} />
              <PolicyRow label="Monthly limit" value={row.monthlyLimit ? String(row.monthlyLimit) : "unlimited"} />
              <PolicyRow label="Credit quota" value={row.quota ? String(row.quota) : "unlimited"} />
              <PolicyRow
                label="Expires"
                value={row.expiresAt ? fmtShortTime(row.expiresAt) : "never"}
              />
            </dl>

            {/* webhook */}
            <div className="mt-4 rounded-md border border-border bg-background p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Webhook className="size-4 text-chart-1" />
                  <div>
                    <p className="text-[12.5px] font-medium text-foreground">Webhook secret</p>
                    <p className="font-mono text-[10.5px] text-muted-foreground">
                      {row.webhookSet ? row.webhookPrefix : "not set — used to sign event payloads"}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border bg-card text-foreground"
                  onClick={onWebhook}
                >
                  {row.webhookSet ? "Regenerate" : "Generate"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeChip({ scope }: { scope: string }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] text-muted-foreground">
      {scopeLabel(scope)}
    </span>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right text-foreground/80">{value}</dd>
    </div>
  );
}

function LimitMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">
          {used}/{limit}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          "mt-1 h-1.5 bg-muted [&>div]:transition-all",
          pct >= 100 ? "[&>div]:bg-destructive" : pct >= 80 ? "[&>div]:bg-chart-5" : "[&>div]:bg-chart-2",
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main tab                                                            */
/* ------------------------------------------------------------------ */

export function ApiKeysTab() {
  const keys = useQuery(api.apiKeys.list);
  const audit = useQuery(api.audit.list, { limit: 30 });
  const createKey = useMutation(api.apiKeys.create);
  const updateKey = useMutation(api.apiKeys.update);
  const rotateKey = useMutation(api.apiKeys.rotate);
  const revokeKey = useMutation(api.apiKeys.revoke);
  const regenWebhook = useMutation(api.apiKeys.regenerateWebhookSecret);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<KeyRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState<{ label: string; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<Id<"apiKeys"> | null>(null);
  const [rotating, setRotating] = useState<Id<"apiKeys"> | null>(null);
  const [webhookTarget, setWebhookTarget] = useState<Id<"apiKeys"> | null>(null);
  const [expandedId, setExpandedId] = useState<Id<"apiKeys"> | null>(null);

  const rows: KeyRow[] = keys ?? [];
  const now = useNow();
  const firstActive = rows.find((k) => isKeyActive(k, now));

  function rowToForm(row: KeyRow): KeyForm {
    return {
      name: row.name,
      scopes: row.scopes && row.scopes.length ? row.scopes : [...KEY_SCOPES],
      dailyLimit: row.dailyLimit ? String(row.dailyLimit) : "",
      monthlyLimit: row.monthlyLimit ? String(row.monthlyLimit) : "",
      quota: row.quota ? String(row.quota) : "",
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString().slice(0, 10) : "",
    };
  }

  async function handleCreate(form: KeyForm) {
    setSubmitting(true);
    try {
      const { secret } = await createKey({
        name: form.name || undefined,
        scopes: form.scopes,
        dailyLimit: toNumber(form.dailyLimit),
        monthlyLimit: toNumber(form.monthlyLimit),
        quota: toNumber(form.quota),
        expiresAt: dateToTs(form.expiresAt),
      });
      setFormOpen(false);
      setRevealed({ label: form.name.trim() || "Your new API key", secret });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(form: KeyForm) {
    if (!editingRow) return;
    setSubmitting(true);
    try {
      await updateKey({
        id: editingRow.id,
        name: form.name || undefined,
        scopes: form.scopes,
        dailyLimit: toNumber(form.dailyLimit),
        monthlyLimit: toNumber(form.monthlyLimit),
        quota: toNumber(form.quota),
        expiresAt: dateToTs(form.expiresAt),
        clearExpiry: !form.expiresAt,
      });
      setEditingRow(null);
      toast.success("Key policy updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotateConfirm() {
    if (!rotating) return;
    try {
      const { secret } = await rotateKey({ id: rotating });
      setRotating(null);
      setRevealed({ label: "Rotated key secret", secret });
      toast.success("Old key revoked; a rotated key now inherits its policy.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rotate key.");
      setRotating(null);
    }
  }

  async function handleRevokeConfirm() {
    if (!revoking) return;
    try {
      await revokeKey({ id: revoking });
      toast.success("Key revoked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke key.");
    } finally {
      setRevoking(null);
    }
  }

  async function handleWebhook() {
    if (!webhookTarget) return;
    try {
      const { secret } = await regenWebhook({ id: webhookTarget });
      setWebhookTarget(null);
      setRevealed({ label: "Webhook signing secret", secret });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate webhook secret.");
      setWebhookTarget(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionTitle kicker="STEP 03 · API Key Platform" title="Keys" />
          <p className="mt-2 max-w-lg text-[13px] leading-6 text-muted-foreground">
            Keys are hashed at rest, scoped to routes, and capped by daily, monthly, and
            credit quotas. Every action lands in the audit log below.
          </p>
        </div>
        <Button
          onClick={() => setFormOpen(true)}
          className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" /> Create key
        </Button>
      </div>

      {/* curl hint */}
      {firstActive && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 bg-muted/50 px-4 py-2.5">
            <Terminal className="size-3.5 text-muted-foreground" />
            <span className="font-mono text-[11px] text-muted-foreground">
              quickstart · route through this key
            </span>
          </div>
          <pre className="scrollbar-thin overflow-x-auto px-4 py-3.5 font-mono text-[11.5px] leading-6 text-foreground/85">
            <span className="text-muted-foreground">$</span> curl https://api.atelier.dev/v1/text {"\\"}
            {"\n  "}  -H <span className="text-chart-2">"Authorization: Bearer <span className="underline decoration-dotted underline-offset-2">{firstActive.prefix}</span>…"</span> {"\\"}
            {"\n  "}  -d <span className="text-chart-2">'{"{"}"prompt":"a quiet gallery at dawn"{"}"}'</span>
          </pre>
        </div>
      )}

      {/* key list */}
      {rows.length === 0 ? (
        <EmptyState
          title="No keys yet"
          body="Create your first scoped API key. Choose which routes it may call, set daily / monthly / quota limits, and add an expiry."
          actionLabel="Create a key"
          onAction={() => setFormOpen(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((row) => (
            <KeyRowCard
              key={row.id}
              row={row}
              now={now}
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
              onEdit={() => setEditingRow(row)}
              onRotate={() => setRotating(row.id)}
              onRevoke={() => setRevoking(row.id)}
              onWebhook={() => setWebhookTarget(row.id)}
            />
          ))}
        </div>
      )}

      {/* audit log */}
      <div>
        <SectionTitle kicker="Audit Log" title="Security trail" />
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {(audit ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
              No audit events yet — key creation, rotation, revocation, and role changes
              will appear here.
            </p>
          ) : (
            <div className="divide-y divide-border/70">
              {(audit ?? []).map((a) => (
                <div key={a._id} className="flex items-center gap-3 px-5 py-3">
                  <span className="size-1.5 shrink-0 rounded-full bg-chart-1" />
                  <p className="min-w-0 flex-1 text-[12.5px]">
                    <span className="font-medium text-foreground">
                      {AUDIT_LABELS[a.action] ?? a.action}
                    </span>
                    {a.detail && <span className="ml-1.5 text-muted-foreground">· {a.detail}</span>}
                  </p>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                    {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* dialogs */}
      {formOpen && (
        <KeyFormDialog
          key="create"
          open={formOpen}
          onOpenChange={setFormOpen}
          title="Create an API key"
          initial={EMPTY_FORM}
          submitting={submitting}
          onSubmit={(f) => void handleCreate(f)}
        />
      )}
      {editingRow && (
        <KeyFormDialog
          key={editingRow.id}
          open={Boolean(editingRow)}
          onOpenChange={(o) => !o && setEditingRow(null)}
          title={`Edit · ${editingRow.name}`}
          initial={rowToForm(editingRow)}
          submitting={submitting}
          onSubmit={(f) => void handleUpdate(f)}
        />
      )}
      {revealed && (
        <RevealDialog label={revealed.label} secret={revealed.secret} onClose={() => setRevealed(null)} />
      )}

      <AlertDialog open={rotating !== null} onOpenChange={(o) => !o && setRotating(null)}>
        <AlertDialogContent className="rounded-lg border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-normal tracking-tight">
              Rotate this key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              The current secret is revoked immediately and a new key is issued with the
              same scopes, limits, and expiry. You'll see the new secret once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-background">Keep key</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRotateConfirm()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Rotate key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent className="rounded-lg border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-normal tracking-tight">
              Revoke this key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              Requests that authenticate with this key will be rejected immediately. This
              cannot be undone — rotate instead if you need a replacement secret.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-background">Keep key</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRevokeConfirm()} className="bg-destructive text-white hover:bg-destructive/90">
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={webhookTarget !== null} onOpenChange={(o) => !o && setWebhookTarget(null)}>
        <AlertDialogContent className="rounded-lg border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-normal tracking-tight">
              {rows.find((r) => r.id === webhookTarget)?.webhookSet
                ? "Regenerate webhook secret?"
                : "Generate webhook secret?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              The secret signs webhook payloads delivered for this key. The previous value
              stops working immediately. You'll see the new secret once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-background">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleWebhook()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
