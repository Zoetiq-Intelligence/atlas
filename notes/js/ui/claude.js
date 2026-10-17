// claude.js (ui) — the panel that talks to the Atlas Master thread.
//
// Write a request, attach notes (the two open ones by default), send. The thread is
// woken by Horizon's Dispatcher, works on the Workstation, and its reply appears here
// in parts as it appends them. Anything it changes in a note arrives the normal way,
// through sync, so the open panes repaint by themselves.
//
// Ctrl+. opens it on desktop (Horizon's Universal App Protocol, F1). On the phone it
// is the "Claude" button at the bottom of the notes list.

import * as claude from '../data/claude.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const POLL_MS = 8000;          // while the panel is open and visible; it is the only reader
const PRESETS = [
  ['Merge', 'Merge these notes into one new note, losing nothing. '],
  ['Restyle', 'Suggest a consistent style for these notes (headings, lists, checkboxes) and apply it after I approve. '],
  ['Reorganize', 'Reorganize this note by topic without losing a line, as a new note. '],
];

const when = t => {
  const d = new Date(t * 1000);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const stateLabel = r => claude.settled(r) ? (r.state === 'done' ? 'done' : r.state)
  : r.reply ? 'replying' : r.state === 'new' ? 'sent' : 'working';
// what the operator typed, without the attached-notes trailer send() adds
const asked = v => String(v || '').split('\n\n— notes —\n')[0];

export function createClaudePanel(root, { getNotes, getOpen, getBuild, getEmail }) {
  let timer = null, attached = [], pending = [];

  function close() {
    clearInterval(timer); timer = null;
    document.removeEventListener('visibilitychange', onVis);
    root.hidden = true; root.innerHTML = '';
  }
  const onVis = () => { if (!document.hidden && !root.hidden) refresh(); };

  async function refresh() {
    const list = root.querySelector('#cl-hist');
    if (!list) return;
    let rows;
    try { rows = await claude.history(); }
    catch (e) { list.dataset.err = '1'; list.innerHTML = `<p style="color:var(--danger);font-size:13px">Couldn't load replies: ${esc(e.message || e)}</p>`; return; }
    // requests sent from here that Horizon hasn't filed yet (a few seconds) show as "sending"
    pending = pending.filter(p => !rows.some(r => r.ref && r.ref.ask_id === p.ask_id));
    const items = [
      ...pending.map(p => `<div class="cl-row"><div class="cl-meta"><span class="cl-st">sending</span></div>
        <div class="cl-q">${esc(p.text)}</div></div>`),
      ...rows.map(r => `<div class="cl-row">
        <div class="cl-meta"><span class="cl-st" data-s="${esc(stateLabel(r))}">${esc(stateLabel(r))}</span> · ${esc(when(r.t))}
          ${r.fields && r.fields.status && !claude.settled(r) ? ' · ' + esc(r.fields.status) : ''}</div>
        <div class="cl-q">${esc(asked(r.verbatim))}</div>
        ${r.reply ? `<div class="cl-a">${esc(r.reply)}</div>` : ''}</div>`),
    ];
    list.innerHTML = items.join('') || '<p style="color:var(--ink-2);font-size:13px">Nothing sent yet.</p>';
  }

  function paintChips() {
    const box = root.querySelector('#cl-notes');
    box.textContent = '';
    attached.forEach((n, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cl-chip';
      b.textContent = (n.title || '(untitled)') + '  ×';
      b.title = 'Remove';
      b.onclick = () => { attached.splice(i, 1); paintChips(); };
      box.appendChild(b);
    });
    const sel = document.createElement('select');
    sel.className = 'cl-chip'; sel.setAttribute('aria-label', 'Attach a note');
    sel.innerHTML = '<option value="">+ note</option>' + getNotes().filter(n => !n.deleted_at && !attached.some(a => a.id === n.id))
      .map(n => `<option value="${esc(n.id)}">${esc(n.title || '(untitled)')}</option>`).join('');
    sel.onchange = () => { const n = getNotes().find(x => x.id === sel.value); if (n) { attached.push(n); paintChips(); } };
    box.appendChild(sel);
  }

  /** @param {object[]} [notes] notes to attach (default: the ones open in the panes) @param {string} [text] */
  function open(notes, text = '') {
    attached = (notes || getOpen()).filter(Boolean).map(n => ({ id: n.id, title: n.title }));
    attached = attached.filter((n, i) => attached.findIndex(x => x.id === n.id) === i);
    root.hidden = false;
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin:0 0 4px">
        <h2 style="font-size:17px;margin:0;flex:1">Claude</h2>
        <button id="cl-close" class="go" style="min-height:36px;padding:0 14px;background:var(--chrome);color:var(--ink)">Close</button>
      </div>
      <p style="font-size:13px;color:var(--ink-2);margin:0 0 10px">
        Goes to the Atlas Master thread on the Workstation. Replies show up here; changes to notes sync in.</p>
      <div id="cl-pre" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px"></div>
      <textarea id="cl-text" rows="5" placeholder="What should Claude do?"
        style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);font:inherit;font-size:16px;resize:vertical"></textarea>
      <div id="cl-notes" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="cl-send" class="go" style="flex:1 1 auto;min-height:44px">Send to Claude</button>
      </div>
      <div id="cl-msg" role="status" style="font-size:13px;min-height:18px;margin:8px 0"></div>
      <div id="cl-hist"></div>`;

    const $ = s => root.querySelector(s);
    const ta = $('#cl-text'), msg = $('#cl-msg'), send = $('#cl-send');
    ta.value = text;
    PRESETS.forEach(([label, t]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cl-chip'; b.textContent = label;
      b.onclick = () => { ta.value = t + ta.value.replace(/^(?:Merge|Suggest|Reorganize)[^.]*\.\s*/, ''); ta.focus(); };
      $('#cl-pre').appendChild(b);
    });
    paintChips();

    send.onclick = async () => {
      send.disabled = true; msg.style.color = ''; msg.textContent = 'Sending…';
      try {
        const build = await Promise.resolve(getBuild()).catch(() => '');
        const ask_id = await claude.send({ text: ta.value, notes: attached, build, email: getEmail() });
        pending.unshift({ ask_id, text: ta.value.trim() });
        ta.value = '';
        msg.textContent = 'Sent. Claude usually picks it up within a minute.';
        refresh();
      } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = 'Not sent: ' + (e.message || e);
      } finally { send.disabled = false; }
    };
    $('#cl-close').onclick = close;

    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', onVis);
    if (!text) setTimeout(() => ta.focus(), 50);
  }

  return { open, close, get isOpen() { return !root.hidden; } };
}
