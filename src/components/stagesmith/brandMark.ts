/**
 * Chassé brand mark — the REAL logo.
 *
 * The uploaded "Chassé Logo" (fast-forward swoosh mark — two leaning
 * indigo→violet blades with lavender + coral speed streaks on a white
 * squircle badge), embedded as an optimized 192×192 / 64-color PNG data URI
 * (~4 KB) so it can be painted:
 *
 *   · in the PRE-HYDRATION splash inside app/layout.tsx — inline in the
 *     document itself, zero network requests, works fully offline and during
 *     the Java desktop app's (JCEF) cold start;
 *   · by <SplashVisual/> for every later loading surface (route fallback,
 *     Suspense boot, <LoadingScreen/> overlays) — the exact same pixels.
 *
 * Generated from the source 2000×2000 RGBA PNG (downscaled Lanczos +
 * FASTOCTREE palette quantization). 192 px = 3× the 64 px splash display
 * size, so it stays crisp on retina/HiDPI screens.
 */

/** The logo as a self-contained data URI (no network, offline-safe). */
export const BRAND_MARK_DATA_URI =
  "data:image/png;base64,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";

/**
 * The mark as plain HTML — an <img> pointing at the data URI. Injected via
 * dangerouslySetInnerHTML by the pre-hydration splash in app/layout.tsx and
 * by <SplashVisual/>, so every surface renders byte-identical markup.
 * Decorative (alt=""): the wordmark + status line carry the meaning.
 */
export const BRAND_MARK_HTML =
  `<img src="${BRAND_MARK_DATA_URI}" alt="" width="64" height="64" draggable="false" decoding="async" />`;
