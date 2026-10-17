// merger.js — merge two notes on the device, proven lossless, into a NEW note.
//
// The phone half of "the import and merge w/ Claude all on the phone" (2026-10-17).
// The rules are model/merge.js — the same module tools/merge-notes.mjs runs — so what
// this panel proves is what the CLI would prove. It never edits either source: the
// result is always a new note, and nothing is stored unless the coverage proof passes.
//
// Lives in the slide-over beside Import, not in the command registry: it manages
// notes rather than controlling input, so the three-way parity rule does not apply.

import { coerce, plainText } from '../model/doc.js';
import { mergeNotes, unmark } from '../model/merge.js';

const OLD = '(OLD)';
const linesOf = n => unmark(plainText(coerce(n.doc)).split('\n'), OLD);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createMerger(root, { getNotes, onCreate, onAsk }) {
  function close() { root.hidden = true; root.innerHTML = ''; }

  function open({ newerId, olderId } = {}) {
    const notes = getNotes().filter(n => !n.deleted_at);
    // Default pair: the two most recently edited notes marked OLD — the shape the
    // iOS move leaves behind — else the two most recent of all.
    const old = notes.filter(n => (n.title || '').trimEnd().endsWith(OLD));
    const pool = old.length >= 2 ? old : notes;
    const byRecent = [...pool].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const pick = (id, k) => id || (byRecent[k] && byRecent[k].id) || '';
    const opts = sel => notes.map(n =>
      `<option value="${esc(n.id)}"${n.id === sel ? ' selected' : ''}>${esc(n.title || '(untitled)')}</option>`).join('');
    const nA = pick(newerId, 0), oA = pick(olderId, 1);

    root.hidden = false;
    root.innerHTML = `
      <h2 style="font-size:17px;margin:0 0 4px">Merge</h2>
      <p style="font-size:13px;color:var(--ink-2);margin:0 0 12px">
        Two newest-at-top notes become one new note: the newer on top, copied runs kept once,
        lines grouped as checkboxes, bullets and hyphens. Both notes stay as they are.</p>
      <label class="mg-l" for="mg-new">Newer note (goes on top)</label>
      <select id="mg-new" class="mg-in">${opts(nA)}</select>
      <label class="mg-l" for="mg-old">Older note</label>
      <select id="mg-old" class="mg-in">${opts(oA)}</select>
      <label class="mg-l" for="mg-title">Title of the merge</label>
      <input id="mg-title" class="mg-in" type="text" autocomplete="off">
      <div id="mg-out" role="status" style="font-size:13px;margin:12px 0;min-height:18px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="mg-go" type="button" class="go" style="flex:1 1 auto;min-height:44px" disabled>Create merged note</button>
        <button id="mg-ask" type="button" class="go" style="flex:1 1 auto;min-height:44px;background:var(--chrome);color:var(--ink)">Ask Claude instead</button>
        <button id="mg-close" type="button" class="go" style="flex:1 1 auto;min-height:44px;background:var(--chrome);color:var(--ink)">Cancel</button>
      </div>`;

    const $ = s => root.querySelector(s);
    const selNew = $('#mg-new'), selOld = $('#mg-old'), title = $('#mg-title'), out = $('#mg-out'), go = $('#mg-go');
    const byId = id => notes.find(n => n.id === id);
    let result = null, run = 0, titleTouched = false;

    const defaultTitle = () => {
      const n = byId(selNew.value);
      return n ? (linesOf(n).find(l => l.trim()) || '').trim() : '';
    };

    // The merge is quadratic in lines (thousands × thousands on the first pair), so it
    // runs after a paint, and a newer run supersedes an older one still queued.
    function compute() {
      if (!out.isConnected) return;            // the panel was closed while a title edit was pending
      const my = ++run;
      result = null; go.disabled = true; out.style.color = '';
      if (!titleTouched) title.value = defaultTitle();
      const a = byId(selNew.value), b = byId(selOld.value);
      if (!a || !b) { out.textContent = 'Pick two notes.'; return; }
      if (a.id === b.id) { out.textContent = 'Pick two different notes.'; return; }
      out.style.color = ''; out.textContent = 'Merging…';
      setTimeout(() => {
        if (my !== run || !out.isConnected) return;
        const t0 = performance.now();
        const r = mergeNotes(linesOf(b), linesOf(a), { title: title.value });
        if (my !== run) return;
        result = r;
        const c = r.counts, ms = Math.round(performance.now() - t0);
        if (r.ok) {
          out.innerHTML = `<b>${r.doc.blocks.length.toLocaleString()} lines</b> · ${c.checkbox || 0} checkboxes ·
            ${c.bullet || 0} bullets · ${c.hyphen || 0} hyphens · ${(r.stats.droppedOlder).toLocaleString()} copied
            lines kept once<br><span style="color:var(--ink-2)">Verified: every line of both notes is in the merge
            (${r.proof.byContainment} inside a longer line) · ${ms} ms</span>`;
          go.disabled = false;
        } else {
          out.style.color = 'var(--danger)';
          out.textContent = r.proof.missing.length
            ? `Refused: ${r.proof.missing.length} line(s) would be lost. Nothing will be saved.`
            : 'Refused: the merge would change on reload. Nothing will be saved.';
        }
      }, 30);
    }

    selNew.onchange = compute;
    selOld.onchange = compute;
    let tt = null;
    title.oninput = () => { titleTouched = true; clearTimeout(tt); tt = setTimeout(compute, 400); };
    go.onclick = async () => {
      if (!result || !result.ok) return;
      go.disabled = true; out.textContent = 'Saving…';
      try { await onCreate({ title: result.title, doc: result.doc }); close(); }
      catch (e) { out.style.color = 'var(--danger)'; out.textContent = 'Save failed: ' + (e.message || e); go.disabled = false; }
    };
    $('#mg-ask').onclick = () => {
      clearTimeout(tt);
      const a = byId(selNew.value), b = byId(selOld.value);
      close();
      onAsk([a, b].filter(Boolean), `Merge these two notes into a new note titled "${title.value || defaultTitle()}". `);
    };
    $('#mg-close').onclick = () => { clearTimeout(tt); close(); };
    compute();
  }

  return { open, close };
}
