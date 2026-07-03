import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CP Contester — Codeforces virtual contests",
  description:
    "On-demand Codeforces-style virtual contests built from problems you haven't solved.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
