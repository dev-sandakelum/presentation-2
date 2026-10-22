"use client";

import { useCallback, useEffect, useMemo, useState, memo } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Moon, Plus, Sun, Trash2, TriangleAlert } from "lucide-react";
import type { DeckJson, ThemeMode } from "@/lib/stagesmith/types";
import { LiveThumb } from "./LiveThumb";
import { useInView } from "./LibraryView";
import { resolveCode } from "./StageFrame";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/* ---- error string helpers (fix-list item 4) ---- */

/** first "file:line:col" location in an esbuild-style message */
function errorLineCol(msg: string): { line: number; col: number } {
  const m = msg.match(/:(\d+):(\d+)/);
  return { line: m ? parseInt(m[1], 10) : 1, col: m ? parseInt(m[2], 10) : 0 };
}

export const Filmstrip = memo(function Filmstrip(props: {
  deckId: string;
  deck: DeckJson;
  themeCss: string;
  version: string;
  selId: string | null;
  onSelect: (id: string) => void;
  onReorder: (order: string[]) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onSetTheme: (id: string, theme: ThemeMode | null) => void;
  onAdd: (opts: { template?: string; label?: string; position?: number }) => void;
  /** fix-list item 4: badge click → open slide on first error line */
  onJumpToError: (id: string, line: number, col: number) => void;
}) {
  const { deck, deckId, selId } = props;
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setErrors({});
  }, [props.version, deck.slides.map((s) => s.id).join(",")]);

  // Compile diagnostics at low priority, with bounded parallelism. The
  // selected slide preview must not queue behind every filmstrip request.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      const selectedIndex = Math.max(deck.slides.findIndex((s) => s.id === selId), 0);
      const order = [...deck.slides.slice(selectedIndex + 1), ...deck.slides.slice(0, selectedIndex)];
      let cursor = 0;
      const worker = async () => {
        while (!cancelled && cursor < order.length) {
          const s = order[cursor++];
          const meta = await resolveCode(deckId, `slides/${s.id}.tsx`, props.version, "background");
          if (meta.error) out[s.id] = meta.error;
          if (!cancelled) setErrors((prev) => (meta.error ? { ...prev, [s.id]: meta.error! } : prev));
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, deck.slides.length) }, () => worker()));
      if (!cancelled) setErrors((prev) => ({ ...prev, ...out }));
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, props.version, selId, deck.slides.map((s) => s.id).join(",")]);

  const mergedError = useCallback((id: string): string | undefined => {
    return errors[id];
  }, [errors]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = useMemo(() => (deck.slides ?? []).map((s) => s.id), [deck.slides]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    props.onReorder(next);
  }, [ids, props.onReorder]);

  return (
    <aside className="ss-filmstrip">
      <div className="ss-filmstrip-head">
        <span className="ss-label">Slides — {deck.slides.length}</span>
        <AddSlideButton onAdd={props.onAdd} count={deck.slides.length} />
      </div>
      <div className="ss-filmstrip-list ss-scroll">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {deck.slides.map((s, i) => (
              <SortableThumb
                key={s.id}
                index={i}
                deck={deck}
                deckId={deckId}
                entry={s}
                themeCss={props.themeCss}
                version={props.version}
                selected={s.id === selId}
                loadPriority={Math.abs(i - Math.max(deck.slides.findIndex((entry) => entry.id === selId), 0)) <= 1 ? "normal" : "background"}
                error={mergedError(s.id)}
                onSelect={props.onSelect}
                onDuplicate={props.onDuplicate}
                onDelete={props.onDelete}
                onRename={props.onRename}
                onSetTheme={props.onSetTheme}
                onJumpToError={props.onJumpToError}
                onThumbError={(id, message) => setErrors((prev) => prev[id] === message ? prev : ({ ...prev, [id]: message }))}
              />
            ))}
          </SortableContext>
        </DndContext>
        {deck.slides.length === 0 && (
          <div style={{ padding: "20px 6px", font: "400 12px var(--ss-sans)", color: "var(--ss-mut)", textAlign: "center" }}>
            No slides — add one from a template.
          </div>
        )}
      </div>
    </aside>
  );
});

function AddSlideButton({
  onAdd,
  count,
}: {
  onAdd: (opts: { template?: string; label?: string; position?: number }) => void;
  count: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="ss-btn ss-btn-acc" style={{ height: 24, padding: "0 9px", gap: 5 }} title="Add slide">
          <Plus size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent style={{ background: "var(--ss-panel2)", borderColor: "var(--ss-line-strong)", color: "var(--ss-ink)" }} side="right" align="start">
        {[
          ["title", "Title"],
          ["section", "Section"],
          ["bullets", "Bullets (steps)"],
          ["code", "Code"],
          ["quote", "Quote"],
          ["end", "End"],
        ].map(([key, label]) => (
          <DropdownMenuItem key={key} onClick={() => onAdd({ template: key, position: count })}>
            <Plus size={13} /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Memoized — only re-renders when its own slide's props actually change */
const SortableThumb = memo(function SortableThumb(props: {
  index: number;
  deck: DeckJson;
  deckId: string;
  entry: DeckJson["slides"][number];
  themeCss: string;
  version: string;
  selected: boolean;
  loadPriority: "normal" | "background";
  error?: string;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onSetTheme: (id: string, theme: ThemeMode | null) => void;
  onJumpToError: (id: string, line: number, col: number) => void;
  onThumbError: (id: string, message: string) => void;
}) {
  const { entry, deckId, deck, index, selected, error } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const { ref, inView } = useInView<HTMLDivElement>();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entry.label);

  // fix-list item 5: the dot means a *background* override — nothing else
  const hasBgOverride = Boolean(entry.bg && entry.bg.type !== "none");
  const onSelect = useCallback(() => props.onSelect(entry.id), [entry.id, props.onSelect]);
  const onDuplicate = useCallback(() => props.onDuplicate(entry.id), [entry.id, props.onDuplicate]);
  const onDelete = useCallback(() => props.onDelete(entry.id), [entry.id, props.onDelete]);
  const onJumpToError = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const { line, col } = errorLineCol(error ?? "");
      props.onJumpToError(entry.id, line, col);
    },
    [entry.id, error, props.onJumpToError],
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, opacity: isDragging ? 0.85 : 1 }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={ref}
            className={`ss-thumb-item ${selected ? "sel" : ""}`}
            onClick={onSelect}
            title={entry.label}
          >
            <div className="ss-thumb">
              {inView ? (
                <LiveThumb
                  deckId={deckId}
                  slideId={entry.id}
                  slideTheme={entry.theme}
                  deckDefaultMode={deck.settings.defaultMode}
                  deckBg={deck.bg}
                  deckOverlay={deck.overlay}
                  themeCss={props.themeCss}
                  version={props.version}
                  loadPriority={props.loadPriority}
                  onError={(message) => props.onThumbError(entry.id, message)}
                />
              ) : (
                <span className="ss-shimmer" aria-hidden />
              )}
              <span className="ss-thumb-num">{String(index + 1).padStart(2, "0")}</span>
              {error && (
                <button
                  className="ss-thumb-err"
                  style={{ right: hasBgOverride ? 30 : 6 }}
                  title={`${error}\n— click to open the first error line`}
                  aria-label={`Slide error: ${error}`}
                  onClick={onJumpToError}
                >
                  <TriangleAlert size={12} />
                </button>
              )}
              {hasBgOverride && <span className="ss-thumb-dot" style={{ right: 6 }} title="Background override" />}
              <div className="ss-thumb-acts">
                <span
                  className="ss-thumb-act"
                  title="Drag to reorder"
                  {...attributes}
                  {...listeners}
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: "grab" }}
                >
                  <GripVertical size={13} />
                </span>
                <span
                  className="ss-thumb-act"
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                  }}
                >
                  <Copy size={12} />
                </span>
                <span
                  className="ss-thumb-act del"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <Trash2 size={12} />
                </span>
              </div>
              {renaming && (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    setRenaming(false);
                    if (draft.trim() && draft !== entry.label) props.onRename(entry.id, draft.trim());
                    else setDraft(entry.label);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      setDraft(entry.label);
                      setRenaming(false);
                    }
                  }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 5,
                    background: "rgba(0,0,0,.85)",
                    border: "1px solid var(--ss-acc)",
                    borderRadius: 9,
                    color: "#fff",
                    font: "500 12px var(--ss-sans)",
                    padding: "0 10px",
                    outline: "none",
                  }}
                />
              )}
            </div>
            {/* caption BELOW the frame — never overlaps the live preview */}
            <div className="ss-thumb-cap">{entry.label}</div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setRenaming(true)}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={onDuplicate}>
            <Copy size={13} /> Duplicate
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Slide theme</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => props.onSetTheme(entry.id, null)}>
                Use deck default ({deck.settings.defaultMode})
              </ContextMenuItem>
              <ContextMenuItem onClick={() => props.onSetTheme(entry.id, "dark")}>
                <Moon size={13} /> Force dark
              </ContextMenuItem>
              <ContextMenuItem onClick={() => props.onSetTheme(entry.id, "light")}>
                <Sun size={13} /> Force light
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            style={{ color: "var(--ss-danger)" }}
            onClick={onDelete}
          >
            <Trash2 size={13} /> Delete slide
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
});
