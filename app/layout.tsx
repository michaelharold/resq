import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResQ",
  description: "Skilled neighbours, dispatched in seconds",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#dc2626",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
        <a
          href="tel:112"
          aria-label="Call 112, emergency services"
          className="fixed right-4 bottom-4 mb-[env(safe-area-inset-bottom)] z-50 inline-flex min-h-12 items-center px-5 rounded-full bg-red-600 text-white font-semibold shadow-lg hover:bg-red-700 active:bg-red-800"
        >
          Call 112
        </a>
      </body>
    </html>
  );
}
