"use client";

import { useState } from "react";

/**
 * Static thumbnail <img> with a shimmer placeholder while it generates.
 * Backed by /api/decks/<id>/thumb/<slide> — the server-side auto thumbnail
 * system (low-quality stills; the only live stage is the preview pane).
 */
export function ThumbImg({
  src,
  alt,
  style,
  imgStyle,
  fetchPriority,
}: {
  src: string;
  alt: string;
  style?: React.CSSProperties;
  imgStyle?: React.CSSProperties;
  fetchPriority?: "high" | "low" | "auto";
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <span className="ss-shimmer" aria-hidden />}
      <img
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        loading={fetchPriority === "high" ? "eager" : "lazy"}
        fetchPriority={fetchPriority}
        className="ss-thumb-img"
        style={{ opacity: loaded ? 1 : 0, transition: "opacity .28s ease", ...imgStyle }}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
