import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BookOpen,
  CreditCard,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Send,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { planById } from "@/convex/catalog";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { GatewayTab } from "@/components/dashboard/GatewayTab";
import { ApiKeysTab } from "@/components/dashboard/ApiKeysTab";
import { HistoryTab } from "@/components/dashboard/HistoryTab";
import { BillingTab } from "@/components/dashboard/BillingTab";
import { DocsTab } from "@/components/dashboard/DocsTab";
import { AccountTab } from "@/components/dashboard/AccountTab";
import { cn } from "@/lib/utils";

export type ConsoleTab =
  | "overview"
  | "gateway"
  | "keys"
  | "history"
  | "billing"
  | "docs"
  | "account";

const TABS: { id: ConsoleTab; label: string; sub: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", sub: "Usage at a glance", icon: LayoutDashboard },
  { id: "gateway", label: "Gateway", sub: "Compose and route requests", icon: Send },
  { id: "keys", label: "API Keys", sub: "Issue, reveal, and revoke keys", icon: KeyRound },
  { id: "history", label: "History", sub: "The full request ledger", icon: History },
  { id: "billing", label: "Billing", sub: "Credits, plans, and usage", icon: CreditCard },
  { id: "docs", label: "Docs", sub: "Guides and provider reference", icon: BookOpen },
  { id: "account", label: "Account", sub: "Profile, verification, teams, roles", icon: UserRound },
];

function tabFromHash(): ConsoleTab {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (TABS.some((t) => t.id === h) ? h : "overview") as ConsoleTab;
}

function Wordmark() {
  return (
    <Link to="/" className="inline-flex flex-col leading-none">
      <span className="font-display text-[21px] font-medium tracking-tight text-foreground">
        Atelier
      </span>
      <span className="mt-1 text-[8.5px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
        AI Platform Gateway
      </span>
    </Link>
  );
}

function initialsOf(name?: string, email?: string): string {
  const src = name || email || "A";
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "A";
  const last = parts[1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ConsoleTab>(tabFromHash);
  const ensureAccount = useMutation(api.billing.ensureAccount);
  const stats = useQuery(api.gateway.stats);

  useEffect(() => {
    void ensureAccount().catch(() => {});
  }, [ensureAccount]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const target = `#${tab}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [tab]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const go = (t: ConsoleTab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const active = TABS.find((t) => t.id === tab)!;
  const plan = planById(stats?.plan ?? "starter");
  const avatar = initialsOf(user?.name, user?.email);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ── Sidebar (desktop) ─────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/80 bg-card/60 lg:flex">
        <div className="border-b border-border/70 px-6 py-5">
          <Wordmark />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {TABS.map((t) => {
            const activeTab = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                  activeTab
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <t.icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    activeTab ? "text-chart-1" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* credits chip */}
        <div className="mx-3 mb-3 rounded-md border border-border bg-background p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Credits
            </span>
            <span className="rounded-full border border-chart-1/40 bg-chart-1/10 px-2 py-0.5 text-[10px] font-medium text-chart-1">
              {plan ? plan.name : "…"}
            </span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-light tracking-tight text-chart-1">
            {stats ? stats.credits.toLocaleString() : "—"}
          </p>
        </div>

        {/* user */}
        <div className="flex items-center gap-3 border-t border-border/70 px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-accent font-display text-[13px] text-foreground">
            {avatar}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-foreground">
              {user?.name || "Guest"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email || "anonymous session"}</p>
          </div>
          <button
            onClick={() => void handleSignOut()}
            title="Sign out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1">
        {/* topbar */}
        <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-md">
          {/* mobile wordmark + nav */}
          <div className="flex items-center justify-between px-5 pt-4 lg:hidden">
            <Wordmark />
            <button
              onClick={() => void handleSignOut()}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            >
              <LogOut className="size-4" />
            </button>
          </div>
          <div className="scrollbar-thin flex gap-1.5 overflow-x-auto px-5 py-3 lg:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
                  t.id === tab
                    ? "border-foreground/25 bg-accent text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* page header */}
          <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-5 py-5">
            <div>
              <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Atelier · Console
              </p>
              <h1 className="mt-1 font-display text-3xl font-light tracking-tight text-foreground">
                {active.label}
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">{active.sub}</p>
            </div>
            <div className="hidden items-center gap-4 lg:flex">
              <span className="rounded-md border border-border bg-card px-3.5 py-2 font-mono text-[11.5px] text-muted-foreground">
                {plan ? plan.name : "…"} · {stats ? `${stats.credits.toLocaleString()} cr` : "…"}
              </span>
              <span className="flex size-9 items-center justify-center rounded-full border border-border bg-accent font-display text-[13px] text-foreground">
                {avatar}
              </span>
            </div>
          </div>
        </header>

        {/* content */}
        <div className="mx-auto max-w-6xl px-5 py-8 pb-20">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "overview" && <OverviewTab onNavigate={go} />}
            {tab === "gateway" && <GatewayTab />}
            {tab === "keys" && <ApiKeysTab />}
            {tab === "history" && <HistoryTab />}
            {tab === "billing" && <BillingTab />}
            {tab === "docs" && <DocsTab />}
            {tab === "account" && <AccountTab />}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
