import { ArgusHeader } from "@/components/argus-header";
import { MarketingCtas } from "@/components/marketing-ctas";

export const metadata = {
  title: "Incidents — Argus",
  description: "Real reports, court filings, and publications shipped with AI-fabricated content — and what it cost.",
};

// Every item below is a real, reported incident with a reputable source link.
const INCIDENTS: { outlet: string; date: string; figure: string; org: string; body: string; url: string }[] = [
  {
    outlet: "Fortune", date: "Oct 2025", figure: "$290K", org: "Deloitte Australia",
    body: "Refunded a government report after a researcher found AI-fabricated citations and an invented quote from a Federal Court judgment.",
    url: "https://fortune.com/2025/10/07/deloitte-ai-australia-government-report-hallucinations-technology-290000-refund/",
  },
  {
    outlet: "Fortune", date: "Nov 2025", figure: "$1M+", org: "Deloitte Canada",
    body: "A million-dollar report for a provincial government was found citing AI-generated research that does not exist.",
    url: "https://fortune.com/2025/11/25/deloitte-caught-fabricated-ai-generated-research-million-dollar-report-canada-government/",
  },
  {
    outlet: "GPTZero", date: "2025", figure: "16/27 citations", org: "EY Canada",
    body: "Withdrew a loyalty-fraud cybersecurity study after 16 of 27 citations were found hallucinated — including a McKinsey report that does not exist.",
    url: "https://gptzero.me/investigations/ey",
  },
  {
    outlet: "Chicago Sun-Times", date: "Dec 2025", figure: "$49,500", org: "Goldberg Segalla",
    body: "A law firm was sanctioned after a lawyer filed ChatGPT-fabricated citations in a lead-paint case and never checked the work.",
    url: "https://chicago.suntimes.com/the-watchdogs/2025/12/09/goldberg-segalla-law-firm-cha-sanctioned-60-000-ai-chatgpt-lead-paint-court-case",
  },
  {
    outlet: "The Daily Record", date: "Oct 2025", figure: "21/23 quotes", org: "California appeal",
    body: "An attorney was fined $10,000 — 21 of the 23 case quotations in the opening brief were fabricated by AI.",
    url: "https://thedailyrecord.com/2025/10/13/california-lawyer-ai-fake-citations-fine/",
  },
  {
    outlet: "CNN", date: "2023", figure: "6 fake cases", org: "Mata v. Avianca",
    body: "The case that started it all — New York lawyers sanctioned $5,000 after submitting six nonexistent court cases invented by ChatGPT.",
    url: "https://www.cnn.com/2023/05/27/business/chat-gpt-avianca-mata-lawyers",
  },
  {
    outlet: "NPR", date: "May 2025", figure: "10/15 fake books", org: "Chicago Sun-Times",
    body: "A syndicated “summer reading list” ran ten books that don't exist — fake titles attributed to real, award-winning authors.",
    url: "https://www.npr.org/2025/05/20/nx-s1-5405022/fake-summer-reading-list-ai",
  },
  {
    outlet: "OECD.AI", date: "2025", figure: "removed", org: "Butler Snow",
    body: "Attorneys defending Alabama's prison system were sanctioned and removed from a case for filing ChatGPT-fabricated citations.",
    url: "https://oecd.ai/en/incidents/2025-09-19-5f12",
  },
];

export default function IncidentsPage() {
  return (
    <>
      <ArgusHeader />
      <main className="mx-auto max-w-5xl px-6">
        {/* Hero */}
        <header className="py-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">In the wild</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
            When nobody checks the AI.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Consultancies, law firms, and newsrooms have all shipped AI-generated content
            with fabricated citations — in public, under their own name.
          </p>
          <p className="mt-6 text-sm text-muted-foreground">
            <a href="https://www.damiencharlotin.com/hallucinations/" target="_blank" rel="noreferrer" className="font-semibold text-foreground underline underline-offset-2 hover:text-primary">1,536</a>{" "}
            legal cases caught relying on AI-hallucinated content — and the{" "}
            <a href="https://www.damiencharlotin.com/hallucinations/" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-primary">tracker</a>{" "}
            grows daily.
          </p>
        </header>

        {/* Incident wall */}
        <div className="grid gap-5 pb-16 md:grid-cols-2">
          {INCIDENTS.map((it) => (
            <a
              key={it.org + it.outlet}
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-background p-6 shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow] duration-300 ease-enter will-change-transform hover:-translate-y-1 hover:scale-[1.01] hover:border-primary/35 hover:shadow-[0_18px_45px_rgba(102,63,255,0.13)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none motion-reduce:transition-none"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-y-8 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent via-primary/10 to-transparent opacity-0 transition-[transform,opacity] duration-500 ease-enter group-hover:translate-x-[430%] group-hover:opacity-100 motion-reduce:hidden"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {it.outlet} · {it.date}
                </span>
                <span className="rounded-md bg-destructive/10 px-2 py-0.5 font-mono text-xs font-bold text-destructive-foreground transition-[transform,background-color] duration-300 ease-enter group-hover:scale-105 group-hover:bg-destructive/15 motion-reduce:transform-none">
                  {it.figure}
                </span>
              </div>
              <h2 className="mt-3 text-lg font-semibold transition-colors duration-300 ease-enter group-hover:text-primary">{it.org}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary transition-transform duration-300 ease-enter group-hover:translate-x-1 group-hover:underline motion-reduce:transform-none">
                Read the report →
              </span>
            </a>
          ))}
        </div>

        {/* CTA */}
        <section className="border-t border-border py-20 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Don&apos;t let the next one be yours.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Argus audits AI-generated content for fabricated citations and false claims before you sign off.
          </p>
          <MarketingCtas className="mt-7" />
        </section>
      </main>
    </>
  );
}
