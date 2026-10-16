import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * Chassé studio editor theme — warm plum paper with amber caret.
 *
 * Syntax (dark):
 *   keywords #ff8fa3 · strings #9be3b8 · JSX tags #ffc77a ·
 *   numbers #8fc5ff · comments #6c6585 (italic) · punctuation #9189a6
 * Light mirrors the palette: #b4234a / #16764a / #a24a00 / #1558b0 /
 * #9a95b0 / #625c7a.
 */

const FAMILY = `var(--ss-fm, "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace)`;

/* ---------------- dark ---------------- */

const chasseDarkTheme: Extension = EditorView.theme(
  {
    "&": {
      color: "#efeaf7",
      backgroundColor: "var(--ss-panel, #1a1723)",
      fontFamily: FAMILY,
      fontSize: "12.5px",
      lineHeight: "1.6",
      tabSize: 2,
    },
    ".cm-content": { caretColor: "#ffb454", padding: "10px 0" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeft: "2px solid #ffb454",
      borderRight: "none",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "rgba(255, 180, 84, 0.14)" },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
    ".cm-gutters": {
      backgroundColor: "var(--ss-panel, #1a1723)",
      color: "#5f587a",
      border: "none",
      borderRight: "1px solid #2e2a3c",
    },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255, 255, 255, 0.03)", color: "#9189a6" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 10px", minWidth: "26px" },
    ".cm-foldGutter .cm-gutterElement": { padding: "0 4px" },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(255, 180, 84, 0.14)",
      border: "1px solid #3b3650",
      color: "#9189a6",
      borderRadius: "4px",
      padding: "0 6px",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "rgba(255, 180, 84, 0.18)",
      outline: "none",
    },
    ".cm-selectionMatch": { backgroundColor: "rgba(255, 180, 84, 0.1)" },
    ".cm-tooltip": {
      backgroundColor: "#211e2d",
      border: "1px solid #3b3650",
      borderRadius: "8px",
      color: "#efeaf7",
      boxShadow: "0 18px 50px rgba(0, 0, 0, 0.45)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "rgba(255, 180, 84, 0.14)", color: "#efeaf7" },
    ".cm-searchMatch": { backgroundColor: "rgba(255, 180, 84, 0.16)" },
    ".cm-searchMatch-selected": { backgroundColor: "rgba(255, 180, 84, 0.3)" },
    ".cm-highlightField": { border: "1px solid #3b3650" },
  },
  { dark: true },
);

const chasseDarkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword], color: "#ff8fa3" },
  { tag: [t.bool, t.null, t.self, t.atom], color: "#ff8fa3" },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: "#9be3b8" },
  { tag: [t.number, t.integer, t.float, t.unit], color: "#8fc5ff" },
  { tag: [t.tagName, t.className, t.attributeName], color: "#ffc77a" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#6c6585", fontStyle: "italic" },
  { tag: [t.punctuation, t.bracket, t.paren, t.brace, t.angleBracket, t.separator, t.operator, t.derefOperator], color: "#9189a6" },
  { tag: [t.meta, t.processingInstruction], color: "#6c6585" },
  { tag: [t.labelName, t.definition(t.propertyName)], color: "#ffc77a" },
  { tag: t.invalid, color: "#ff7a90", textDecoration: "underline wavy rgba(255, 122, 144, 0.6)" },
  { tag: t.link, color: "#8fc5ff", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
]);

export function chasseDark(): Extension[] {
  return [chasseDarkTheme, syntaxHighlighting(chasseDarkHighlight)];
}

/* ---------------- light ---------------- */

const chasseLightTheme: Extension = EditorView.theme(
  {
    "&": {
      color: "#1c1930",
      backgroundColor: "var(--ss-panel, #f7f6fb)",
      fontFamily: FAMILY,
      fontSize: "12.5px",
      lineHeight: "1.6",
      tabSize: 2,
    },
    ".cm-content": { caretColor: "#c75a00", padding: "10px 0" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeft: "2px solid #c75a00",
      borderRight: "none",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "rgba(199, 90, 0, 0.12)" },
    ".cm-activeLine": { backgroundColor: "rgba(40, 30, 90, 0.035)" },
    ".cm-gutters": {
      backgroundColor: "var(--ss-panel, #f7f6fb)",
      color: "#9a95b0",
      border: "none",
      borderRight: "1px solid #d8d5e4",
    },
    ".cm-activeLineGutter": { backgroundColor: "rgba(40, 30, 90, 0.035)", color: "#625c7a" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 10px", minWidth: "26px" },
    ".cm-foldGutter .cm-gutterElement": { padding: "0 4px" },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(199, 90, 0, 0.11)",
      border: "1px solid #c4c0d6",
      color: "#625c7a",
      borderRadius: "4px",
      padding: "0 6px",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "rgba(199, 90, 0, 0.16)",
      outline: "none",
    },
    ".cm-selectionMatch": { backgroundColor: "rgba(199, 90, 0, 0.1)" },
    ".cm-tooltip": {
      backgroundColor: "#ffffff",
      border: "1px solid #c4c0d6",
      borderRadius: "8px",
      color: "#1c1930",
      boxShadow: "0 18px 50px rgba(40, 30, 80, 0.16)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "rgba(199, 90, 0, 0.11)", color: "#1c1930" },
    ".cm-searchMatch": { backgroundColor: "rgba(199, 90, 0, 0.12)" },
    ".cm-searchMatch-selected": { backgroundColor: "rgba(199, 90, 0, 0.26)" },
    ".cm-highlightField": { border: "1px solid #c4c0d6" },
  },
  { dark: false },
);

const chasseLightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword], color: "#b4234a" },
  { tag: [t.bool, t.null, t.self, t.atom], color: "#b4234a" },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: "#16764a" },
  { tag: [t.number, t.integer, t.float, t.unit], color: "#1558b0" },
  { tag: [t.tagName, t.className, t.attributeName], color: "#a24a00" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#9a95b0", fontStyle: "italic" },
  { tag: [t.punctuation, t.bracket, t.paren, t.brace, t.angleBracket, t.separator, t.operator, t.derefOperator], color: "#625c7a" },
  { tag: [t.meta, t.processingInstruction], color: "#9a95b0" },
  { tag: [t.labelName, t.definition(t.propertyName)], color: "#a24a00" },
  { tag: t.invalid, color: "#c8324f", textDecoration: "underline wavy rgba(200, 50, 79, 0.6)" },
  { tag: t.link, color: "#1558b0", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
]);

export function chasseLight(): Extension[] {
  return [chasseLightTheme, syntaxHighlighting(chasseLightHighlight)];
}
