import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = {
  title: "CP Contester — Codeforces virtual contests",
  description:
    "On-demand Codeforces virtual contests for you and friends — sample tests in-app, submit on CF, track stats.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-4xl px-4 py-6">
          <SiteHeader />
          {children}
        </main>
      </body>
    </html>
  );
}
