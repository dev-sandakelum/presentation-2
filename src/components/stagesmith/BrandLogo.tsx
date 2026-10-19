import Image from "next/image";
import { BRAND_MARK_DATA_URI } from "./brandMark";

/**
 * Chassé brand mark — the REAL logo (fast-forward swoosh mark on its white
 * squircle badge).
 *
 * All app headers (library top bar, editor top bar, present chrome) render
 * this mark, and the animated loading screen (splash / LoadingScreen) shows
 * the exact same logo — one mark, everywhere.
 *
 * Kept server-safe (no "use client", no hooks): importable from server
 * components (layout / loading.tsx) and client views alike.
 */

export interface BrandLogoProps {
  size?: number;
  /** render the /logo.png image via next/image instead of the inline data URI */
  showImage?: boolean;
}

export function BrandLogo({ size = 23, showImage = false }: BrandLogoProps) {
  if (showImage) {
    return (
      <Image
        src="/logo.png"
        alt="Chassé Logo"
        width={size}
        height={size}
        quality={95}
        priority
        style={{
          display: "block",
          width: size,
          height: size,
        }}
      />
    );
  }

  // The default: the real logo, inlined as a data URI — zero network
  // requests, instant paint, works fully offline (JCEF cold start safe).
  return (
    <img
      src={BRAND_MARK_DATA_URI}
      alt="Chassé Logo"
      width={size}
      height={size}
      draggable={false}
      style={{ display: "block", width: size, height: size }}
    />
  );
}
