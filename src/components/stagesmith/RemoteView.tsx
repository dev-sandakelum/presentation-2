"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Smartphone } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api } from "@/lib/stagesmith/client";
import type { DeckJson } from "@/lib/stagesmith/types";
import { useSync } from "@/hooks/useSync";

/**
 * Phone remote (plan §7): dark, mobile-first. Status badge, current slide,
 * big Prev/Next, slide list, collapsible notes, footer with all decks.
 * Control requires the deck token (server-enforced).
 */
export function RemoteView({ deckId, token }: { deckId: string; token: string | null }) {
  const [deck, setDeck] = useState<DeckJson | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [host, setHost] = useState<string>("stagesmith");

  useEffect(() => {
    setHost(window.location.host);
  }, []);
  const sync = useSync(deckId, "remote", token, undefined);
  const state = sync.state;
  const slides = useMemo(() => deck?.slides ?? state?.order ?? [], [deck, state?.order]);
  const index = Math.max(0, Math.min(state?.index ?? 0, Math.max(0, slides.length - 1)));
  const current = slides[index] ?? null;
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    api.getDeck(deckId).then((b) => setDeck(b.deck)).catch(() => {});
  }, [deckId]);

  // notes for the current slide
  useEffect(() => {
    if (!current?.id) return setNotes("");
    api.readFile(deckId, `notes/${current.id}.md`).then(setNotes).catch(() => setNotes(""));
  }, [deckId, current?.id]);

  // keep the active row scrolled into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index]);

  const status = !sync.connected ? "off" : sync.connected && !state ? "connecting" : "live";
  const statusLabel = status === "off" ? "offline" : status === "connecting" ? "connecting" : "live";
  const progress = slides.length ? ((index + 1) / slides.length) * 100 : 0;

  return (
    <div className="ss-remote">
      <header className="ss-remote-head">
        <div className={`ss-remote-status ${status}`}>
          <span className="dot" />
          {statusLabel}
          {sync.error && <span style={{ color: "#f26d6d", textTransform: "none", letterSpacing: 0 }}> · {sync.error}</span>}
        </div>
        <div className="ss-remote-title">{current?.label ?? (deck?.title ?? deckId)}</div>
        <div className="ss-remote-counter">
          {String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          {(state?.steps ?? 1) > 1 ? ` · step ${state!.step + 1}/${state!.steps}` : ""}
        </div>
        <div className="ss-remote-progress">
          <div style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="ss-remote-nav">
        <button
          className="ss-remote-btn prev"
          onClick={() => sync.sendNav("prev")}
          disabled={index === 0 && (state?.step ?? 0) === 0}
          aria-label="Previous"
        >
          <ChevronLeft size={34} strokeWidth={1.6} />
        </button>
        <button className="ss-remote-btn next" onClick={() => sync.sendNav("next")} aria-label="Next">
          <ChevronRight size={34} strokeWidth={1.6} />
        </button>
      </div>

      <div className="ss-remote-list ss-scroll" ref={listRef}>
        {slides.map((s, i) => (
          <button
            key={s.id}
            ref={i === index ? activeRef : undefined}
            className={`ss-rslide ${i === index ? "cur" : ""}`}
            onClick={() => sync.sendSlide(s.id, 0)}
          >
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <span>
              <div className="t">{s.label}</div>
            </span>
          </button>
        ))}
      </div>

      {notes.trim() && (
        <div className="ss-remote-notes">
          <details>
            <summary>Notes — {current?.label ?? ""}</summary>
            <div className="md">
              <ReactMarkdown>{notes}</ReactMarkdown>
            </div>
          </details>
        </div>
      )}

      <footer className="ss-remote-foot">
        <a href="/?view=library">
          <Smartphone size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
          All decks
        </a>
        <span>
          {host} · {deckId}
        </span>
      </footer>
    </div>
  );
}
