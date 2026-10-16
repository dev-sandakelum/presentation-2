import type { DeckSummary } from "@/lib/stagesmith/types";

export interface SsNav {
  library: () => void;
  deck: (id: string) => void;
  present: (id: string, from?: number) => void;
}

/** describe a source for UI labels: none / code file / image asset */
export function sourceLabel(src: unknown): string {
  const s = src as { type?: string; path?: string } | undefined | null;
  if (!s || s.type === "none") return "None";
  if (s.type === "code") return `Code · ${s.path}`;
  if (s.type === "image") return `Image · ${s.path}`;
  if (s.type === "html") return `HTML · ${s.path}`;
  return "None";
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function download(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The AI fix-prompt (plan §6 copy fix prompt) */
export function fixPrompt(file: string, code: string, error: string): string {
  return [
    "The Chassé slide below fails to compile. Fix the code and return the FULL corrected file only — no explanations.",
    "",
    "Constraints:",
    "- Keep the default export.",
    "- Allowed imports: react, react-dom/client, stagesmith, lucide-react, @/… (deck files) and relative paths.",
    "- Images: use <Img name='assets/…' /> from 'stagesmith' (never import images).",
    "",
    `Error:\n${error}`,
    "",
    `File: ${file}`,
    "```tsx",
    code,
    "```",
  ].join("\n");
}

export type { DeckSummary };
