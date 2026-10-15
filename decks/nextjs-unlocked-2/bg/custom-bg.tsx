import React, { useEffect, useRef } from "react";

/**
 * Flowing Silk Waves — ambient corporate background (seamless 48 s loop).
 *
 * - Every wave is sin(2π·k·u − (2π/T)·n·t + φ) with integer n > 0, so the
 *   silk drifts left → right and the scene repeats exactly every T seconds.
 * - Top ribbons and bottom ribbons breathe in opposite phase.
 * - A soft elliptical veil keeps the centre clear for copy; a fixed
 *   micro-grain layer prevents banding in the pastel gradients.
 *
 * Usage: <SilkWaves /> fills the viewport (position: fixed). Pass `style` /
 * `className` to override, e.g. style={{ position: "absolute" }} to fill a
 * positioned parent instead.
 */

type ColorStop = [pos: number, r: number, g: number, b: number, a: number];

interface Glint {
  vf: number;
  m: number;
  off: number;
}

interface RibbonDef {
  id: string;
  side: -1 | 1;
  base: number;
  A1: number;
  ph1: number;
  n1: number;
  A2: number;
  ph2: number;
  n2: number;
  w0: number;
  phw: number;
  g: ColorStop[];
  hl: number;
  lh: number;
  glint?: Glint;
}

interface Ribbon extends RibbonDef {
  top: Float32Array;
  bot: Float32Array;
  grad: CanvasGradient;
  sheenPh: number;
}

interface FlareDef {
  id: string;
  n: number;
  ph: number;
  s: number;
}

const T = 48;
const TAU = Math.PI * 2;
const OM = TAU / T;
const X0 = -30;

const DEFS: RibbonDef[] = [
  {
    id: "t3",
    side: -1,
    base: 0.17,
    A1: 0.08,
    ph1: 1.3,
    n1: 2,
    A2: 0.028,
    ph2: 0.4,
    n2: 5,
    w0: 0.07,
    phw: 1.0,
    g: [
      [0, 196, 220, 250, 0.52],
      [0.55, 208, 226, 252, 0.4],
      [1, 186, 172, 240, 0.44],
    ],
    hl: 0.35,
    lh: 0.35,
  },
  {
    id: "b3",
    side: 1,
    base: 0.9,
    A1: 0.07,
    ph1: -0.2,
    n1: 3,
    A2: 0.022,
    ph2: 2.0,
    n2: 7,
    w0: 0.085,
    phw: 2.4,
    g: [
      [0, 202, 218, 250, 0.46],
      [0.5, 190, 218, 251, 0.4],
      [1, 168, 208, 250, 0.56],
    ],
    hl: 0.3,
    lh: 0.3,
  },
  {
    id: "m",
    side: 1,
    base: 0.68,
    A1: 0.07,
    ph1: -1.0,
    n1: 3,
    A2: 0.018,
    ph2: 1.2,
    n2: 7,
    w0: 0.045,
    phw: 0.3,
    g: [
      [0, 166, 204, 249, 0.46],
      [0.5, 205, 226, 252, 0.26],
      [1, 184, 214, 250, 0.32],
    ],
    hl: 0.35,
    lh: 0.4,
  },
  {
    id: "t2",
    side: -1,
    base: 0.13,
    A1: 0.095,
    ph1: 1.7,
    n1: 2,
    A2: 0.022,
    ph2: 2.1,
    n2: 4,
    w0: 0.055,
    phw: 3.2,
    g: [
      [0, 143, 184, 246, 0.62],
      [0.5, 164, 202, 249, 0.46],
      [1, 162, 150, 238, 0.6],
    ],
    hl: 0.55,
    lh: 0.45,
  },
  {
    id: "b2",
    side: 1,
    base: 0.86,
    A1: 0.12,
    ph1: -0.94,
    n1: 3,
    A2: 0.022,
    ph2: 0.9,
    n2: 7,
    w0: 0.058,
    phw: 1.6,
    g: [
      [0, 112, 148, 238, 0.84],
      [0.15, 150, 148, 240, 0.7],
      [0.3, 176, 160, 242, 0.6],
      [0.6, 176, 208, 250, 0.46],
      [1, 146, 190, 248, 0.64],
    ],
    hl: 0.8,
    lh: 0.7,
    glint: { vf: 1 / 20, m: 6, off: 0 },
  },
  {
    id: "t1",
    side: -1,
    base: 0.09,
    A1: 0.085,
    ph1: 1.88,
    n1: 2,
    A2: 0.018,
    ph2: 3.0,
    n2: 5,
    w0: 0.046,
    phw: 2.2,
    g: [
      [0, 146, 190, 248, 0.66],
      [0.5, 170, 206, 250, 0.42],
      [1, 168, 142, 232, 0.66],
    ],
    hl: 0.85,
    lh: 0.6,
    glint: { vf: 1 / 20, m: 5, off: 300 },
  },
  {
    id: "b1",
    side: 1,
    base: 0.83,
    A1: 0.125,
    ph1: -0.62,
    n1: 3,
    A2: 0.018,
    ph2: 2.6,
    n2: 7,
    w0: 0.03,
    phw: 0.8,
    g: [
      [0, 160, 156, 240, 0.6],
      [0.5, 182, 212, 250, 0.4],
      [1, 148, 194, 250, 0.66],
    ],
    hl: 0.9,
    lh: 0.55,
    glint: { vf: 1 / 20, m: 8, off: 620 },
  },
];

const FLARES: FlareDef[] = [
  { id: "b1", n: 1, ph: 0.2, s: 0.04 },
  { id: "t1", n: 1, ph: 0.7, s: 0.034 },
];

const frac = (n: number) => n - Math.floor(n);

/** Static fallback, visible until the canvas paints (or if canvas is unavailable). */
const FALLBACK_BG = [
  "radial-gradient(ellipse 55% 18% at 45% 4%, rgba(143,184,246,.55), rgba(143,184,246,0))",
  "radial-gradient(ellipse 45% 20% at 22% 98%, rgba(112,148,238,.55), rgba(160,150,240,0))",
  "radial-gradient(ellipse 45% 20% at 90% 80%, rgba(150,195,250,.50), rgba(150,195,250,0))",
  "radial-gradient(ellipse 70% 60% at 50% 50%, #f8fcff 0%, #eaf4fe 45%, #d2e5fa 80%, #bcd6f6 100%)",
].join(", ");

export interface SilkWavesProps {
  className?: string;
  style?: React.CSSProperties;
}

export default function SilkWaves({ className, style }: SilkWavesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return; // CSS fallback stays visible

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let N = 100;
    let step = 1;
    let rafId = 0;
    let bgGrad!: CanvasGradient;
    let glowGrad!: CanvasGradient;
    let veilGrad!: CanvasGradient;
    let grain: CanvasPattern | null = null;
    const ribbons: Ribbon[] = [];
    const rb: Record<string, Ribbon> = {};

    function makeGrain(): CanvasPattern | null {
      const tile = document.createElement("canvas");
      tile.width = tile.height = 128;
      const tc = tile.getContext("2d");
      if (!tc) return null;
      const id = tc.createImageData(128, 128);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i + 1] = d[i + 2] = (Math.random() * 255) | 0;
        d[i + 3] = 6; // ~2% alpha: invisible, but breaks up banding
      }
      tc.putImageData(id, 0, 0);
      return ctx!.createPattern(tile, "repeat");
    }

    function resize() {
      W = Math.max(1, window.innerWidth || 960);
      H = Math.max(1, window.innerHeight || 540);
      cv!.width = Math.round(W * DPR);
      cv!.height = Math.round(H * DPR);
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx!.lineJoin = "round";
      ctx!.lineCap = "round";

      N = Math.max(90, Math.min(300, Math.round(W / 8)));
      step = (W + 60) / N;

      ribbons.length = 0;
      DEFS.forEach((def, a) => {
        const grad = ctx!.createLinearGradient(0, 0, W, 0);
        def.g.forEach(([pos, r, g, b, al]) => {
          grad.addColorStop(pos, `rgba(${r},${g},${b},${al})`);
        });
        const q: Ribbon = {
          ...def,
          top: new Float32Array(N + 1),
          bot: new Float32Array(N + 1),
          grad,
          sheenPh: (a * 0.157) % 1,
        };
        ribbons.push(q);
        rb[q.id] = q;
      });

      const r = 0.62 * Math.hypot(W, H);
      bgGrad = ctx!.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, r);
      bgGrad.addColorStop(0.0, "#f8fcff");
      bgGrad.addColorStop(0.35, "#eaf4fe");
      bgGrad.addColorStop(0.7, "#d2e5fa");
      bgGrad.addColorStop(1.0, "#bcd6f6");

      glowGrad = ctx!.createRadialGradient(
        W / 2,
        H * 0.5,
        0,
        W / 2,
        H * 0.5,
        0.55 * Math.max(W * 0.8, H),
      );
      glowGrad.addColorStop(0.0, "rgba(255,255,255,.90)");
      glowGrad.addColorStop(0.6, "rgba(255,255,255,.40)");
      glowGrad.addColorStop(1.0, "rgba(255,255,255,0)");

      // Unit-circle veil, stretched to an ellipse at draw time: keeps the centre clear
      veilGrad = ctx!.createRadialGradient(0, 0, 0, 0, 0, 1);
      veilGrad.addColorStop(0.0, "rgba(249,253,255,.98)");
      veilGrad.addColorStop(0.6, "rgba(249,253,255,.95)");
      veilGrad.addColorStop(0.82, "rgba(249,253,255,.50)");
      veilGrad.addColorStop(1.0, "rgba(249,253,255,0)");

      grain = makeGrain();
      if (reduced) draw(10);
    }

    function drawRibbon(q: Ribbon, t: number) {
      const { top, bot } = q;
      let minY = 1e9;
      let maxY = -1e9;

      // counter-motion: top and bottom groups breathe and bob in opposite phase
      const amp = 1 + 0.22 * Math.sin(OM * t + q.side * 1.5708);
      const bob = -q.side * 0.012 * Math.sin(OM * t + 0.6);
      const nw = q.side < 0 ? 3 : 4;

      for (let i = 0; i <= N; i++) {
        const u = (X0 + i * step) / W;
        const spine =
          q.base +
          bob +
          q.A1 * amp * Math.sin(TAU * u - OM * q.n1 * t + q.ph1) +
          q.A2 * Math.sin(TAU * 2 * u - OM * q.n2 * t + q.ph2);
        const hw = q.w0 * (1 + 0.5 * Math.sin(TAU * u - OM * nw * t + q.phw));
        top[i] = (spine - hw) * H;
        bot[i] = (spine + hw) * H;
        if (top[i] < minY) minY = top[i];
        if (bot[i] > maxY) maxY = bot[i];
      }

      const fill = new Path2D();
      const eu = new Path2D();
      const el = new Path2D();
      for (let i = 0; i <= N; i++) {
        const x = X0 + i * step;
        if (i === 0) {
          fill.moveTo(x, top[i]);
          eu.moveTo(x, top[i]);
          el.moveTo(x, bot[i]);
        } else {
          fill.lineTo(x, top[i]);
          eu.lineTo(x, top[i]);
          el.lineTo(x, bot[i]);
        }
      }
      for (let i = N; i >= 0; i--) fill.lineTo(X0 + i * step, bot[i]);
      fill.closePath();

      ctx!.fillStyle = q.grad;
      ctx!.fill(fill);

      // glass-like shading across the ribbon + a sheen sweeping left → right
      ctx!.save();
      ctx!.clip(fill);
      const vg = ctx!.createLinearGradient(0, minY, 0, maxY);
      vg.addColorStop(0, "rgba(255,255,255,.04)");
      vg.addColorStop(1, "rgba(255,255,255,.30)");
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, minY, W, maxY - minY);
      const xc = (frac(t / T + q.sheenPh) * 1.8 - 0.4) * W;
      const sg = ctx!.createLinearGradient(xc - 0.28 * W, 0, xc + 0.28 * W, 0);
      sg.addColorStop(0, "rgba(255,255,255,0)");
      sg.addColorStop(0.5, "rgba(255,255,255,.16)");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx!.fillStyle = sg;
      ctx!.fillRect(xc - 0.3 * W, minY, 0.6 * W, maxY - minY);
      ctx!.restore();

      // specular edges: soft white light on the lower edge, fine blue hairline + white core on the upper
      ctx!.strokeStyle = `rgba(255,255,255,${(q.lh * 0.22).toFixed(3)})`;
      ctx!.lineWidth = 7;
      ctx!.stroke(el);
      ctx!.strokeStyle = `rgba(255,255,255,${q.lh})`;
      ctx!.lineWidth = 1.2;
      ctx!.stroke(el);
      ctx!.strokeStyle = `rgba(255,255,255,${(q.hl * 0.25).toFixed(3)})`;
      ctx!.lineWidth = 6;
      ctx!.stroke(eu);
      ctx!.strokeStyle = `rgba(116,142,226,${(q.hl * 0.55).toFixed(3)})`;
      ctx!.lineWidth = 1;
      ctx!.stroke(eu);
      ctx!.strokeStyle = `rgba(255,255,255,${(q.hl * 0.55).toFixed(3)})`;
      ctx!.lineWidth = 0.8;
      ctx!.stroke(eu);

      // glints travelling along the edge, left → right
      if (q.glint) {
        const v = W * q.glint.vf;
        const per = (v * T) / q.glint.m;
        ctx!.setLineDash([per * 0.14, per * 0.86]);
        ctx!.lineDashOffset = -v * t + q.glint.off;
        const pulse = 0.35 + 0.25 * Math.sin((TAU * 2 * t) / T + q.ph1);
        ctx!.strokeStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
        ctx!.lineWidth = 2.2;
        ctx!.stroke(eu);
        ctx!.setLineDash([]);
      }
    }

    // soft lens flare gliding left → right along a ribbon's upper edge
    function drawFlare(f: FlareDef, t: number) {
      const arr = rb[f.id].top;
      const p = frac((f.n * t) / T + f.ph);
      const e = Math.pow(Math.sin(Math.PI * p), 1.6);
      if (e < 0.015) return;
      const x = -0.08 * W + p * 1.16 * W;
      const fi = Math.max(0, Math.min(N - 1, (x - X0) / step));
      const i0 = Math.floor(fi);
      const y = arr[i0] + (arr[i0 + 1] - arr[i0]) * (fi - i0);
      const s = f.s * Math.min(H, (W * 9) / 16);

      let g = ctx!.createRadialGradient(x, y, 0, x, y, s * 3.4);
      g.addColorStop(0, `rgba(215,232,255,${(0.16 * e).toFixed(3)})`);
      g.addColorStop(1, "rgba(215,232,255,0)");
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(x, y, s * 3.4, 0, TAU);
      ctx!.fill();

      g = ctx!.createRadialGradient(x, y, 0, x, y, s * 0.9);
      g.addColorStop(0, `rgba(255,255,255,${(0.8 * e).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(240,248,255,${(0.28 * e).toFixed(3)})`);
      g.addColorStop(1, "rgba(240,248,255,0)");
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(x, y, s * 0.9, 0, TAU);
      ctx!.fill();

      ctx!.save();
      ctx!.translate(x, y);
      ctx!.scale(11, 0.055);
      g = ctx!.createRadialGradient(0, 0, 0, 0, 0, s * 0.6);
      g.addColorStop(0, `rgba(240,248,255,${(0.55 * e).toFixed(3)})`);
      g.addColorStop(1, "rgba(240,248,255,0)");
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(0, 0, s * 0.6, 0, TAU);
      ctx!.fill();
      ctx!.restore();
    }

    function draw(t: number) {
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.setLineDash([]);
      ctx!.fillStyle = bgGrad;
      ctx!.fillRect(0, 0, W, H);
      ctx!.fillStyle = glowGrad;
      ctx!.fillRect(0, 0, W, H);

      for (const q of ribbons) drawRibbon(q, t);

      // clean copy space: soft elliptical veil over the centre
      ctx!.save();
      ctx!.translate(W / 2, H * 0.5);
      ctx!.scale(W * 0.6, H * 0.46);
      ctx!.fillStyle = veilGrad;
      ctx!.fillRect(-1, -1, 2, 2);
      ctx!.restore();

      ctx!.globalCompositeOperation = "lighter";
      for (const f of FLARES) drawFlare(f, t);
      ctx!.globalCompositeOperation = "source-over";

      // fixed micro-grain at device resolution (anti-banding, no flicker)
      if (grain) {
        ctx!.save();
        ctx!.setTransform(1, 0, 0, 1, 0, 0);
        ctx!.fillStyle = grain;
        ctx!.fillRect(0, 0, cv!.width, cv!.height);
        ctx!.restore();
      }
    }

    function frame(now: number) {
      try {
        if (Math.round(window.innerWidth) !== W || Math.round(window.innerHeight) !== H) resize();
        draw((now / 1000) % T);
        rafId = requestAnimationFrame(frame);
      } catch {
        cv!.style.display = "none";
      }
    }

    try {
      window.addEventListener("resize", resize);
      resize();
      if (!reduced) rafId = requestAnimationFrame(frame);
    } catch {
      cv.style.display = "none";
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: FALLBACK_BG,
        ...style,
      }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
