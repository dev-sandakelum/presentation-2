"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { chasseDark, chasseLight } from "./chasseTheme";

/**
 * Lazy CodeMirror wrapper — the whole editor stack lives in its own chunk
 * (dynamically imported by CodePane), keeping the dashboard's first paint
 * light. Extensions and theme resolution happen here, behind plain props.
 * The syntax palette is the Chassé studio theme (warm plum paper, amber caret).
 */

export interface CmEditorProps {
  value: string;
  theme?: "dark" | "light";
  lang?: "tsx" | "plain";
  pasteFormatExt?: unknown;
  onChange: (v: string) => void;
  onCreateEditor?: (view: EditorView) => void;
}

export default function CmEditor({
  value,
  theme = "dark",
  lang = "tsx",
  pasteFormatExt,
  onChange,
  onCreateEditor,
}: CmEditorProps) {
  const exts = useMemo(() => {
    const base = [EditorView.lineWrapping];
    if (lang === "tsx") base.push(javascript({ jsx: true, typescript: true }));
    if (pasteFormatExt) base.push(pasteFormatExt as never);
    base.push(...(theme === "light" ? chasseLight() : chasseDark()));
    return base;
  }, [lang, pasteFormatExt, theme]);

  return (
    <CodeMirror
      value={value}
      theme={theme === "light" ? "light" : "dark"}
      extensions={exts as never}
      height="100%"
      basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: false }}
      onChange={onChange}
      onCreateEditor={onCreateEditor}
    />
  );
}
