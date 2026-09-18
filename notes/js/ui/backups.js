// backups.js — the snapshot list, and the way back.
//
// Mounted like the device kit (diag.js): rendered INSIDE the app rather than on a
// sibling page, because on iOS an installed home-screen app has its own storage
// container and a sibling page is a different session. A revert UI that can only be
// reached from a browser tab is a revert UI the installed app cannot use.

import * as backup from '../data/backup.js';
import { copyText } from './diag.js';

const fmt = iso => {
  const t = Date.parse(iso);
  if (!isFinite(t)) return String(iso);
  return new Date(t).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const ago = iso => {
  const ms = Date.now() - Date.parse(iso);
  if (!isFinite(ms)) return '';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return Math.max(0, Math.floor(ms / 60000)) + 'm ago';
  if (h < 48) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};

const REASON = { auto: 'automatic', manual: 'manual', 'pre-restore': 'before a restore' };

export async function mount(root, { onRestored } = {}) {
  root.hidden = false;
  root.innerHTML = `
    <h2 style="font-size:17px;margin:0 0 4px">Backups</h2>
    <div id="bk-status" style="padding:10px;border-radius:8px;background:var(--paper-2);margin:8px 0;font-size:14px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button id="bk-now" class="go" style="flex:1 1 auto;min-height:44px">Back up now</button>
      <button id="bk-close" class="go" style="flex:1 1 auto;min-height:44px;background:var(--chrome);color:var(--ink)">Close</button>
    </div>
    <div id="bk-list"></div>
    <p style="font-size:12px;color:var(--ink-2);margin:10px 0 0">
      A snapshot is taken automatically when the app is open and six hours have passed.
      Restoring replaces your notes with that snapshot &mdash; a snapshot of the current
      state is always taken first, and nothing is ever permanently deleted.</p>`;

  const statusEl = root.querySelector('#bk-status');
  const listEl = root.querySelector('#bk-list');

  const say = (text, bad) => {
    statusEl.textContent = text;
    statusEl.style.color = bad ? 'var(--bad, #b3261e)' : '';
  };

  function notInstalled() {
    say('Backups are not set up on this project yet. The SQL in '
      + 'workflow/_protocol/SETUP-BACKUP.sql has not been run.', true);
    listEl.textContent = '';
  }

  async function paint() {
    let rows;
    try {
      rows = await backup.list();
    } catch (e) {
      if (e instanceof backup.NotInstalled) return notInstalled();
      say('Could not reach the server: ' + (e.message || e), true);
      return;
    }

    if (!rows.length) {
      say('No backups yet.');
    } else {
      const latest = rows[0];
      const next = new Date(Date.parse(latest.taken_at) + backup.INTERVAL_MS);
      say(`${rows.length} backup${rows.length === 1 ? '' : 's'} · latest ${ago(latest.taken_at)}`
        + ` (${latest.note_count} notes) · next due ${fmt(next.toISOString())}`);
    }

    listEl.textContent = '';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'bk-row';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;'
        + 'padding:8px 0;border-top:1px solid var(--rule,rgba(128,128,128,.25))';

      const label = document.createElement('span');
      label.style.cssText = 'flex:1 1 150px;font-size:13px';
      label.textContent = `${fmt(r.taken_at)} · ${r.note_count} notes`
        + (r.reason && r.reason !== 'auto' ? ` · ${REASON[r.reason] || r.reason}` : '');

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'quiet';
      copy.style.minHeight = '36px';
      copy.textContent = 'Copy JSON';
      copy.onclick = async () => {
        copy.textContent = 'Reading…';
        try {
          const full = await backup.fetchOne(r.id);
          // The payload must exist as a string BEFORE copyText is called: WebKit drops
          // transient user activation across an await, so building it inside the copy
          // handler makes writeText silently reject (GUIDE §4.9).
          const str = JSON.stringify(full, null, 1);
          const tier = await copyText(str, listEl);
          copy.textContent = tier === 'selected' ? 'Select & copy' : 'Copied';
        } catch (e) {
          copy.textContent = 'Failed';
        }
        setTimeout(() => { copy.textContent = 'Copy JSON'; }, 2500);
      };

      // Two taps, never one. The first tap explains what the second will do; a restore
      // that fires on a single mis-tap in a list of dates is a data-loss button.
      const rest = document.createElement('button');
      rest.type = 'button';
      rest.className = 'quiet';
      rest.style.minHeight = '36px';
      rest.textContent = 'Restore';
      let armed = false;
      let disarm = null;
      rest.onclick = async () => {
        if (!armed) {
          armed = true;
          rest.textContent = 'Tap again to replace';
          rest.style.color = 'var(--bad, #b3261e)';
          clearTimeout(disarm);
          disarm = setTimeout(() => {
            armed = false; rest.textContent = 'Restore'; rest.style.color = '';
          }, 5000);
          return;
        }
        clearTimeout(disarm);
        armed = false;
        rest.disabled = true;
        rest.textContent = 'Restoring…';
        try {
          const out = await backup.restore(r.id);
          say(`Restored ${out.restored_notes} notes from ${fmt(r.taken_at)}.`
            + (out.trashed_notes ? ` ${out.trashed_notes} newer note(s) moved to deleted.` : ''));
          if (onRestored) await onRestored(out);
        } catch (e) {
          rest.disabled = false;
          rest.textContent = 'Restore';
          rest.style.color = '';
          say('Restore failed: ' + (e.message || e), true);
        }
      };

      row.append(label, copy, rest);
      listEl.appendChild(row);
    }
  }

  root.querySelector('#bk-now').onclick = async () => {
    const btn = root.querySelector('#bk-now');
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Backing up…';
    try {
      // 0 = ignore the six-hour interval. This button means "now".
      await backup.take({ minIntervalSeconds: 0, reason: 'manual' });
      await paint();
    } catch (e) {
      if (e instanceof backup.NotInstalled) notInstalled();
      else say('Backup failed: ' + (e.message || e), true);
    }
    btn.disabled = false;
    btn.textContent = was;
  };

  root.querySelector('#bk-close').onclick = () => { root.hidden = true; root.innerHTML = ''; };

  say('Loading…');
  await paint();
}
