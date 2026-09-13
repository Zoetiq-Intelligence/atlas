// schema.js — what a block may be. Single source of truth for the editor,
// the renderer and the footer, so adding a block type is one edit here.

export const DOC_VERSION = 1;

/**
 * tag      — element the text lives in (for semantics/CSS, not structure)
 * label    — footer button label
 * marker   — renders a bullet/number/checkbox
 * enterTo  — what Enter produces from this block (null = same type)
 * plain    — true if inline marks are not allowed (code blocks)
 */
export const BLOCK_TYPES = {
  p:     { tag: 'div', label: 'Body',       enterTo: null },
  h1:    { tag: 'h1',  label: 'Title',      enterTo: 'p' },
  h2:    { tag: 'h2',  label: 'Heading',    enterTo: 'p' },
  h3:    { tag: 'h3',  label: 'Subheading', enterTo: 'p' },
  li:    { tag: 'div', label: 'Bulleted',   marker: 'bullet', enterTo: null },
  ol:    { tag: 'div', label: 'Numbered',   marker: 'number', enterTo: null },
  check: { tag: 'div', label: 'Checklist',  marker: 'check',  enterTo: null },
  quote: { tag: 'div', label: 'Quote',      enterTo: null },
  code:  { tag: 'pre', label: 'Code',       enterTo: null, plain: true },
};

export const MARK_TYPES = {
  b:    { label: 'Bold',          inputType: 'formatBold' },
  i:    { label: 'Italic',        inputType: 'formatItalic' },
  u:    { label: 'Underline',     inputType: 'formatUnderline' },
  s:    { label: 'Strikethrough', inputType: 'formatStrikeThrough' },
  code: { label: 'Mono' },
  link: { label: 'Link', hasValue: true },
};

export const LIST_TYPES = new Set(['li', 'ol', 'check']);

export function isBlockType(t) { return Object.hasOwn(BLOCK_TYPES, t); }
export function isMarkType(t) { return Object.hasOwn(MARK_TYPES, t); }
