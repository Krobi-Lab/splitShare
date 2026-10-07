import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { OfflineBanner } from "@/components/pwa/offline-banner";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SplitHome",
    template: "%s · SplitHome",
  },
  description: "Share household expenses without the spreadsheet.",
  applicationName: "SplitHome",
  appleWebApp: {
    capable: true,
    title: "SplitHome",
    // The status bar is drawn over the page, so the safe-area padding below
    // keeps content clear of the notch.
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // iOS otherwise turns amounts and reference numbers into phone links.
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available: disabling it is an accessibility failure, and
  // it is not needed to make an installed app feel native.
  maximumScale: 5,
  // Lets the page paint into the notch and home-indicator areas, which the
  // safe-area insets below then account for.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <OfflineBanner />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
