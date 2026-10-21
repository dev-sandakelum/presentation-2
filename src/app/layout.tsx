import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk, Instrument_Sans, JetBrains_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SplashController } from "@/components/stagesmith/SplashController";
import { BRAND_MARK_HTML } from "@/components/stagesmith/brandMark";

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
  weight: "variable",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: "variable",
});

/* Chassé brand voice — italic Fraunces serif for the brand + titles */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: "italic",
  weight: "variable",
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

/* ================================================================== */
/* Pre-hydration splash                                                */
/* ================================================================== */

/**
 * Runs at the very top of <body>, BEFORE the browser can paint anything:
 *   · applies the saved UI theme (localStorage "ss-ui-theme") to <html> so
 *     a dark-theme user never sees a white flash — the splash and the app
 *     paint the correct background from the very first frame;
 *   · paints the html element background directly as extra insurance while
 *     the CSS bundles are still loading;
 *   · marks the document as booting (html[data-ss-splash="on"]) so the CSS
 *     can keep #ss-app-root hidden until the splash is dismissed.
 * No network, no external file — safe offline and in the JCEF cold start.
 */
const THEME_INIT = `(function(){try{
var t=window.localStorage&&localStorage.getItem("ss-ui-theme");
var dark=!(t==="light");
var d=document.documentElement;
d.dataset.ssTheme=dark?"dark":"light";
d.dataset.ssSplash="on";
d.style.background=dark?"#12101a":"#e9e7f0";
}catch(e){}})();`;

/**
 * The splash stylesheet — inlined so it applies on the FIRST paint (before
 * the bundled CSS arrives) and works with zero network access. It is also
 * the single source of styling for EVERY splash instance: the pre-hydration
 * #ss-splash below AND the React-rendered <LoadingScreen/> overlays, which
 * render the exact same `ss-splash-*` markup through <SplashVisual/>.
 *
 * Motion rules: only transform & opacity are animated (the page can be busy
 * hydrating underneath), and prefers-reduced-motion collapses everything to
 * a static mark + plain fades.
 */
const SPLASH_CSS = `
/* ——— Chassé loading splash — inline, offline-safe, transform/opacity only ——— */
.ss-splash{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;
  background:var(--ss-bg,#12101a);color:var(--ss-ink,#efeaf7);
  font-family:var(--ss-fb,-apple-system,"Segoe UI",sans-serif);
  opacity:1;transition:opacity 300ms cubic-bezier(.22,1,.36,1);cursor:default;}
html[data-ss-theme="light"] .ss-splash{background:#e9e7f0;color:#1c1930;}
#ss-app-root[data-ss-boot]{visibility:hidden;}
.ss-splash--leaving{opacity:0!important;pointer-events:none;}
.ss-splash-inner{display:flex;flex-direction:column;align-items:center;gap:13px;padding:24px;text-align:center;}
.ss-splash-orb{position:relative;width:64px;height:64px;display:grid;place-items:center;}
.ss-splash-glow{position:absolute;inset:-42px;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,rgba(105,80,235,.30),rgba(128,73,248,.10) 46%,transparent 70%);
  animation:ss-splash-glow 2.4s ease-in-out infinite;}
html[data-ss-theme="light"] .ss-splash-glow{
  background:radial-gradient(circle,rgba(105,80,235,.22),rgba(128,73,248,.09) 46%,transparent 70%);}
.ss-splash-mark{display:block;width:64px;height:64px;will-change:transform;
  filter:drop-shadow(0 14px 30px rgba(84,64,214,.38));
  animation:ss-splash-float 2.6s ease-in-out infinite;}
html[data-ss-theme="light"] .ss-splash-mark{filter:drop-shadow(0 10px 22px rgba(84,64,214,.22));}
.ss-splash-mark img{width:100%;height:100%;display:block;border-radius:23%;
  -webkit-user-drag:none;user-select:none;}
@keyframes ss-splash-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-3px);}}
@keyframes ss-splash-glow{0%,100%{opacity:.55;transform:scale(.96);}50%{opacity:1;transform:scale(1.05);}}
.ss-splash-wordmark{font:italic 600 34px/1 var(--ss-fbrand,Georgia,"Times New Roman",serif);
  letter-spacing:-.01em;margin-top:6px;}
.ss-splash-msg{font:500 10px var(--ss-fm,ui-monospace,SFMono-Regular,Consolas,monospace);
  letter-spacing:.24em;text-transform:uppercase;color:var(--ss-mut,#9189a6);
  font-variant-numeric:tabular-nums;max-width:min(78vw,480px);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}
.ss-splash-bar{position:relative;width:220px;max-width:70vw;height:3px;border-radius:99px;
  background:rgba(127,120,150,.28);overflow:hidden;}
html[data-ss-theme="light"] .ss-splash-bar{background:rgba(98,92,122,.25);}
.ss-splash-bar-fill{position:absolute;inset:0;border-radius:inherit;
  background:linear-gradient(90deg,#4c41d4,#8049f8);
  transform-origin:0 50%;transform:scaleX(0);will-change:transform;
  transition:transform .25s cubic-bezier(.22,1,.36,1);}
.ss-splash-bar-ind{position:absolute;top:0;bottom:0;left:0;width:38%;border-radius:inherit;
  background:linear-gradient(90deg,transparent,#4c41d4 30%,#8049f8 70%,transparent);
  animation:ss-splash-sweep 1.15s cubic-bezier(.45,0,.55,1) infinite;will-change:transform;}
@keyframes ss-splash-sweep{0%{transform:translateX(-105%);}100%{transform:translateX(275%);}}
.ss-splash-error{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:min(84vw,440px);
  padding:18px 22px;border-radius:12px;text-align:center;
  background:var(--ss-errbg,rgba(120,30,50,.18));
  border:1px solid var(--ss-errline,rgba(255,122,144,.28));}
.ss-splash-error-title{font:italic 600 20px/1.2 var(--ss-fbrand,Georgia,serif);
  color:var(--ss-errink,#ffb4c0);}
.ss-splash-error-text{font:400 12.5px/1.6 var(--ss-fb,-apple-system,"Segoe UI",sans-serif);
  color:var(--ss-errink,#ffb4c0);overflow-wrap:anywhere;}
.ss-splash-retry{appearance:none;cursor:pointer;margin-top:4px;padding:9px 26px;border-radius:9px;
  border:1px solid rgba(128,73,248,.55);
  background:linear-gradient(135deg,#5b46e0,#8049f8);color:#fff;
  font:600 12.5px var(--ss-fb,-apple-system,"Segoe UI",sans-serif);letter-spacing:.04em;
  transition:transform .15s ease,box-shadow .15s ease;}
.ss-splash-retry:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(96,70,230,.42);}
.ss-splash-retry:active{transform:translateY(0);}
.ss-splash-retry:focus-visible{outline:2px solid #8049f8;outline-offset:2px;}
/* ——— present-mode long-load contract: hint (calm info), warning (soft, never red), actions, back ——— */
.ss-splash-hint{font:400 11.5px/1.5 var(--ss-fb,-apple-system,"Segoe UI",sans-serif);
  color:var(--ss-mut,#9189a6);opacity:.9;}
.ss-splash-warn{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(84vw,440px);
  margin-top:4px;padding:12px 16px;border-radius:11px;text-align:center;
  background:var(--ss-warnbg,rgba(191,141,10,.10));
  border:1px solid var(--ss-warnline,rgba(230,180,60,.30));}
.ss-splash-warn-text{font:400 12.5px/1.6 var(--ss-fb,-apple-system,"Segoe UI",sans-serif);
  color:var(--ss-warnink,#e8c268);overflow-wrap:anywhere;}
.ss-splash-actions{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;}
.ss-splash-secondary{appearance:none;cursor:pointer;padding:8px 18px;border-radius:9px;
  border:1px solid rgba(128,120,150,.45);background:transparent;
  color:var(--ss-ink,#efeaf7);font:500 12px var(--ss-fb,-apple-system,"Segoe UI",sans-serif);
  transition:background .15s ease,border-color .15s ease;}
.ss-splash-secondary:hover{background:rgba(128,120,150,.14);border-color:rgba(128,120,150,.6);}
.ss-splash-secondary:focus-visible{outline:2px solid #8049f8;outline-offset:2px;}
.ss-splash-cancel{appearance:none;cursor:pointer;margin-top:2px;padding:6px 14px;border:0;background:transparent;
  color:var(--ss-mut,#9189a6);font:500 12px var(--ss-fb,-apple-system,"Segoe UI",sans-serif);
  border-radius:8px;transition:color .15s ease,background .15s ease;}
.ss-splash-cancel:hover{color:var(--ss-ink,#efeaf7);background:rgba(128,120,150,.12);}
.ss-splash-cancel:focus-visible{outline:2px solid #8049f8;outline-offset:2px;}
html[data-ss-theme="light"] .ss-splash-warn{background:rgba(191,141,10,.08);}
html[data-ss-theme="light"] .ss-splash-warn-text{color:#8a6a10;}
html[data-ss-theme="light"] .ss-splash-secondary{color:#1c1930;}
html[data-ss-theme="light"] .ss-splash-cancel{color:#6a6480;}
html[data-ss-theme="light"] .ss-splash-cancel:hover{color:#1c1930;}
.ss-sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);
  clip-path:inset(50%);white-space:nowrap;border:0;padding:0;}
@media (prefers-reduced-motion:reduce){
  .ss-splash-mark,.ss-splash-glow,.ss-splash-bar-ind{animation:none!important;}
  .ss-splash-bar-ind{left:31%;opacity:.9;}
  .ss-splash-bar-fill{transition:none!important;}
  .ss-splash{transition:opacity 160ms linear!important;}
  .ss-splash-retry{transition:none!important;}
  .ss-splash-secondary,.ss-splash-cancel{transition:none!important;}
}
`;

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
        {/* theme-correct from the first paint — before anything is visible */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />

        {/* the splash stylesheet — inline, applies before the bundled CSS */}
        <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />

        {/*
          The pre-hydration splash: plain HTML, painted before JavaScript
          hydrates, so a cold start (incl. the desktop app) never shows a
          blank or half-built page. SplashController dismisses it once the
          app is hydrated. Markup mirrors <SplashVisual/> exactly.
        */}
        <div id="ss-splash" className="ss-splash" role="status" aria-live="polite">
          <span className="ss-sr-only">Loading</span>
          <div className="ss-splash-inner">
            <div className="ss-splash-orb">
              <span className="ss-splash-glow" aria-hidden="true" />
              <span className="ss-splash-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND_MARK_HTML }} />
            </div>
            <div className="ss-splash-wordmark">Chassé</div>
            <div className="ss-splash-msg">Loading studio</div>
            <div className="ss-splash-bar" aria-hidden="true">
              <div className="ss-splash-bar-ind" />
            </div>
          </div>
        </div>

        {/* the app itself — hidden from paint + AT until the splash lifts */}
        <div id="ss-app-root" data-ss-boot="">
          {children}
          <Toaster />
        </div>

        {/* dismisses the splash after hydration (fast loads never see it) */}
        <SplashController />
      </body>
    </html>
  );
}
