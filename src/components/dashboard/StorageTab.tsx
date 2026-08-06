import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  Box,
  Check,
  Copy,
  Database,
  Eye,
  FileVideo,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SectionTitle, StatCard } from "./bits";
import { cn } from "@/lib/utils";
import type { CacheKind } from "@/convex/storage/core";

const KIND_META: Record<CacheKind, { label: string; icon: typeof Layers; cls: string }> = {
  image: { label: "Image cache", icon: ImageIcon, cls: "border-chart-3/40 bg-chart-3/10 text-chart-3" },
  video: { label: "Video cache", icon: FileVideo, cls: "border-chart-4/40 bg-chart-4/10 text-chart-4" },
  glb: { label: "GLB cache", icon: Box, cls: "border-chart-2/40 bg-chart-2/10 text-chart-2" },
  preview: { label: "Preview cache", icon: Eye, cls: "border-chart-5/40 bg-chart-5/10 text-chart-5" },
  other: { label: "Other", icon: Database, cls: "border-border bg-muted text-muted-foreground" },
};

const EXPIRY_OPTIONS = [
  { value: 3600, label: "1 hour" },
  { value: 43200, label: "12 hours" },
  { value: 86400, label: "24 hours" },
];

function fmtBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fmtTtl(ms: number): string {
  if (ms >= 86_400_000 * 30) return "30 days";
  if (ms >= 86_400_000 * 7) return "7 days";
  if (ms >= 86_400_000) return "1 day";
  return "24 h";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Clipboard unavailable");
  }
}

interface SignedResult {
  ok: boolean;
  url?: string;
  signedUrl?: string;
  expiresAt?: number;
  bucket?: string;
  key?: string;
  kind?: string;
  headers?: Record<string, string>;
}

export function StorageTab() {
  const overview = useQuery(api.storage.overview);
  const registerArtifacts = useMutation(api.storage.registerArtifacts);
  const registerObject = useMutation(api.storage.registerObject);
  const generateSignedUrl = useMutation(api.storage.generateSignedUrl);
  const warmCache = useMutation(api.storage.warmCache);
  const evictCache = useMutation(api.storage.evictCache);
  const evictExpiredCache = useMutation(api.storage.evictExpiredCache);

  const [expirySec, setExpirySec] = useState(3600);
  const [urlInput, setUrlInput] = useState("");
  const [signed, setSigned] = useState<SignedResult | null>(null);
  const [busy, setBusy] = useState<"sign" | "scan" | "warm" | "evict" | null>(null);

  /* ingest artifacts from every module on first open */
  useEffect(() => {
    void registerArtifacts()
      .then((res) => {
        if (res.added > 0) toast.success(`Storage scan — indexed ${res.added} new artifact${res.added > 1 ? "s" : ""}.`);
      })
      .catch(() => {});
  }, [registerArtifacts]);

  const handleSign = useCallback(
    async (url: string) => {
      setBusy("sign");
      try {
        const res = await generateSignedUrl({ url, expiresInSec: expirySec });
        setSigned(res);
        toast.success("Signed URL generated.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Signing failed");
      } finally {
        setBusy(null);
      }
    },
    [generateSignedUrl, expirySec],
  );

  const handleScan = useCallback(async () => {
    setBusy("scan");
    try {
      const res = await registerArtifacts();
      toast.success(`Storage scan complete — ${res.added} new object${res.added !== 1 ? "s" : ""} indexed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy(null);
    }
  }, [registerArtifacts]);

  const handleWarmAll = useCallback(async () => {
    if (!overview) return;
    setBusy("warm");
    try {
      let warmed = 0;
      for (const o of overview.objects.slice(0, 24)) {
        await warmCache({ url: o.url });
        warmed += 1;
      }
      toast.success(`Warmed ${warmed} object${warmed !== 1 ? "s" : ""} into the caches.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Warm failed");
    } finally {
      setBusy(null);
    }
  }, [overview, warmCache]);

  const handleEvictExpired = useCallback(async () => {
    setBusy("evict");
    try {
      const res = await evictExpiredCache();
      toast.success(`Evicted ${res.evicted} expired entr${res.evicted === 1 ? "y" : "ies"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eviction failed");
    } finally {
      setBusy(null);
    }
  }, [evictExpiredCache]);

  if (!overview) {
    return (
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[118px] animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  const cacheByKey = new Map(overview.cache.map((c) => [c.key, c]));

  return (
    <div className="space-y-6">
      {/* stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Objects registered" value={overview.totalObjects.toLocaleString()} sub="across all buckets" accent />
        <StatCard label="Cache entries" value={overview.cacheEntries.toLocaleString()} sub={`${overview.evicted} evicted`} />
        <StatCard label="Cache hits" value={overview.cacheHits.toLocaleString()} sub="warmed deliveries" />
        <StatCard label="Total size" value={fmtBytes(overview.totalBytes)} sub="simulated footprint" />
      </div>

      {/* signed URL generator */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="Signed URL"
          title="Issue a presigned CDN link"
          right={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-chart-2/40 bg-chart-2/10 px-2.5 py-1 text-[11px] text-chart-2">
              <ShieldCheck className="size-3" />
              HMAC-SHA256 signed
            </span>
          }
        />
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Object path
            </Label>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="s3://atelier-assets/3d/3d_abc.glb"
              className="mt-1.5 border-border bg-background font-mono text-[12px]"
            />
          </div>
          <div>
            <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Expires</Label>
            <Select value={String(expirySec)} onValueChange={(v) => setExpirySec(Number(v))}>
              <SelectTrigger className="mt-1.5 w-36 border-border bg-background text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => void handleSign(urlInput)}
            disabled={!urlInput.trim() || busy !== null}
            className="mt-1.5 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy === "sign" ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            Sign URL
          </Button>
        </div>

        {signed && signed.ok && signed.signedUrl && (
          <div className="mt-4 rounded-md border border-chart-1/25 bg-chart-1/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-chart-1">Presigned URL</p>
                <p className="mt-1.5 break-all font-mono text-[11px] leading-5 text-foreground/90">{signed.signedUrl}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyText(signed.signedUrl!)}
                className="shrink-0 border-border bg-background"
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-chart-1/15 pt-3 font-mono text-[10.5px] text-muted-foreground">
              <span>
                bucket <span className="text-foreground/85">{signed.bucket}</span>
              </span>
              <span>
                key <span className="text-foreground/85">{signed.key}</span>
              </span>
              <span>
                expires{" "}
                <span className="text-foreground/85">
                  {signed.expiresAt ? new Date(signed.expiresAt).toLocaleTimeString() : "—"}
                </span>
              </span>
              <span>
                Cache-Control <span className="text-foreground/85">{signed.headers?.["Cache-Control"]}</span>
              </span>
              <span>
                ETag <span className="text-foreground/85">{signed.headers?.ETag}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* buckets */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="S3-compatible buckets"
          title="MinIO-style object storage"
          right={
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-chart-2">
              <Globe className="size-3.5" />
              CDN ready · {overview.cdn.host}
            </span>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overview.buckets.map((b) => (
            <div key={b.name} className="rounded-md border border-border/70 bg-background p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-foreground">{b.label}</p>
                <span className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {b.name}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">{b.description}</p>
              <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
                <p className="font-mono text-[11.5px] text-foreground/85">
                  {b.count} obj · {fmtBytes(b.bytes)}
                </p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-chart-2/40 bg-chart-2/10 px-2 py-0.5 text-[10px] font-medium text-chart-2">
                  <Check className="size-2.5" /> CDN
                </span>
              </div>
              <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">{b.cdnPath}</p>
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {b.cacheControl} · ttl {fmtTtl(b.ttlMs)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* cache tiers */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="Cache tiers"
          title="Image · Video · GLB · Preview"
          right={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleWarmAll()}
                disabled={busy !== null || overview.objects.length === 0}
                className="border-border bg-background"
              >
                {busy === "warm" ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                Warm all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleEvictExpired()}
                disabled={busy !== null}
                className="border-border bg-background text-muted-foreground"
              >
                {busy === "evict" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Evict expired
              </Button>
            </div>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(KIND_META) as CacheKind[]).map((kind) => {
            const meta = KIND_META[kind];
            const stat = overview.cacheStats[kind] ?? { count: 0, hits: 0, bytes: 0, evicted: 0 };
            const Icon = meta.icon;
            return (
              <div key={kind} className="rounded-md border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium", meta.cls)}>
                    <Icon className="size-3" />
                    {meta.label}
                  </span>
                </div>
                <p className="mt-3 font-display text-2xl font-light tracking-tight text-foreground">
                  {stat.count}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {stat.hits} hits · {fmtBytes(stat.bytes)} · {stat.evicted} evicted
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-[11.5px] leading-5 text-muted-foreground">
          TTLs: images & previews 7 days · video & GLB 30 days. Expired entries are dropped by the eviction
          sweep; over-capacity tiers evict least-recently-used first.
        </p>
      </div>

      {/* object registry */}
      <div className="rounded-lg border border-border bg-card p-6">
        <SectionTitle
          kicker="Object registry"
          title="Indexed artifacts"
          right={
            <Button variant="outline" size="sm" onClick={() => void handleScan()} disabled={busy !== null} className="border-border bg-background">
              {busy === "scan" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Rescan modules
            </Button>
          }
        />
        <div className="mt-4 divide-y divide-border/70">
          {overview.objects.length === 0 && (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              No objects yet — generate assets in the SDK, 3D, or Video tabs, then rescan, or register one below.
            </p>
          )}
          {overview.objects.map((o) => {
            const cache = cacheByKey.get(`${o.bucket}/${o.key}`);
            const cached = cache && !cache.evicted;
            return (
              <div key={o._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-background text-chart-1">
                  <HardDrive className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11.5px] text-foreground/90">{o.url}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {o.bucket} · {o.kind} · {fmtBytes(o.sizeBytes)} · source: {o.source}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                    cached
                      ? "border-chart-2/40 bg-chart-2/10 text-chart-2"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {cached ? <Check className="size-2.5" /> : <Layers className="size-2.5" />}
                  {cached ? `warm · ${cache!.hits} hits` : "cold"}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSign(o.url)}
                    className="border-border bg-background"
                  >
                    <Zap className="size-3" /> Signed URL
                  </Button>
                  {cached ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void evictCache({ url: o.url }).then(() => toast.success("Cache entry evicted."))}
                      className="border-border bg-background text-muted-foreground"
                    >
                      <Trash2 className="size-3" /> Evict
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void warmCache({ url: o.url }).then(() => toast.success("Warmed into cache."))}
                      className="border-border bg-background"
                    >
                      <Zap className="size-3" /> Warm
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* manual register */}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border/70 pt-5">
          <div className="min-w-0 flex-1">
            <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Register an object</Label>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="s3://atelier-assets/requests/req_8f3a21.json"
              className="mt-1.5 border-border bg-background font-mono text-[12px]"
            />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              void registerObject({ url: urlInput })
                .then(() => {
                  toast.success("Object registered.");
                  setUrlInput("");
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Register failed"))
            }
            disabled={!urlInput.trim()}
            className="border-border bg-background"
          >
            <Database className="size-3.5" /> Register
          </Button>
        </div>
      </div>
    </div>
  );
}
