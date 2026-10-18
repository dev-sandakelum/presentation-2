import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk, Instrument_Sans, JetBrains_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* Slidesmith → Chassé type system: Fraunces (brand, italic) · Space Grotesk (display) · Instrument Sans (body) · JetBrains Mono (code) */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight:  "variable",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight:  "variable",
});

/* Chassé brand voice — italic Fraunces serif for the brand + titles */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: "italic",
  weight:  "variable",
});

export const metadata: Metadata = {
  title: "Chassé — slides written as code",
  description: "Chassé studio — a code-first presentation studio. A deck is a folder of TSX slides; edit, preview, present and remote-control it.",
  keywords: ["Chassé", "Chassé studio", "presentation", "slides", "TSX", "Next.js"],
  authors: [{ name: "Chassé studio" }],
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Chassé",
    description: "Slides written as code",
    url: "https://chat.z.ai",
    siteName: "Z.ai",
    type: "website",
    images: [
      {
        url: "/logo.png",
        width: 256,
        height: 256,
        alt: "Chassé Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chassé",
    description: "Slides written as code",
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12101a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      /* font variables live on <html> so :root-level --ss-f* token chains resolve */
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} ${fraunces.variable}`}
    >
      <body suppressHydrationWarning className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
