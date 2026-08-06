import { api } from "@/convex/_generated/api";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Copy, KeyRound, Loader2, Plus, ShieldAlert, Terminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, SectionTitle, fmtShortTime } from "./bits";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

export function ApiKeysTab() {
  const keys = useQuery(api.apiKeys.list);
  const createKey = useMutation(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<Id<"apiKeys"> | null>(null);
  const [copied, setCopied] = useState(false);

  const firstActive = (keys ?? []).find((k) => !k.revokedAt);

  async function handleCreate() {
    setCreating(true);
    try {
      const { secret } = await createKey({ name: keyName || undefined });
      setCreateOpen(false);
      setKeyName("");
      setRevealed({ name: keyName.trim() || "Default key", secret });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create key.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("Secret copied to clipboard.");
    } catch {
      toast.error("Clipboard unavailable — copy manually.");
    }
  }

  async function handleRevoke() {
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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionTitle kicker="API Key Platform" title="Keys" />
          <p className="mt-2 max-w-lg text-[13px] leading-6 text-muted-foreground">
            Keys authenticate gateway calls. Secrets are shown once and stored hashed at
            rest — if you lose one, revoke it and issue a replacement.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
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
            <span className="text-muted-foreground">$</span> curl https://api.atelier.dev/v1/text{" "}
            {"\\"}
            {"\n  "}  -H <span className="text-chart-2">"Authorization: Bearer{" "}
            <span className="underline decoration-dotted underline-offset-2">{firstActive.prefix}</span>
            {"…"}</span>{" "}
            {"\\"}
            {"\n  "}  -d <span className="text-chart-2">'{"{"}"prompt":"a quiet gallery at dawn"{"}"}'</span>
          </pre>
        </div>
      )}

      {/* key list */}
      {(keys ?? []).length === 0 ? (
        <EmptyState
          title="No keys yet"
          body="Create your first API key to start routing requests through the gateway. The full secret appears exactly once."
          actionLabel="Create a key"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {(keys ?? []).map((k) => {
            const active = !k.revokedAt;
            return (
              <div key={k.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
                    {k.name}
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                        active
                          ? "border-chart-2/50 bg-chart-2/10 text-chart-2"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {active ? "Active" : "Revoked"}
                    </span>
                  </p>
                  <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">{k.prefix}</p>
                </div>
                <div className="text-right text-[11.5px] text-muted-foreground">
                  <p>Created {fmtShortTime(k.createdAt)}</p>
                  <p>{k.lastUsedAt ? `Last used ${fmtShortTime(k.lastUsedAt)}` : "Never used"}</p>
                </div>
                {active ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border bg-background text-muted-foreground hover:text-destructive"
                    onClick={() => setRevoking(k.id)}
                  >
                    <ShieldAlert className="size-3.5" /> Revoke
                  </Button>
                ) : (
                  <span className="w-[74px] text-right font-mono text-[11px] text-muted-foreground/60">
                    revoked
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-lg border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-normal tracking-tight">
              Create an API key
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              Name the key so you can recognise it in the ledger. The secret will be shown
              once — right after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. production-server"
              className="border-border bg-background"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="mt-2">
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              Generate secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* one-time reveal */}
      <Dialog open={revealed !== null} onOpenChange={(o) => !o && setRevealed(null)}>
        <DialogContent className="rounded-lg border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-normal tracking-tight">
              Your secret — copy it now
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              <span className="font-medium text-foreground">{revealed?.name}</span> · shown
              exactly once, then stored as a hash.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background p-3">
            <KeyRound className="size-4 shrink-0 text-chart-1" />
            <code className="scrollbar-thin min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-foreground">
              {revealed?.secret}
            </code>
          </div>
          <DialogFooter className="mt-2">
            <Button
              onClick={() => revealed && void handleCopy(revealed.secret)}
              className={cn(
                "gap-2",
                copied
                  ? "bg-chart-2 text-white hover:bg-chart-2/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <Copy className="size-4" />
              {copied ? "Copied" : "Copy secret"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* revoke confirm */}
      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent className="rounded-lg border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-normal tracking-tight">
              Revoke this key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              Requests that authenticate with this key will be rejected immediately. This
              cannot be undone — issue a new key if you need access again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-background">Keep key</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRevoke()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
