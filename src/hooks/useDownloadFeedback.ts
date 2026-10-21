"use client";

import { useEffect } from "react";
import { subscribe, hasCefQuery, call } from "@/lib/stagesmith/desktop-bridge";
import { useToast } from "@/hooks/use-toast";

/**
 * useDownloadFeedback — export/download toasts for BOTH environments.
 *
 * <b>Desktop app (embedded JCEF window, ≥1.3.0)</b>: the window shows no
 * download UI of its own — Java owns a native "Save as" pipeline and pushes
 * {@code download} events over the bridge for every stage. This hook turns
 * them into toasts:
 *
 *  · started  → "Exporting <name> — choose where to save it" (the native
 *               Save dialog is opening)
 *  · completed → "Saved to <path>" with an <b>Open folder</b> action that
 *               calls the bridge's {@code openDownloadFolder}
 *  · failed   → the reason (cancelled dialog included)
 *  · progress → NOT toasted: the native dialog + the file appearing ARE the
 *               progress UI; toasting throttled percent values would spam.
 *
 * <b>Normal browser</b>: exports fire a {@code ss-export-started} DOM event
 * from the shared {@link download()} helper; this hook shows one quiet
 * "Export started" toast so the click always gives feedback.
 *
 * Mounted once by ViewsShell.
 */
export function useDownloadFeedback() {
  const { toast } = useToast();

  useEffect(() => {
    if (!hasCefQuery()) return;
    // desktop: bridge download events
    return subscribe((ev) => {
      if (ev.type !== "download") return;
      if (ev.stage === "started") {
        toast({
          title: `Exporting ${ev.fileName}`,
          description: "Choose where to save it in the dialog that just opened.",
        });
      } else if (ev.stage === "completed") {
        toast({
          title: `Saved ${ev.fileName}`,
          description: ev.path ? `Saved to ${ev.path}` : undefined,
          action: {
            label: "Open folder",
            onClick: () => {
              call("openDownloadFolder").catch(() => {
                /* the folder open failed — the toast is still correct about the save */
              });
            },
          },
        });
      } else if (ev.stage === "failed") {
        toast({
          title: `Export failed — ${ev.fileName}`,
          description: ev.error || "The download was cancelled or interrupted.",
          variant: "destructive",
        });
      }
    });
  }, [toast]);

  useEffect(() => {
    if (hasCefQuery()) return; // desktop events cover it (no double toast)
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<{ filename?: string }>).detail ?? {};
      toast({
        title: "Export started",
        description: detail.filename
          ? `${detail.filename} — check your browser downloads.`
          : "Check your browser downloads.",
      });
    };
    window.addEventListener("ss-export-started", onExport as EventListener);
    return () => window.removeEventListener("ss-export-started", onExport as EventListener);
  }, [toast]);
}
