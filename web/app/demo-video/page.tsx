import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArgusHeader } from "@/components/argus-header";
import { MarketingCtas } from "@/components/marketing-ctas";

export const metadata = {
  title: "Demo video — Argus",
  description: "Watch the Argus demo walkthrough for AI-generated content audits.",
};

function publicAssetUrl(relativePath: string) {
  const assetPath = path.join(process.cwd(), "public", relativePath);
  return fs.existsSync(assetPath) ? `/${relativePath}` : "";
}

export default function DemoVideoPage() {
  const videoUrl =
    process.env.NEXT_PUBLIC_ARGUS_DEMO_VIDEO_URL?.trim() ||
    publicAssetUrl("demo/argus-demo.mp4");
  const posterUrl = publicAssetUrl("demo/argus-demo-poster.png");

  return (
    <>
      <ArgusHeader />
      <main className="mx-auto max-w-5xl px-6">
        <header className="py-16 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Demo video</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Watch Argus audit an AI-drafted brief.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            A short walkthrough of the review queue, cited evidence, MiroMind reasoning trace, and exportable audit pack.
          </p>
        </header>

        {videoUrl ? (
          <section className="pb-16">
            <div className="relative overflow-hidden rounded-[18px] border border-border bg-[#090910] shadow-[0_28px_80px_rgba(16,24,40,0.16)]">
              <video
                className="aspect-video w-full bg-[#090910]"
                controls
                playsInline
                preload="metadata"
                poster={posterUrl || undefined}
              >
                <source src={videoUrl} type="video/mp4" />
              </video>
            </div>
            <div className="mt-5 flex justify-center">
              <Link
                href={videoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-primary hover:underline"
              >
                Open video in a new tab →
              </Link>
            </div>
          </section>
        ) : (
          <section className="pb-16">
            <div className="flex aspect-video flex-col items-center justify-center rounded-[18px] border border-dashed border-border-strong bg-muted/40 p-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Video slot reserved</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight">Final demo video will play here.</h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                The live sample audit is available while the final walkthrough is being prepared.
              </p>
              <Link
                href="/audit?demo=1"
                className="mt-5 rounded-[12px] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5741d8]"
              >
                See a sample audit
              </Link>
            </div>
          </section>
        )}

        <section className="border-t border-border py-16 text-center">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Run the sample audit next.</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            The live sample shows the same claim-level findings, evidence, trace, and export flow.
          </p>
          <MarketingCtas className="mt-7" />
        </section>
      </main>
    </>
  );
}
