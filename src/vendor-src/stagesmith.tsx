/**
 * Stagesmith runtime — imported inside the Stage Runtime sandbox as `stagesmith`.
 * Provides the slide API: steps, static/thumbnail mode, theme mode,
 * assets, effects kit and brand components.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/* Store (module-level singleton, attached by the runtime bootstrap)  */
/* ------------------------------------------------------------------ */

export interface StageRuntimeState {
  step: number;
  staticMode: boolean;
  mode: "dark" | "light";
  assetBase: string;
  /** deck asset URL — never base64, always a path inside the deck (plan §9) */
  assetMap: Record<string, string> | null;
  slideIndex: number;
  slideTotal: number;
  declaredSteps: number;
  commonOverlay: React.ComponentType | null;
}

let listeners = new Set<() => void>();
let state: StageRuntimeState = {
  step: 0,
  staticMode: false,
  mode: "dark",
  assetBase: "",
  assetMap: null,
  slideIndex: 0,
  slideTotal: 0,
  declaredSteps: 1,
  commonOverlay: null,
};

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<StageRuntimeState>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof StageRuntimeState)[]) {
    if (state[k] !== patch[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...patch };
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** called by the runtime bootstrap before rendering.
 *  Subscriptions are intentionally KEPT: listeners.clear() used to sever the
 *  useSyncExternalStore subscriptions of still-mounted layers (the common
 *  overlay!) on every render config, so store-driven updates (slideIndex for
 *  progress bars, steps, …) silently stopped reaching them until the next
 *  remount. React un/subscriptions are symmetric against this same Set (it is
 *  never replaced), so leaving listeners alone is both safe and correct — the
 *  overlay keeps its own live state across slide changes. */
export function initRuntime(cfg: Partial<StageRuntimeState>) {
  state = { ...state, ...cfg, declaredSteps: 1 };
  emit();
}

export function __setStep(step: number) {
  set({ step });
}
export function __setMode(mode: "dark" | "light") {
  set({ mode });
}
export function __setStatic(staticMode: boolean) {
  set({ staticMode });
}
export function __setSlideInfo(index: number, total: number) {
  set({ slideIndex: index, slideTotal: total });
}
export function __setCommonOverlay(commonOverlay: React.ComponentType | null) {
  set({ commonOverlay });
}
export function __declareSteps(n: number) {
  if (n > state.declaredSteps) set({ declaredSteps: n });
}
export function getState() {
  return state;
}

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */

function useRuntime<T>(sel: (s: StageRuntimeState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(state),
  );
}

/**
 * Declare total steps and read the current step.
 * Step 0 = base slide, step n = everything visible.
 */
export function useStep(total?: number): number {
  const step = useRuntime((s) => s.step);
  useEffect(() => {
    if (total && total > 1) __declareSteps(total);
  }, [total]);
  return step;
}

/** true when rendered as a thumbnail / export capture — freeze animations */
export function useStatic(): boolean {
  return useRuntime((s) => s.staticMode);
}

/** current theme mode (deck default, slide override or session toggle) */
export function useMode(): "dark" | "light" {
  return useRuntime((s) => s.mode);
}

/** deck asset URL — never base64, always a path inside the deck (plan §9).
 *  Browser-stored decks pass a name → data-URL map (sandboxed iframes can't
 *  fetch parent blob/asset URLs), which wins over assetBase. */
export function asset(name: string): string {
  const clean = String(name).replace(/^\/+/, "");
  const mapped = state.assetMap ? state.assetMap[clean] : undefined;
  if (mapped) return mapped;
  return `${state.assetBase}/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

export function useSlideInfo(): { index: number; total: number } {
  // Select the two primitives SEPARATELY — a selector returning a fresh
  // object would give useSyncExternalStore an unstable snapshot and throw
  // React error #185 (maximum update depth exceeded).
  const index = useRuntime((s) => s.slideIndex);
  const total = useRuntime((s) => s.slideTotal);
  return { index, total };
}

/* ------------------------------------------------------------------ */
/* <Step at={k}>                                                      */
/* ------------------------------------------------------------------ */

export function Step({ at, children }: { at: number; children: ReactNode }) {
  const step = useRuntime((s) => s.step);
  const staticMode = useRuntime((s) => s.staticMode);
  // deps are [at] only — `children` is a fresh object every render, which
  // would re-run this effect on every pass (and with a state-writing
  // listener in the loop can spiral into React #185)
  useEffect(() => {
    if (at > 1) __declareSteps(at + 1);
  }, [at]);
  if (staticMode || step >= at) return <>{children}</>;
  return null;
}

/** Render the common overlay from inside an override */
export function Common() {
  const CommonOverlay = useRuntime((s) => s.commonOverlay);
  if (!CommonOverlay) return null;
  return <CommonOverlay />;
}

/* ------------------------------------------------------------------ */
/* <Img name='...' />                                                 */
/* ------------------------------------------------------------------ */

export function Img({
  name,
  alt = "",
  style,
  ...rest
}: { name: string; alt?: string; style?: React.CSSProperties } & Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "style"
>) {
  const [error, setError] = useState<string | null>(null);
  const src = asset(name);
  if (error) {
    return <span role="img" aria-label={`${alt || name}: ${error}`} title={`${name}: ${error}`} style={{ display: "inline-grid", placeItems: "center", gap: 6, minWidth: 120, minHeight: 72, padding: 10, border: "1px solid #b94b55", background: "rgba(120,24,32,.18)", color: "#ffb6bd", font: "12px/1.4 sans-serif", ...style }}>
      <span>{name}</span><span>{error}</span>
      <button type="button" onClick={(event) => { event.stopPropagation(); setError(null); }} style={{ cursor: "pointer" }}>Retry</button>
    </span>;
  }
  return <img src={src} alt={alt} style={style} {...rest} onError={(event) => {
    rest.onError?.(event);
    void fetch(src, { method: "HEAD", cache: "no-store" }).then((response) => {
      const code = response.headers.get("X-Chasse-Error-Code");
      setError(code === "NOT_FOUND" || response.status === 404 ? "File not found" : code === "FORBIDDEN" || response.status === 403 ? "Access denied" : `Image request failed (HTTP ${response.status})`);
    }).catch(() => setError("The browser blocked the image request"));
  }} />;
}

/* ------------------------------------------------------------------ */
/* Brand components                                                   */
/* ------------------------------------------------------------------ */

/** Hairline frame with corner ticks */
export function BrandFrame({
  inset = 18,
  color,
  strokeWidth = 1,
}: { inset?: number; color?: string; strokeWidth?: number }) {
  const c = color ?? "var(--line, rgba(128,128,128,.35))";
  return (
    <div style={{ position: "absolute", inset, pointerEvents: "none", zIndex: 30 }}>
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <rect x={strokeWidth / 2} y={strokeWidth / 2} width={`calc(100% - ${strokeWidth}px)`} height={`calc(100% - ${strokeWidth}px)`} fill="none" stroke={c} strokeWidth={strokeWidth} />
      </svg>
    </div>
  );
}

/** Crosshair marks in the four corners (as in the Next.js Unlocked deck) */
export function CornerMarks({ inset = 20, size = 15, color }: { inset?: number; size?: number; color?: string }) {
  const c = color ?? "var(--mut, rgba(128,128,128,.5))";
  const Mark = ({ x, y }: { x: "left" | "right"; y: "top" | "bottom" }) => (
    <span
      style={{
        position: "absolute",
        [x]: inset,
        [y]: inset,
        width: size,
        height: size,
        color: c,
        opacity: 0.55,
        pointerEvents: "none",
      } as React.CSSProperties}
    >
      <svg viewBox="0 0 15 15" width={size} height={size}>
        <line x1="7" y1="0" x2="7" y2="15" stroke="currentColor" strokeWidth="1" />
        <line x1="0" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1" />
      </svg>
    </span>
  );
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 35 }}>
      <Mark x="left" y="top" />
      <Mark x="right" y="top" />
      <Mark x="left" y="bottom" />
      <Mark x="right" y="bottom" />
    </div>
  );
}

/** Slide number, bottom-right */
export function SlideNumber({
  format = "{n} / {total}",
  style,
}: { format?: string; style?: React.CSSProperties }) {
  const { index, total } = useSlideInfo();
  const text = format.replace("{n}", String(index + 1)).replace("{total}", String(total));
  return (
    <div
      style={{
        position: "absolute",
        right: 34,
        bottom: 26,
        font: "500 13px var(--fm, ui-monospace, monospace)",
        letterSpacing: ".14em",
        color: "var(--mut, rgba(128,128,128,.7))",
        pointerEvents: "none",
        zIndex: 36,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Effects kit (frozen in thumbnails, reduced-motion aware)           */
/* ------------------------------------------------------------------ */

const FX_LAYER: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  overflow: "hidden",
};

export function GridLines({
  size = 64,
  color,
  opacity,
}: { size?: number; color?: string; opacity?: number }) {
  const c = color ?? "var(--grid, rgba(128,128,128,.10))";
  return (
    <div
      style={{
        ...FX_LAYER,
        opacity: opacity ?? 1,
        backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
      }}
    />
  );
}

export function Vignette({ strength = 0.3 }: { strength?: number }) {
  const mode = useMode();
  const a = strength * (mode === "light" ? 0.4 : 1);
  return (
    <div
      style={{
        ...FX_LAYER,
        background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${a}) 100%)`,
      }}
    />
  );
}

/** Warm dual glow — amber from the top, rose along the bottom edge (Chassé stage) */
export function Glow({
  colors,
  opacity = 1,
}: { colors?: [string, string]; opacity?: number }) {
  const [a, b] = colors ?? ["var(--glow, rgba(255,180,84,.16))", "var(--glow2, rgba(255,122,144,.10))"];
  return (
    <div
      style={{
        ...FX_LAYER,
        opacity,
        background: `radial-gradient(900px 520px at 50% -8%, ${a}, transparent 70%), linear-gradient(to top, ${b}, transparent 150px)`,
      }}
    />
  );
}

/** Footer strip — italic brand left, slide counter right (Chassé ov-foot) */
export function Footer({
  text = "Chassé",
  style,
}: { text?: string; style?: React.CSSProperties }) {
  const { index, total } = useSlideInfo();
  return (
    <div
      style={{
        position: "absolute",
        left: 56,
        right: 56,
        bottom: 34,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        font: `500 15px var(--fb, "Instrument Sans", sans-serif)`,
        color: "var(--mut, rgba(128,128,128,.7))",
        pointerEvents: "none",
        zIndex: 36,
        ...style,
      }}
    >
      <em style={{ font: `italic 600 20px var(--fbrand, "Fraunces", Georgia, serif)`, color: "var(--ink, #eee)" }}>{text}</em>
      <span>{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
    </div>
  );
}

/** Bottom progress bar — grows with the deck (Chassé ov-bar) */
export function Progress({
  color,
  style,
}: { color?: string; style?: React.CSSProperties }) {
  const { index, total } = useSlideInfo();
  const c = color ?? "var(--acc, #ffb454)";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        height: 4,
        width: total ? `${((index + 1) / total) * 100}%` : 0,
        background: c,
        transition: "width .4s cubic-bezier(.3,.7,.2,1)",
        pointerEvents: "none",
        zIndex: 37,
        ...style,
      }}
    />
  );
}

export function Spotlight({
  x = 50,
  y = 12,
  radius = 60,
  strength = 0.16,
}: { x?: number; y?: number; radius?: number; strength?: number }) {
  return (
    <div
      style={{
        ...FX_LAYER,
        background: `radial-gradient(${radius}% ${radius * 1.4}% at ${x}% ${y}%, rgba(255,255,255,${strength}), transparent 70%)`,
      }}
    />
  );
}

export function Aurora({
  colors,
  opacity = 0.55,
  speed = 26,
}: { colors?: [string, string, string]; opacity?: number; speed?: number }) {
  const stat = useStatic();
  const [c1, c2, c3] = colors ?? ["#4f46e5", "#0ea5e9", "#22d3ee"];
  return (
    <div style={{ ...FX_LAYER, opacity }}>
      <style>{stat ? "" : `
        @keyframes ss-aurora1 { 0%,100%{transform:translate(-12%,-8%) scale(1)} 50%{transform:translate(10%,14%) scale(1.25)} }
        @keyframes ss-aurora2 { 0%,100%{transform:translate(15%,20%) scale(1.15)} 50%{transform:translate(-16%,-10%) scale(.95)} }
        @keyframes ss-aurora3 { 0%,100%{transform:translate(6%,-16%) scale(.9)} 50%{transform:translate(-8%,10%) scale(1.2)} }
      `}</style>
      {[
        { c: c1, cls: "ss-a1", top: "-18%", left: "-10%", w: "62%", h: "70%" },
        { c: c2, cls: "ss-a2", top: "8%", right: "-14%", w: "58%", h: "64%", left: undefined },
        { c: c3, cls: "ss-a3", bottom: "-22%", left: "22%", w: "66%", h: "58%", top: undefined },
      ].map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: (b as any).top,
            left: (b as any).left,
            right: (b as any).right,
            bottom: (b as any).bottom,
            width: b.w,
            height: b.h,
            background: `radial-gradient(closest-side, ${b.c}, transparent 78%)`,
            filter: "blur(48px)",
            animation: stat ? undefined : `ss-aurora${i + 1} ${speed}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function FilmNoise({ opacity = 0.05 }: { opacity?: number }) {
  return (
    <div
      style={{
        ...FX_LAYER,
        opacity,
        mixBlendMode: "overlay",
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='.6'/%3E%3C/svg%3E\")",
        backgroundSize: "240px 240px",
      }}
    />
  );
}

export function CursorGlow({
  radius = 300,
  color = "rgba(255,255,255,.08)",
}: { radius?: number; color?: string }) {
  const stat = useStatic();
  const [pos, setPos] = useState({ x: 640, y: 360 });
  useEffect(() => {
    if (stat) return;
    const onMove = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [stat]);
  return (
    <div
      style={{
        ...FX_LAYER,
        background: `radial-gradient(${radius}px ${radius}px at ${pos.x}px ${pos.y}px, ${color}, transparent 70%)`,
        transition: "background .12s linear",
      }}
    />
  );
}

export function NeuralNet({
  nodes = 42,
  color = "rgba(140,140,170,.7)",
  line = "rgba(140,140,170,.25)",
  speed = 0.35,
  linkDist = 170,
}: { nodes?: number; color?: string; line?: string; speed?: number; linkDist?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stat = useStatic();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = 1280;
    const H = 720;
    canvas.width = W;
    canvas.height = H;
    const pts = Array.from({ length: nodes }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d = Math.hypot(dx, dy);
          if (d < linkDist) {
            ctx.strokeStyle = line;
            ctx.globalAlpha = 1 - d / linkDist;
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (stat) {
      draw();
      return;
    }
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stat, nodes, color, line, speed, linkDist]);
  return <canvas ref={ref} style={{ ...FX_LAYER, width: "100%", height: "100%" }} />;
}
