import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "./fonts/Inter-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Inter-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Inter-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AEGIS AI Safety Lab",
  description:
    "Council of Experts adversarial evaluation and governance for AI systems — powered by UNICC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-[var(--background)] text-[var(--text)] antialiased">
        <nav className="sticky top-0 z-50 border-b border-[var(--border-subtle)] bg-[var(--background)]/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
            <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="text-[var(--accent)]">◆</span>
              <span>AEGIS</span>
            </a>
            <div className="flex items-center gap-6 text-sm text-[var(--text-muted)]">
              <a href="/" className="transition hover:text-[var(--text)]">Home</a>
              <a href="/evaluations" className="transition hover:text-[var(--text)]">Evaluations</a>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
