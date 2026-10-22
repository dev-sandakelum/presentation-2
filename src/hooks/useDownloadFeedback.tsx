"use client";

import { useEffect } from "react";
import { subscribe, hasCefQuery, call } from "@/lib/stagesmith/desktop-bridge";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

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
 * <b>Older desktop builds</b> (no download events — the user would otherwise
 * see NOTHING after an export): when the page fires {@code ss-export-started}
 * and no bridge download event arrives within ~1.2 s, the normal browser
 * toast is shown after all ("Export started — check the dialog / downloads").
 *
 * <b>Normal browser</b>: exports fire a {@code ss-export-started} DOM event
 * from the shared {@link download()} helper; this hook shows one quiet
 * "Export started" toast so the click always gives feedback.
 *
 * Mounted once by ViewsShell.
 */

/** how long to wait for a bridge download event before falling back to the
 *  plain browser toast (older desktop builds never send one) */
const BRIDGE_GRACE_MS = 1200;

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
          action: (
            <ToastAction
              altText="Open folder"
              onClick={() => {
                call("openDownloadFolder").catch(() => {
                  /* the folder open failed — the toast is still correct about the save */
                });
              }}
            >
              Open folder
            </ToastAction>
          ),
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
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<{ filename?: string }>).detail ?? {};
      const fire = () =>
        toast({
          title: "Export started",
          description: detail.filename
            ? `${detail.filename} — check your browser downloads.`
            : "Check your browser downloads.",
        });
      if (!hasCefQuery()) {
        fire();
        return;
      }
      // Inside the desktop app the bridge's native download events are the
      // better feedback (Save-as dialog + "Saved to <path>"). Older desktop
      // builds never push them — after a short grace period, show the plain
      // toast anyway so an export is never completely silent.
      let gotBridgeEvent = false;
      const unsub = subscribe((ev) => {
        if (ev.type === "download") gotBridgeEvent = true;
      });
      const t = setTimeout(() => {
        unsub();
        if (!gotBridgeEvent) fire();
      }, BRIDGE_GRACE_MS);
      // if a bridge event arrives early, stop the fallback
      const earlyUnsub = subscribe((ev) => {
        if (ev.type === "download") {
          clearTimeout(t);
          unsub();
          earlyUnsub();
        }
      });
    };
    window.addEventListener("ss-export-started", onExport as EventListener);
    return () => window.removeEventListener("ss-export-started", onExport as EventListener);
  }, [toast]);
}
