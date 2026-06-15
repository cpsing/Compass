import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AutoRefresh } from "../components/AutoRefresh.tsx";

export const metadata: Metadata = {
  title: "Compass",
  description: "Cross-tool product memory for AI-assisted development",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-gray-800 bg-gray-950 px-6 py-3 sticky top-0 z-10">
          <div className="flex items-center gap-6 max-w-7xl mx-auto">
            <Link href="/" className="text-lg font-semibold text-white">
              Compass
            </Link>
            <span className="text-xs text-gray-500">
              v0.0.1 · local dashboard
            </span>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
        <AutoRefresh />
      </body>
    </html>
  );
}
