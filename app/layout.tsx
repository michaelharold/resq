import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// One family for the whole product. Plus Jakarta Sans is geometric and round like the reference, and it has a
// true italic — which the display headline uses on its second line as the single typographic flourish.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400","500","600","700","800"], variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: "ResQ",
  description: "Skilled neighbours, dispatched in seconds",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1E3A5F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
