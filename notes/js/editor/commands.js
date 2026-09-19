// commands.js — THE registry. One declaration per thing you can do to content.
//
// The operator's rule, said more than once and finally built:
//
//   "the three-way parity between footer buttons, selection menu (not right click;
//    just when we select), and hotkeys (shown as instant tooltips in the footer) for
//    EVERY function we can do to control inputs."
//
// The reason it kept not happening is that footer, menu and keymap were three lists,
// and three lists drift. They are now three renderers over this one array. Adding a
// command here makes it appear in all three; there is no second place to remember.
// A test asserts that, so parity is checked rather than intended.
//
// KEY LAYOUT — the operator's groups, all left-hand with the right thumb on space:
//
//   1234   block type   title / heading / subheading / body
//   qwer   lists        bullet / numbered / checklist / quote
//   asdf   inline       bold / italic / underline / strike
//   zxcv   structure    outdent / indent / code block / mono
//   5tgb   actions      search / undo / redo / link
//
// The row is the category and the position is the item, which is what makes 20 keys
// memorable rather than arbitrary.

const svg = d => `<svg viewBox="0 0 20 20" aria-hidden="true">${d}</svg>`;

const UNDO = svg('<path d="M7 4 3 8l4 4"/><path d="M3 8h8a5 5 0 0 1 0 10H8"/>');
const REDO = svg('<path d="M13 4l4 4-4 4"/><path d="M17 8H9a5 5 0 0 0 0 10h3"/>');
const OUT  = svg('<path d="M9 5h8M9 10h8M9 15h8"/><path d="M6 7 3 10l3 3"/>');
const IN   = svg('<path d="M9 5h8M9 10h8M9 15h8"/><path d="M3 7l3 3-3 3"/>');
const BUL  = svg('<circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="14" r="1.5" fill="currentColor" stroke="none"/><path d="M8 6h9M8 14h9"/>');
const CHK  = svg('<path d="M2 6.5 4 8.5 7.5 4.5"/><path d="M2 14.5 4 16.5 7.5 12.5"/><path d="M11 6.5h7M11 14.5h7"/>');
const SEARCH = svg('<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>');
const LINK = svg('<path d="M8 12a3 3 0 0 0 4 0l3-3a3 3 0 0 0-4-4l-1 1"/><path d="M12 8a3 3 0 0 0-4 0l-3 3a3 3 0 0 0 4 4l1-1"/>');

/**
 * kind — how it is applied:
 *   mark  toggle an inline mark      block  set the block type
 *   nudge change depth               act    everything else
 * group — the key row it belongs to, used to lay the surfaces out in the same order.
 */
export const COMMANDS = [
  // 1234 — block type
  { id: 'title',      label: 'Title',         key: '1', group: '1234', kind: 'block', value: 'h1',    html: '<span style="font:700 14px/1 var(--font)">T</span>' },
  { id: 'heading',    label: 'Heading',       key: '2', group: '1234', kind: 'block', value: 'h2',    html: '<span style="font:700 12px/1 var(--font)">H</span>' },
  { id: 'subheading', label: 'Subheading',    key: '3', group: '1234', kind: 'block', value: 'h3',    html: '<span style="font:600 11px/1 var(--font)">h</span>' },
  { id: 'body',       label: 'Body',          key: '4', group: '1234', kind: 'block', value: 'p',     html: '<span style="font:400 14px/1 var(--font)">&para;</span>' },

  // qwer — lists
  { id: 'bullet',     label: 'Bulleted',      key: 'q', group: 'qwer', kind: 'block', value: 'li',    html: BUL },
  { id: 'numbered',   label: 'Numbered',      key: 'w', group: 'qwer', kind: 'block', value: 'ol',    html: '<span style="font:600 11px/1 var(--mono)">1.</span>' },
  { id: 'checklist',  label: 'Checklist',     key: 'e', group: 'qwer', kind: 'block', value: 'check', html: CHK },
  { id: 'quote',      label: 'Quote',         key: 'r', group: 'qwer', kind: 'block', value: 'quote', html: '<span style="font:700 15px/1 Georgia,serif">&ldquo;</span>' },

  // asdf — inline marks
  { id: 'bold',       label: 'Bold',          key: 'a', group: 'asdf', kind: 'mark',  value: 'b',     html: '<b>B</b>' },
  { id: 'italic',     label: 'Italic',        key: 's', group: 'asdf', kind: 'mark',  value: 'i',     html: '<i>I</i>' },
  { id: 'underline',  label: 'Underline',     key: 'd', group: 'asdf', kind: 'mark',  value: 'u',     html: '<u>U</u>' },
  { id: 'strike',     label: 'Strikethrough', key: 'f', group: 'asdf', kind: 'mark',  value: 's',     html: '<s>S</s>' },

  // zxcv — structure
  { id: 'outdent',    label: 'Outdent',       key: 'z', group: 'zxcv', kind: 'nudge', value: -1,      html: OUT },
  { id: 'indent',     label: 'Indent',        key: 'x', group: 'zxcv', kind: 'nudge', value: 1,       html: IN },
  { id: 'codeblock',  label: 'Code block',    key: 'c', group: 'zxcv', kind: 'block', value: 'code',  html: '<span style="font:600 11px/1 var(--mono)">{ }</span>' },
  { id: 'mono',       label: 'Mono',          key: 'v', group: 'zxcv', kind: 'mark',  value: 'code',  html: '<code style="font:600 12px var(--mono)">M</code>' },

  // 5tgb — actions
  { id: 'search',     label: 'Search',        key: '5', group: '5tgb', kind: 'act',   value: 'search', html: SEARCH },
  { id: 'undo',       label: 'Undo',          key: 't', group: '5tgb', kind: 'act',   value: 'undo',   html: UNDO },
  { id: 'redo',       label: 'Redo',          key: 'g', group: '5tgb', kind: 'act',   value: 'redo',   html: REDO },
  { id: 'link',       label: 'Link',          key: 'b', group: '5tgb', kind: 'act',   value: 'link',   html: LINK },
];

export const GROUPS = ['1234', 'qwer', 'asdf', 'zxcv', '5tgb'];

export const byKey = new Map(COMMANDS.map(c => [c.key, c]));
export const byId = new Map(COMMANDS.map(c => [c.id, c]));

/** What the tooltip and the menu print for a command's shortcut. */
export const keyHint = c => `Space ${c.key.toUpperCase()}`;

/**
 * Run a command against an editor. The ONE place that maps a command to an editor
 * call, so the three surfaces cannot disagree about what a command does either.
 * `host` supplies the app-level actions an editor does not own.
 */
export function run(cmd, ed, host = {}) {
  if (!cmd || !ed) return false;
  switch (cmd.kind) {
    case 'mark':  ed.mark(cmd.value); return true;
    case 'block': ed.block(cmd.value); return true;
    case 'nudge': ed.nudge(cmd.value); return true;
    case 'act':
      if (cmd.value === 'undo') { ed.undo(); return true; }
      if (cmd.value === 'redo') { ed.redo(); return true; }
      if (cmd.value === 'search') { if (host.search) host.search(); return true; }
      if (cmd.value === 'link') {
        // MARK_TYPES.link carries a value, so it needs one piece of input. A prompt is
        // the same answer already used for a new folder — deliberately not a new
        // layer, per "minimize the number of layers".
        const url = host.prompt ? host.prompt('Link URL') : null;
        if (url) ed.mark('link', url);
        return true;
      }
      return false;
    default: return false;
  }
}

// ---------------------------------------------------------------- parity audit
//
// Operator's rule, 2026-09-19: "if three-way parity isn't established, the button
// should automatically have a red highlight so I KNOW that it's unfinished."
//
// So parity is not just a test — it is checked at runtime, against the DOM that was
// actually rendered, and any command missing a surface paints itself red in the ones
// it does have. A test can be forgotten or not run; a red button cannot. It also
// catches the failure a static test would miss: a surface whose layout silently drops
// a group it does not know about.

const IMPLEMENTED_ACTS = new Set(['undo', 'redo', 'search', 'link']);

/** Does run() actually do something for this command, or is it a declared stub? */
export function implemented(c) {
  if (c.kind === 'mark' || c.kind === 'block' || c.kind === 'nudge') return true;
  if (c.kind === 'act') return IMPLEMENTED_ACTS.has(c.value);
  return false;
}

/**
 * @returns {{cmd, footer:boolean, menu:boolean, key:boolean, impl:boolean, ok:boolean, missing:string[]}[]}
 */
export function audit(footerRoot, selRoot) {
  return COMMANDS.map(cmd => {
    const footer = !!(footerRoot && footerRoot.querySelector(`.fbtn[data-id="${cmd.id}"]`));
    const menu = !!(selRoot && selRoot.querySelector(`.selbtn[data-id="${cmd.id}"]`));
    const key = !!cmd.key && byKey.get(cmd.key) === cmd;
    const impl = implemented(cmd);
    const missing = [];
    if (!footer) missing.push('footer button');
    if (!menu) missing.push('selection menu');
    if (!key) missing.push('shortcut');
    if (!impl) missing.push('implementation');
    return { cmd, footer, menu, key, impl, ok: !missing.length, missing };
  });
}

/**
 * Paint the verdict. Anything short of all three surfaces plus a working
 * implementation gets marked, wherever it managed to render.
 */
export function markParity(footerRoot, selRoot) {
  const rows = audit(footerRoot, selRoot);
  for (const r of rows) {
    const els = [
      footerRoot && footerRoot.querySelector(`.fbtn[data-id="${r.cmd.id}"]`),
      selRoot && selRoot.querySelector(`.selbtn[data-id="${r.cmd.id}"]`),
    ].filter(Boolean);
    for (const el of els) {
      el.classList.toggle('incomplete', !r.ok);
      if (!r.ok) el.dataset.missing = r.missing.join(', ');
      else delete el.dataset.missing;
    }
  }
  return rows;
}

/** Whether a command reads as active for the current selection. */
export function isOn(cmd, state) {
  if (!state) return false;
  if (cmd.kind === 'mark') return state.marks.has(cmd.value);
  if (cmd.kind === 'block') return state.type === cmd.value;
  return false;
}
