"use client";

import { useRouter } from "next/navigation";
import { useArgusStore } from "@/lib/store";
import { loadSampleJob } from "@/lib/load-job";
import { useState } from "react";
import { useScrollReveal } from "@/lib/use-scroll-reveal";
import { useCountUp } from "@/lib/use-count-up";
import { HeroProductMock } from "@/components/hero-product-mock";
import { LiveReasoningPanel } from "@/components/live-reasoning-panel";
import Link from "next/link";
import Image from "next/image";
import { ArgusMark } from "@/components/argus-mark";

/* ------------------------------------------------------------------ */
/*  Section wrapper — fade-in-up on scroll                            */
/* ------------------------------------------------------------------ */
function RevealSection({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, isVisible } = useScrollReveal(0.12);
  return (
    <section
      ref={ref}
      className={`${className} ${isVisible ? "animate-reveal" : "opacity-0"}`}
      style={isVisible ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Data points with count-up                                         */
/* ------------------------------------------------------------------ */
function StatPoint({
  value,
  suffix,
  prefix,
  label,
  trigger,
  delay,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  label: string;
  trigger: boolean;
  delay: number;
}) {
  const count = useCountUp(value, 1800, trigger);
  return (
    <div
      className={`text-center transition-[transform,opacity,filter] duration-[600ms] ease-enter ${trigger ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <p className="text-3xl font-bold tabular-nums md:text-4xl">
        {prefix}{count.toLocaleString()}{suffix}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Feature card — clean white, whisper shadow                        */
/* ------------------------------------------------------------------ */
function FeatureCard({
  title,
  body,
  icon,
  delay,
  trigger,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
  delay: number;
  trigger: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-[transform,opacity,filter,border-color,box-shadow] duration-500 ease-enter hover:border-border-strong hover:shadow-[var(--shadow-card-hover)] ${trigger ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-[var(--radius-card)] bg-primary-soft text-primary">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline step                                                     */
/* ------------------------------------------------------------------ */
function PipelineStep({
  step,
  title,
  body,
  trigger,
  delay,
  isLast,
}: {
  step: number;
  title: string;
  body: string;
  trigger: boolean;
  delay: number;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-5">
      <div className="flex flex-col items-center">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white transition-[transform,opacity] duration-500 ease-enter ${trigger ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
          style={{ transitionDelay: `${delay}ms` }}
        >
          {step}
        </div>
        {!isLast && (
          <div
            className={`w-px flex-1 bg-border transition-transform duration-700 ease-enter origin-top ${trigger ? "scale-y-100" : "scale-y-0"}`}
            style={{ transitionDelay: `${delay + 200}ms` }}
          />
        )}
      </div>
      <div
        className={`pb-10 transition-[transform,opacity,filter] duration-500 ease-enter ${trigger ? "translate-x-0 opacity-100 blur-0" : "translate-x-2 opacity-0 blur-[6px]"}`}
        style={{ transitionDelay: `${delay + 100}ms` }}
      >
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SVG Icons (Lucide-style, no emojis)                               */
/* ------------------------------------------------------------------ */
const BookIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M8 7h8M8 11h8M8 15h5" />
  </svg>
);
const QuoteIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" /><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
  </svg>
);
const ChartIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
);
const AlertIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
  </svg>
);
const CheckIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden>
    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Buttons — Kraken primary (solid purple) + white outlined          */
/* ------------------------------------------------------------------ */
const PRIMARY_BTN =
  "cursor-pointer rounded-[12px] bg-primary px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#5741d8] disabled:opacity-50";
const WHITE_BTN =
  "cursor-pointer rounded-[12px] border border-border bg-background px-8 py-3.5 text-sm font-medium text-foreground shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-200 ease-enter hover:border-border-strong hover:shadow-[var(--shadow-card-hover)] disabled:opacity-50";

/* ================================================================== */
/*  LANDING PAGE                                                      */
/* ================================================================== */
export default function HomePage() {
  const router = useRouter();
  const clearStore = useArgusStore((s) => s.clear);
  const [loading, setLoading] = useState(false);

  const { ref: heroRef, isVisible: heroVisible } = useScrollReveal(0.05);
  const { ref: featuresRef, isVisible: featuresVisible } = useScrollReveal(0.1);
  const { ref: pipelineRef, isVisible: pipelineVisible } = useScrollReveal(0.1);
  const { ref: transparencyRef, isVisible: transparencyVisible } = useScrollReveal(0.1);
  const { ref: personaRef, isVisible: personaVisible } = useScrollReveal(0.1);

  const trySample = async () => {
    setLoading(true);
    try {
      // Validate the fixture loads before navigating, but don't pre-set the
      // store job — that would skip the idle "report + Run" replay screen.
      // Fully clear the store (not just live state) so a stale job from a
      // previous demo run can't bypass the idle screen on a repeat visit.
      // The audit page loads the fixture itself and shows the streaming replay.
      await loadSampleJob();
      clearStore();
      router.push("/audit?demo=1");
    } catch {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ============================================================ */}
      {/* NAV                                                          */}
      {/* ============================================================ */}
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <ArgusMark className="text-primary transition-transform group-hover:rotate-[8deg]" />
            <span className="text-xl font-bold tracking-tight">Argus</span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/incidents" className="text-muted-foreground transition-colors hover:text-foreground">Incidents</Link>
            <Link href="/miromind" className="text-muted-foreground transition-colors hover:text-foreground">Powered by MiroMind</Link>
            <Link href="/for-teams" className="text-muted-foreground transition-colors hover:text-foreground">For teams</Link>
            <Link
              href="/audit"
              className="cursor-pointer rounded-[12px] bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#5741d8]"
            >
              Start auditing
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative">
        {/* ============================================================ */}
        {/* HERO                                                         */}
        {/* ============================================================ */}
        <section
          ref={heroRef}
          className="relative flex min-h-[calc(100vh-56px)] flex-col items-center justify-center px-6 pt-16"
        >
          {/* Background glow */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-hidden">
            <Image
              src="/images/hero-glow.png"
              alt=""
              aria-hidden
              width={1400}
              height={1050}
              className="w-full max-w-6xl opacity-75"
              priority
            />
          </div>

          <div className="relative z-10 flex max-w-4xl flex-col items-center text-center">
            {/* Headline */}
            <h1
              className={`text-balance text-5xl font-bold leading-[1.08] tracking-tight md:text-7xl transition-[transform,opacity,filter] duration-[640ms] ease-enter ${heroVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
            >
              The audit layer for{" "}
              <span className="text-primary">AI-generated content</span>
            </h1>

            {/* Subtitle */}
            <p
              className={`mt-6 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground transition-[transform,opacity,filter] duration-[640ms] delay-[80ms] ease-enter ${heroVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
            >
              Upload any AI-generated report. Get back every factual claim,
              every verdict, and the full reasoning chain behind it.
            </p>

            {/* Data points */}
            <div
              className={`mt-12 flex items-center gap-6 md:gap-12 transition-[transform,opacity,filter] duration-[640ms] delay-[160ms] ease-enter ${heroVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
            >
              <StatPoint value={1353} suffix="+" label="AI-hallucination court cases" trigger={heroVisible} delay={220} />
              <div className="h-10 w-px bg-border" />
              <StatPoint value={95} suffix="%" label="GenAI pilots, no return" trigger={heroVisible} delay={300} />
              <div className="h-10 w-px bg-border" />
              <StatPoint value={30} suffix="%" label="GenAI projects abandoned" trigger={heroVisible} delay={380} />
            </div>

            {/* Stat sources — we cite our own claims */}
            <p
              className={`mt-4 text-xs text-muted-foreground/70 transition-[opacity,filter] duration-[640ms] delay-[440ms] ease-enter ${heroVisible ? "opacity-100 blur-0" : "opacity-0 blur-[4px]"}`}
            >
              Sources:{" "}
              <a href="https://www.damiencharlotin.com/hallucinations/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Charlotin / HEC Paris</a>{" · "}
              <a href="https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">MIT NANDA</a>{" · "}
              <a href="https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">Gartner</a>
            </p>

            {/* CTAs */}
            <div
              className={`mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4 transition-[transform,opacity,filter] duration-[640ms] delay-[260ms] ease-enter ${heroVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
            >
              <Link href="/audit" className={PRIMARY_BTN}>
                Start auditing
              </Link>
              <button
                type="button"
                onClick={trySample}
                disabled={loading}
                aria-busy={loading}
                className={WHITE_BTN}
              >
                {loading ? "Loading sample…" : "See a sample audit"}
              </button>
            </div>
          </div>

          {/* Product mock */}
          <div
            className={`relative z-10 mt-20 w-full max-w-4xl transition-[transform,opacity,filter] duration-[760ms] delay-[360ms] ease-enter ${heroVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-4 opacity-0 blur-[8px]"}`}
          >
            <HeroProductMock />
          </div>

          {/* Scroll indicator */}
          <div className={`mt-12 pb-8 transition-opacity duration-700 delay-[460ms] ease-enter ${heroVisible ? "opacity-100" : "opacity-0"}`}>
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <span className="text-[10px] uppercase tracking-widest">Scroll to explore</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* REAL INCIDENTS                                               */}
        {/* ============================================================ */}
        <RevealSection className="border-y border-border bg-muted py-16">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">It is already happening</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
              Top firms have shipped AI fabrications — in public.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Deloitte refunded a government report. EY pulled a study. Law firms were
              sanctioned. All for AI-invented citations.
            </p>
            <Link href="/incidents" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
              See the incidents →
            </Link>
          </div>
        </RevealSection>

        {/* ============================================================ */}
        {/* WHAT IT CATCHES                                              */}
        {/* ============================================================ */}
        <section ref={featuresRef} className="relative mx-auto max-w-5xl px-6 py-28">
          <div className={`text-center transition-[transform,opacity,filter] duration-[640ms] ease-enter ${featuresVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">What it catches</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Four types of AI content failure.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
              One autonomous verifier investigates every claim — choosing its own
              sources and strategy — while a consistency checker scans for claims
              that contradict each other. Nothing gets missed.
            </p>
          </div>

          <div className="mt-16 grid gap-5 sm:grid-cols-2">
            <FeatureCard
              icon={BookIcon}
              title="Fabricated references"
              body="Searches academic and public registries — such as Crossref, arXiv, and SSRN — to confirm a cited work actually exists. Papers, cases, or filings that don't get flagged."
              trigger={featuresVisible}
              delay={0}
            />
            <FeatureCard
              icon={QuoteIcon}
              title="Misrepresented sources"
              body="Fetches the original source and compares paragraph-by-paragraph. What was claimed vs. what was actually said."
              trigger={featuresVisible}
              delay={120}
            />
            <FeatureCard
              icon={ChartIcon}
              title="Outdated data"
              body="Checks figures and dates against authoritative primary sources on the live web — such as SEC filings, FRED, the World Bank, and IMF."
              trigger={featuresVisible}
              delay={240}
            />
            <FeatureCard
              icon={AlertIcon}
              title="Internal contradictions"
              body="Pairwise consistency check across claims within the same document. Page 3 says X, page 12 says not-X."
              trigger={featuresVisible}
              delay={360}
            />
          </div>
        </section>

        {/* ============================================================ */}
        {/* POWERED BY MIROMIND                                          */}
        {/* ============================================================ */}
        <RevealSection className="mx-auto max-w-3xl px-6 py-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Powered by MiroMind</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
            Deep research, only where it counts.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            The verifier runs on MiroMind&apos;s{" "}
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">mirothinker-1-7-deepresearch</span>{" "}
            — an autonomous agent that picks its own tools and searches the live web.
          </p>
          <Link href="/miromind" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
            How Argus uses MiroMind →
          </Link>
        </RevealSection>

        {/* ============================================================ */}
        {/* HOW IT WORKS                                                 */}
        {/* ============================================================ */}
        <section ref={pipelineRef} className="relative bg-muted py-28">
          <div className="mx-auto max-w-3xl px-6">
            <div className={`text-center transition-[transform,opacity,filter] duration-[640ms] ease-enter ${pipelineVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">How it works</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Two phases. One audit.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
                A LangGraph state machine fans verification out in parallel,
                then merges the findings without race conditions.
              </p>
            </div>

            <div className="mt-16">
              <PipelineStep step={1} title="Parse & atomize" body="PDF or text is parsed, then broken into atomic, independently verifiable claims. A checkworthiness gate filters trivial statements." trigger={pipelineVisible} delay={0} />
              <PipelineStep step={2} title="Autonomous verification" body="A self-directed verifier investigates each claim in parallel — choosing its own tools and sources, constrained only by the output schema. A consistency checker runs alongside it to catch claims that contradict each other." trigger={pipelineVisible} delay={200} />
              <PipelineStep step={3} title="Confidence & cross-verification" body="Each verdict is corroborated against multiple independent, authoritative sources. Confidence is then decomposed into three auditable factors — source authority, evidence freshness, and source agreement." trigger={pipelineVisible} delay={400} />
              <PipelineStep step={4} title="Audit report" body="Findings are ranked by severity and confidence. An exportable PDF audit report is generated — ready to file, attach, or cite." trigger={pipelineVisible} delay={600} isLast />
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* REASONING TRANSPARENCY                                       */}
        {/* ============================================================ */}
        <section ref={transparencyRef} className="mx-auto max-w-6xl px-6 py-28">
          <div className="grid items-center gap-12 md:grid-cols-[1fr_1.25fr] lg:gap-16">
            <div className={`transition-[transform,opacity,filter] duration-[640ms] ease-enter ${transparencyVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Core differentiator</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Reasoning you can read.
              </h2>
              <p className="mt-5 leading-relaxed text-muted-foreground">
                Every web search, every fetched source, every chain-of-thought step is recorded
                and streamed live. This isn&apos;t a black-box confidence score — it&apos;s a readable,
                auditable chain of evidence.
              </p>
              <ul className="mt-7 space-y-3 text-sm">
                {[
                  "Watch the verifier think in real-time via WebSocket",
                  "Every source URL is clickable and verifiable",
                  "Every verdict ships why it's wrong and the correct answer",
                  "Confidence decomposed into 3 auditable factors",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    {CheckIcon}
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Live reasoning — streaming drill-down */}
            <div
              className={`transition-[transform,opacity,filter] duration-[760ms] delay-[140ms] ease-enter ${transparencyVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-4 opacity-0 blur-[8px]"}`}
            >
              <LiveReasoningPanel />
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* WHO USES ARGUS                                               */}
        {/* ============================================================ */}
        <section ref={personaRef} className="relative bg-muted py-28">
          <div className="mx-auto max-w-5xl px-6">
            <div className={`text-center transition-[transform,opacity,filter] duration-[640ms] ease-enter ${personaVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Who uses Argus</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                Built for teams that receive AI output.
              </h2>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                {
                  title: "Legal & compliance",
                  body: "Opposing counsel filed a brief drafted with AI. Flag fabricated cases before you cite them back. Evidence trail built to file.",
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
                      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                    </svg>
                  ),
                },
                {
                  title: "AI governance",
                  body: "Your analysts paste ChatGPT into board memos. Argus is the checkpoint between 'the model said it' and 'we signed off on it'.",
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  ),
                },
                {
                  title: "Investment & research",
                  body: "A 40-page AI research note arrived from a vendor. You can't read it all; you can't trust it all. Argus surfaces only what's wrong.",
                  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  ),
                },
              ].map((p, i) => (
                <div
                  key={p.title}
                  className={`rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-[transform,opacity,filter,border-color,box-shadow] duration-500 ease-enter hover:border-border-strong hover:shadow-[var(--shadow-card-hover)] ${personaVisible ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-[6px]"}`}
                  style={{ transitionDelay: `${i * 120}ms` }}
                >
                  <div className="mb-4 flex size-11 items-center justify-center rounded-[var(--radius-card)] bg-primary-soft text-primary">
                    {p.icon}
                  </div>
                  <h3 className="text-base font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============================================================ */}
        {/* BOTTOM CTA                                                   */}
        {/* ============================================================ */}
        <RevealSection className="py-28">
          <div className="mx-auto flex max-w-2xl flex-col items-center px-6 text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Ready to audit?
            </h2>
            <p className="mt-4 text-muted-foreground">
              See Argus in action on an AI-generated NVIDIA equity-research note
              with deliberately planted errors — no API key needed.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
              <Link href="/audit" className={PRIMARY_BTN}>
                Start auditing
              </Link>
              <button
                type="button"
                onClick={trySample}
                disabled={loading}
                aria-busy={loading}
                className={WHITE_BTN}
              >
                {loading ? "Loading sample…" : "See a sample audit"}
              </button>
            </div>
          </div>
        </RevealSection>

        {/* ============================================================ */}
        {/* FOOTER                                                       */}
        {/* ============================================================ */}
        <footer className="border-t border-border py-8">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 text-xs text-muted-foreground">
            <span>
              Powered by MiroMind{" "}
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px]">mirothinker-1-7-deepresearch</code>
            </span>
            <span>UCWS Singapore 2026</span>
          </div>
        </footer>
      </main>
    </>
  );
}
