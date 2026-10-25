import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import PrivacyCookieNotices from "@/components/PrivacyCookieNotices";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "TrustVault — Your documents. Your control.", template: "%s | TrustVault" },
  description: "Share sensitive documents with deliberate access controls and an auditable record of important activity.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}><body><ClerkProvider><div className="site-shell">{children}</div><PrivacyCookieNotices /></ClerkProvider></body></html>;
}
