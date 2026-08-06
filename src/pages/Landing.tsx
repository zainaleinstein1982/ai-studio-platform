import { motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  BookOpen,
  Check,
  CreditCard,
  History,
  KeyRound,
  ListOrdered,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { KIND_META, type GatewayKind } from "@/convex/catalog";

/* ------------------------------------------------------------------ */
/* Small editorial primitives                                          */
/* ------------------------------------------------------------------ */

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
      {children}
    </p>
  );
}

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className="font-display text-[22px] font-medium tracking-tight text-foreground">
        Atelier
      </span>
      <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.32em] text-muted-foreground">
        AI Platform Gateway
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const PIPELINE = [
  { n: "01", title: "Project Bootstrap", meta: "Foundation · repository & tooling" },
  { n: "02", title: "Authentication", meta: "JWT sessions · sign in / sign up" },
  { n: "03", title: "API Key Platform", meta: "Keys hashed at rest · one-time reveal" },
  { n: "04", title: "User Dashboard", meta: "The console you are looking at" },
  { n: "05", title: "AI Gateway Router", meta: "kind → provider → model routing" },
  { n: "06", title: "Storage", meta: "Object buckets for inputs & outputs" },
  { n: "07", title: "Queue System", meta: "Durable queue · worker-drained" },
  {
    n: "08",
    title: "AI Providers",
    meta: "Text AI · Vision AI",
    branch: ["Text AI — LLM chat, reasoning, generation", "Vision AI — image understanding & captioning"],
  },
  {
    n: "09",
    title: "Generative Routes",
    meta: "Text→3D · Image→3D · Text→Video · Image→Video",
    branch: ["3D — prompt or image to mesh (glTF / USDZ)", "Video — prompt or image to clip (24 fps)"],
  },
  { n: "10", title: "History", meta: "A searchable ledger of every call" },
  { n: "11", title: "Billing", meta: "Credit metering · plans · usage" },
  { n: "12", title: "Deployment", meta: "Docker · production-ready" },
];

const FEATURES: { n: string; icon: LucideIcon; title: string; body: string }[] = [
  {
    n: "01",
    icon: KeyRound,
    title: "API Key Platform",
    body: "Issue scoped keys with one-time secret reveal, hashed at rest, and instant revocation from the console.",
  },
  {
    n: "02",
    icon: Waypoints,
    title: "Gateway Router",
    body: "A declarative routing table maps every call to a provider and model — swap vendors without touching clients.",
  },
  {
    n: "03",
    icon: ListOrdered,
    title: "Queue System",
    body: "Every request is enqueued and drained by workers, so bursts backpressure gracefully instead of failing.",
  },
  {
    n: "04",
    icon: Archive,
    title: "Object Storage",
    body: "Inputs and outputs land in asset buckets — images, meshes, and clips, addressable by stable URL.",
  },
  {
    n: "05",
    icon: History,
    title: "History Ledger",
    body: "A searchable record of every call: route, latency, cost, prompt, and response payload.",
  },
  {
    n: "06",
    icon: CreditCard,
    title: "Billing",
    body: "Credit-based metering with per-route costs, plan tiers, and a live usage ledger.",
  },
];

const ROUTES: { kind: GatewayKind; models: string; desc: string }[] = [
  { kind: "text", models: "gpt-4o · claude · gemini", desc: "Chat, reasoning, and generation through the LLM route." },
  { kind: "vision", models: "gpt-4o · claude · gemini", desc: "Image understanding, captioning, and analysis." },
  { kind: "textTo3d", models: "meshy · tripo", desc: "Prompt-to-mesh generation with watertight output." },
  { kind: "imageTo3d", models: "meshy · tripo", desc: "Single-image reconstruction to glTF / USDZ." },
  { kind: "textToVideo", models: "runway · kling", desc: "Prompt-to-clip synthesis at 24 fps." },
  { kind: "imageToVideo", models: "runway · kling · luma", desc: "Animate a still image into motion." },
];

const PROVIDER_STRIP = ["OpenAI", "Anthropic", "Google", "Meshy", "Tripo", "Runway", "Kling", "Luma"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const consoleHref = isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="Atelier home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-7 text-[13px] font-medium text-muted-foreground md:flex">
            <a href="#pipeline" className="transition-colors hover:text-foreground">Pipeline</a>
            <a href="#platform" className="transition-colors hover:text-foreground">Platform</a>
            <a href="#providers" className="transition-colors hover:text-foreground">Providers</a>
            <a href="#docs" className="transition-colors hover:text-foreground">Docs</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:block"
            >
              Sign in
            </Link>
            <Link
              to={consoleHref}
              className="group inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
            >
              {isLoading ? "Open console" : isAuthenticated ? "Open console" : "Get started"}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_500px_at_70%_-10%,oklch(0.9_0.02_80/0.7),transparent_65%)]"
        />
        <div className="mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-16 md:grid-cols-12 md:pb-28 md:pt-24">
          <div className="md:col-span-7">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <Kicker>AI Platform Gateway — Studio Edition</Kicker>
              <h1 className="mt-6 font-display text-[44px] font-light leading-[1.05] tracking-tight text-balance sm:text-6xl">
                One gateway for{" "}
                <em className="font-normal italic text-primary">every model.</em>
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted-foreground">
                Atelier sits in front of the world&apos;s AI providers — text, vision, 3D, and
                video — behind a single API key, a durable queue, and a ledger that bills
                every call. Built like a gallery: clean, measured, and quiet until you need it.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => navigate(consoleHref)}
                  className="group inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
                >
                  Create your first key
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                <button
                  onClick={() => navigate("/dashboard#docs")}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <BookOpen className="size-4 text-muted-foreground" />
                  Read the docs
                </button>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-chart-2" /> 6 provider routes
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-chart-1" /> 12-phase pipeline
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-chart-3" /> 100 free credits
                </span>
              </div>
            </motion.div>
          </div>

          {/* trace card */}
          <div className="md:col-span-5">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div className="absolute -inset-px rounded-lg bg-gradient-to-b from-border/60 to-transparent" aria-hidden />
              <div className="relative rounded-lg border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
                  <span className="font-mono text-[11px] text-muted-foreground">atelier · gateway trace</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-chart-2">
                    <span className="size-1.5 animate-pulse rounded-full bg-chart-2" /> healthy
                  </span>
                </div>
                <div className="space-y-2.5 p-5 font-mono text-[11.5px] leading-relaxed">
                  <p className="text-foreground/80">
                    <span className="text-muted-foreground">$</span> atelier send{" "}
                    <span className="text-chart-2">--route text</span>{" "}
                    <span className="text-chart-3">--model openai/gpt-4o</span>
                  </p>
                  <p className="text-muted-foreground">“a quiet gallery at dawn”</p>
                  <div className="my-3 border-t border-dashed border-border/80" />
                  <p className="text-foreground/80">
                    <span className="text-chart-1">─</span> gateway router · matched{" "}
                    <span className="text-chart-2">text/openai/gpt-4o</span>
                  </p>
                  <p className="text-foreground/80">
                    <span className="text-chart-1">─</span> queue · pos 0 · drained in ~1.9s
                  </p>
                  <p className="text-foreground/80">
                    <span className="text-chart-1">─</span> provider · 200 OK · 1,942 ms
                  </p>
                  <p className="text-foreground/80">
                    <span className="text-chart-1">─</span> storage · s3://atelier-assets/req_8f3a.json
                  </p>
                  <p className="text-foreground/80">
                    <span className="text-chart-1">─</span> billing · 1 credit · ledger updated
                  </p>
                  <div className="my-3 border-t border-dashed border-border/80" />
                  <p className="text-chart-2">
                    <Check className="mr-1.5 inline size-3" /> 200 OK · 1.9 s · 1 credit
                  </p>
                </div>
              </div>
              <div className="absolute -right-3 -top-3 hidden rotate-2 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground shadow-sm sm:block">
                apk_live_3f2a…e91c
              </div>
            </motion.div>
          </div>
        </div>

        {/* provider strip */}
        <div className="border-y border-border/70 bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-5 py-5">
            <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Routing to
            </span>
            {PROVIDER_STRIP.map((p) => (
              <span key={p} className="font-display text-[15px] font-light text-foreground/55">
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pipeline ───────────────────────────────────────────── */}
      <section id="pipeline" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 md:py-28">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <Reveal>
              <Kicker>Development pipeline</Kicker>
              <h2 className="mt-5 font-display text-3xl font-light leading-tight tracking-tight text-balance md:text-4xl">
                Twelve phases, <em className="italic text-primary">one gateway.</em>
              </h2>
              <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
                The build order of the platform, from bootstrap to deployment — the same
                pipeline the console is running on. Each phase is a numbered step in the
                development plan.
              </p>
            </Reveal>
          </div>
          <div className="md:col-span-8">
            <div className="divide-y divide-border/80 border-y border-border/80">
              {PIPELINE.map((step, i) => (
                <Reveal key={step.n} delay={Math.min(i * 0.04, 0.3)}>
                  <div className="group grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-4 py-4 transition-colors hover:bg-card/60">
                    <span className="font-display text-lg font-light text-muted-foreground/70 transition-colors group-hover:text-chart-1">
                      {step.n}
                    </span>
                    <span className="font-display text-lg font-light tracking-tight text-foreground">
                      {step.title}
                    </span>
                    <span className="hidden text-right text-[11px] text-muted-foreground sm:block">
                      {step.meta}
                    </span>
                  </div>
                  {"branch" in step && step.branch && (
                    <div className="grid grid-cols-[3.5rem_1fr] gap-4 pb-4">
                      <span />
                      <div className="space-y-1.5 pl-3 font-mono text-[11.5px] text-muted-foreground">
                        {step.branch.map((b) => (
                          <p key={b}>
                            <span className="mr-2 text-chart-1">├─</span>
                            {b}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform ───────────────────────────────────────────── */}
      <section id="platform" className="border-y border-border/70 bg-card/50 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-28">
          <Reveal>
            <Kicker>Platform</Kicker>
            <h2 className="mt-5 max-w-xl font-display text-3xl font-light leading-tight tracking-tight text-balance md:text-4xl">
              The quiet machinery behind <em className="italic text-primary">every call.</em>
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border/80 bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.n} delay={Math.min(i * 0.05, 0.3)}>
                <div className="group flex h-full flex-col bg-card p-7 transition-colors hover:bg-card-foreground/[0.03]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted-foreground/70">{f.n}</span>
                    <f.icon className="size-4 text-chart-1 opacity-70 transition-opacity group-hover:opacity-100" />
                  </div>
                  <h3 className="mt-5 font-display text-xl font-normal tracking-tight text-foreground">
                    {f.title}
                  </h3>
                  <p className="mt-2.5 text-[13px] leading-6 text-muted-foreground">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Providers ──────────────────────────────────────────── */}
      <section id="providers" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 md:py-28">
        <Reveal>
          <Kicker>Provider routes</Kicker>
          <h2 className="mt-5 max-w-xl font-display text-3xl font-light leading-tight tracking-tight text-balance md:text-4xl">
            Six routes, <em className="italic text-primary">six disciplines.</em>
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ROUTES.map((r, i) => {
            const meta = KIND_META[r.kind];
            return (
              <Reveal key={r.kind} delay={Math.min(i * 0.05, 0.3)}>
                <div className="group flex h-full flex-col rounded-lg border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm">
                  <div className="flex items-start justify-between">
                    <h3 className="font-display text-xl font-normal tracking-tight">
                      {meta.label}
                    </h3>
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
                      {meta.credits} cr
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{r.desc}</p>
                  <div className="mt-5 flex flex-1 items-end justify-between gap-3 border-t border-border/60 pt-4">
                    <span className="font-mono text-[11px] text-foreground/70">{r.models}</span>
                    {meta.needsImage && (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-chart-3">
                        image in
                      </span>
                    )}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ── SDK / docs ─────────────────────────────────────────── */}
      <section id="docs" className="border-y border-border/70 bg-card/50 scroll-mt-20">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 py-20 md:grid-cols-2 md:py-28">
          <Reveal>
            <Kicker>Ship in five minutes</Kicker>
            <h2 className="mt-5 font-display text-3xl font-light leading-tight tracking-tight text-balance md:text-4xl">
              Your first call, <em className="italic text-primary">in five minutes.</em>
            </h2>
            <ol className="mt-8 space-y-5">
              {[
                ["Create a key", "Generate an API key from the console — you'll see the full secret exactly once."],
                ["Install the SDK", "One dependency. The SDK routes through the gateway and retries on the queue."],
                ["Call a model", "Pick a route and provider; billing happens automatically per call."],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-[11px] text-chart-1">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <button
              onClick={() => navigate(consoleHref)}
              className="group mt-9 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
            >
              Open the console
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="overflow-hidden rounded-lg border border-border bg-[oklch(0.22_0.014_70)] shadow-sm">
              <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
                <span className="size-2.5 rounded-full bg-chart-3/80" />
                <span className="size-2.5 rounded-full bg-chart-5/80" />
                <span className="size-2.5 rounded-full bg-chart-2/80" />
                <span className="ml-3 font-mono text-[11px] text-white/45">quickstart.ts</span>
              </div>
              <pre className="scrollbar-thin overflow-x-auto p-5 font-mono text-[12px] leading-6 text-white/85">
                <code>
                  <span className="text-white/40"># 1 · install</span>{"\n"}
                  <span className="text-chart-5">$</span> npm i @atelier/ai-platform{"\n\n"}
                  <span className="text-white/40"># 2 · create a client</span>{"\n"}
                  <span className="text-chart-2">import</span>{" "}
                  <span className="text-white/70">{"{ Atelier }"}</span>{" "}
                  <span className="text-chart-2">from</span>{" "}
                  <span className="text-chart-5">"@atelier/ai-platform"</span>
                  {"\n\n"}
                  <span className="text-chart-2">const</span>{" "}
                  <span className="text-white/70">atelier</span>{" "}
                  <span className="text-white/50">=</span>{" "}
                  <span className="text-chart-2">new</span>{" "}
                  <span className="text-white/70">Atelier</span>
                  <span className="text-white/50">({"{"}</span>
                  {"\n  "}apiKey: <span className="text-chart-5">"apk_live_…"</span>
                  <span className="text-white/50">{"}"}</span>
                  <span className="text-white/50">)</span>
                  {"\n\n"}
                  <span className="text-white/40"># 3 · call a model</span>{"\n"}
                  <span className="text-chart-2">const</span>{" "}
                  <span className="text-white/70">res</span>{" "}
                  <span className="text-white/50">=</span>{" "}
                  <span className="text-chart-2">await</span>{" "}
                  <span className="text-white/70">atelier.text.create</span>
                  <span className="text-white/50">({"{"}</span>
                  {"\n  "}model: <span className="text-chart-5">"openai/gpt-4o"</span>
                  <span className="text-white/50">,</span>
                  {"\n  "}prompt: <span className="text-chart-5">"a quiet gallery at dawn"</span>
                  <span className="text-white/50">,</span>
                  {"\n"}
                  <span className="text-white/50">{"})"}</span>
                </code>
              </pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24 text-center md:py-32">
        <Reveal>
          <Kicker>Get started</Kicker>
          <h2 className="mx-auto mt-6 max-w-2xl font-display text-4xl font-light leading-tight tracking-tight text-balance md:text-5xl">
            Your models, one key, <em className="italic text-primary">one bill.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted-foreground">
            Every new account begins with 100 credits. No card required — the gateway
            meters usage and billing follows.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => navigate(consoleHref)}
              className="group inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
            >
              Start building — it&apos;s free
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <Link
              to="/auth"
              className="inline-flex h-11 items-center rounded-md border border-border bg-card px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Continue as guest
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-border/80 bg-card/60">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Wordmark />
              <p className="mt-4 max-w-xs text-[13px] leading-6 text-muted-foreground">
                A studio-clean gateway for text, vision, 3D, and video models — with a queue,
                a ledger, and a bill that makes sense.
              </p>
              <p className="mt-6 font-mono text-[10.5px] text-muted-foreground/70">
                STEP 01 · foundation — NextJS 15 · React 19 · FastAPI · PostgreSQL ·
                Redis · Celery · MinIO · JWT
              </p>
            </div>
            <div className="md:col-span-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Platform</p>
              <ul className="mt-4 space-y-2.5 text-[13px]">
                {[
                  ["Gateway", "/dashboard#gateway"],
                  ["API Keys", "/dashboard#keys"],
                  ["Billing", "/dashboard#billing"],
                  ["History", "/dashboard#history"],
                ].map(([label, href]) => (
                  <li key={label}>
                    <Link to={href} className="text-muted-foreground transition-colors hover:text-foreground">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Build</p>
              <ul className="mt-4 space-y-2.5 text-[13px]">
                {[
                  ["Pipeline", "#pipeline"],
                  ["Providers", "#providers"],
                  ["Docs", "#docs"],
                ].map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="text-muted-foreground transition-colors hover:text-foreground">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Status</p>
              <ul className="mt-4 space-y-2.5 text-[13px]">
                <li className="inline-flex items-center gap-2 text-muted-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-chart-2" /> Gateway healthy
                </li>
                <li className="text-muted-foreground">Queue: 0 pending</li>
                <li className="text-muted-foreground">Uptime 99.98%</li>
              </ul>
            </div>
          </div>
          <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border/70 pt-6 text-[11.5px] text-muted-foreground sm:flex-row sm:items-center">
            <p>© 2026 Atelier AI Platform · Studio Edition</p>
            <p className="font-mono">apk_live_… · POST /v1/text · 200 OK</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
