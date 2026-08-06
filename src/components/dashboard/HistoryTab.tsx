import { api } from "@/convex/_generated/api";
import {
  KIND_META,
  type GatewayKind,
  type RequestStatus,
} from "@/convex/catalog";
import { useQuery } from "convex/react";
import { ChevronDown, Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KindTag, SectionTitle, StatusBadge, fmtMs, fmtTime, kindLabel, providerLabel } from "./bits";
import { cn } from "@/lib/utils";

const KINDS = Object.keys(KIND_META) as GatewayKind[];

export function HistoryTab() {
  const requests = useQuery(api.gateway.list, { limit: 80 });
  const [status, setStatus] = useState<"all" | RequestStatus>("all");
  const [kind, setKind] = useState<"all" | GatewayKind>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return (requests ?? []).filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (kind === "all" || r.kind === kind),
    );
  }, [requests, status, kind]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle kicker="History" title="Request ledger" />
        <div className="flex gap-3">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-36 border-border bg-card text-[12.5px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-40 border-border bg-card text-[12.5px]">
              <SelectValue placeholder="Route" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All routes</SelectItem>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_META[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-8 py-16 text-center">
          <Inbox className="size-8 text-muted-foreground/50" />
          <p className="mt-4 font-display text-lg font-normal tracking-tight">No requests match</p>
          <p className="mt-1.5 max-w-sm text-[13px] leading-6 text-muted-foreground">
            Adjust the filters, or send a request from the Gateway tab to populate the ledger.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 pl-5 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Time
                </TableHead>
                <TableHead className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Route
                </TableHead>
                <TableHead className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Provider / model
                </TableHead>
                <TableHead className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="text-right text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Cost
                </TableHead>
                <TableHead className="text-right text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Latency
                </TableHead>
                <TableHead className="w-10 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const open = expanded === r._id;
                return (
                  <TableRow
                    key={r._id}
                    className={cn("cursor-pointer transition-colors", open && "bg-accent/30")}
                    onClick={() => setExpanded(open ? null : r._id)}
                  >
                    <TableCell className="pl-5 font-mono text-[11.5px] text-muted-foreground">
                      {fmtTime(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <KindTag kind={r.kind} />
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-foreground/85">
                      {providerLabel(r.provider)}
                      <span className="text-muted-foreground">/</span>
                      {r.model}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] text-foreground/85">
                      {r.credits} cr
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] text-muted-foreground">
                      {fmtMs(r.latencyMs)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <ChevronDown
                        className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* expanded detail */}
      {expanded &&
        (() => {
          const r = (requests ?? []).find((x) => x._id === expanded);
          if (!r) return null;
          return (
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-display text-lg font-normal tracking-tight">
                  {kindLabel(r.kind)} · {providerLabel(r.provider)}/{r.model}
                </h3>
                <StatusBadge status={r.status} />
                <span className="font-mono text-[11px] text-muted-foreground">{fmtTime(r.createdAt)}</span>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Prompt
                  </p>
                  <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3.5 font-mono text-[11.5px] leading-5 text-foreground/85">
                    {r.prompt}
                  </pre>
                </div>
                <div>
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Response
                  </p>
                  {r.responseText ? (
                    <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3.5 font-mono text-[11.5px] leading-5 text-foreground/85">
                      {r.responseText}
                    </pre>
                  ) : (
                    <p className="mt-2 rounded-md border border-dashed border-border p-3.5 text-[12px] text-muted-foreground">
                      {r.status === "completed" ? "No response payload." : "Still in flight — check back in a moment."}
                    </p>
                  )}
                  {r.imageUrl && (
                    <img
                      src={r.imageUrl}
                      alt={r.imageName ?? "input image"}
                      className="mt-3 max-h-36 rounded border border-border object-contain"
                    />
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-border/70 pt-4 text-[11.5px] text-muted-foreground">
                <span>Cost <span className="font-mono text-foreground">{r.credits} cr</span></span>
                <span>Latency <span className="font-mono text-foreground">{fmtMs(r.latencyMs)}</span></span>
                <span>Via key <span className="font-mono text-foreground">{r.apiKeyId ? "attached" : "auto"}</span></span>
                <span>ID <span className="font-mono text-foreground/70">{r._id}</span></span>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
