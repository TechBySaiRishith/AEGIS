import type { Metadata } from "next";
import Link from "next/link";
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

function AegisMark() {
  return (
    <span className="relative grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_18px_30px_rgba(0,0,0,0.32)]">
      <span className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_30%_30%,rgba(34,211,238,0.24),transparent_58%)]" />
      <span className="absolute inset-[5px] rounded-[1rem] border border-white/10" />
      <span className="relative grid h-5 w-5 grid-cols-2 gap-1">
        <span className="rounded-sm bg-[var(--accent)] shadow-[0_0_18px_rgba(34,211,238,0.5)]" />
        <span className="rounded-sm bg-white/70" />
        <span className="rounded-sm bg-white/70" />
        <span className="rounded-sm bg-[var(--guardian)] shadow-[0_0_18px_rgba(167,139,250,0.45)]" />
      </span>
    </span>
  );
}

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/evaluations", label: "Evaluations" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="relative min-h-screen overflow-x-clip">
          <nav className="sticky top-0 z-50 border-b border-white/6 bg-[rgba(9,9,11,0.78)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.45),rgba(167,139,250,0.32),transparent)]" />
            <div className="mx-auto flex h-[4.5rem] w-full max-w-[92rem] items-center justify-between px-6 sm:px-8 lg:px-10">
              <Link href="/" className="group flex items-center gap-4">
                <AegisMark />
                <div>
                  <div className="text-[0.68rem] uppercase tracking-[0.35em] text-[var(--text-muted)] transition group-hover:text-[var(--accent)]">
                    UNICC AI Safety Lab
                  </div>
                  <div className="text-base font-semibold tracking-[0.18em] text-[var(--text)]">
                    AEGIS
                  </div>
                </div>
              </Link>

              <div className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] p-1 text-sm text-[var(--text-muted)]">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-full px-4 py-2 transition duration-200 hover:bg-white/[0.06] hover:text-[var(--text)]"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </nav>

          <main className="mx-auto w-full max-w-[92rem] px-6 py-10 sm:px-8 lg:px-10">{children}</main>

          <footer className="border-t border-white/6 bg-[linear-gradient(180deg,rgba(24,24,27,0.4),rgba(9,9,11,0.92))]">
            <div className="mx-auto grid w-full max-w-[92rem] gap-8 px-6 py-8 text-sm sm:px-8 lg:grid-cols-[1.4fr_1fr] lg:px-10">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <AegisMark />
                  <div>
                    <div className="text-[0.68rem] uppercase tracking-[0.28em] text-[var(--text-muted)]">
                      Powered by Council of Experts
                    </div>
                    <div className="text-base font-semibold text-[var(--text)]">
                      AEGIS for UNICC security researchers
                    </div>
                  </div>
                </div>
                <p className="max-w-2xl text-[var(--text-muted)]">
                  Adversarial evaluation for AI systems, spanning application security, LLM safety,
                  and governance assurance in a single command-center workflow.
                </p>
              </div>

              <div className="grid gap-2 text-[var(--text-muted)] sm:justify-self-end sm:text-right">
                <div className="text-[0.68rem] uppercase tracking-[0.28em] text-[var(--text-muted)]/80">
                  United Nations International Computing Centre
                </div>
                <div>Security research interface · dark operations mode</div>
                <div className="text-xs text-[var(--text-muted)]/70">
                  Council synthesis, audit-ready reporting, and institutional-grade review.
                </div>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
