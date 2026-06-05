import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Argus — Audit research reports with reasoning you can verify",
  description:
    "Argus audits PDF research reports for fabricated citations, misaligned quotes, stale data, and internal contradictions — and shows the full reasoning chain behind every verdict.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
