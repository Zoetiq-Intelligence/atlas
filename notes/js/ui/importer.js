// importer.js — bring text files in as notes.
//
// Built for leaving iOS Notes: the operator exports a note to .txt and imports it
// here, untouched. Every file is converted by model/import.js, which refuses any
// import whose text does not come back out character for character.
//
// Lives in the slide-over next to Backups rather than in the command registry: it is
// a note-management action like "new note", not a way of controlling input, so the
// three-way parity rule does not apply to it.

import { textToDoc } from '../model/import.js';

export function createImporter(root, { onImport } = {}) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.txt,text/plain';
  picker.multiple = true;
  picker.hidden = true;
  document.body.appendChild(picker);

  let files = [];

  function close() { root.hidden = true; root.innerHTML = ''; picker.value = ''; }

  async function render() {
    root.hidden = false;
    root.innerHTML = `
      <h2 style="font-size:17px;margin:0 0 4px">Import</h2>
      <p style="font-size:13px;color:var(--ink-2);margin:0 0 10px">
        Each file becomes one note, exactly as written — every line, blank line and tab.</p>
      <label style="display:block;font-size:13px;margin:0 0 4px" for="im-sfx">Add to every title</label>
      <input id="im-sfx" type="text" autocomplete="off" placeholder="e.g. (OLD)"
             style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);font-size:16px">
      <div id="im-list" style="margin:12px 0"></div>
      <div id="im-msg" role="status" style="font-size:13px;min-height:18px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="im-go" class="go" style="flex:1 1 auto;min-height:44px">Import</button>
        <button id="im-close" class="go" style="flex:1 1 auto;min-height:44px;background:var(--chrome);color:var(--ink)">Cancel</button>
      </div>`;

    const sfx = root.querySelector('#im-sfx');
    const list = root.querySelector('#im-list');
    const msg = root.querySelector('#im-msg');
    const go = root.querySelector('#im-go');

    const texts = await Promise.all(files.map(f => f.text()));

    // The preview is computed by the same function that will do the import, so what
    // is shown is what will be stored — including a refusal, before anything is saved.
    const preview = () => {
      list.textContent = '';
      let ok = true;
      texts.forEach((t, i) => {
        const row = document.createElement('div');
        row.className = 'im-row';
        row.style.cssText = 'padding:8px 0;border-top:1px solid var(--rule);font-size:13px';
        try {
          const r = textToDoc(t, { suffix: sfx.value });
          row.innerHTML = '<b></b><br><span style="color:var(--ink-2)"></span>';
          row.querySelector('b').textContent = r.title || '(untitled)';
          row.querySelector('span').textContent =
            `${files[i].name} · ${r.lines.toLocaleString()} lines · verified lossless`;
        } catch (e) {
          ok = false;
          row.textContent = `${files[i].name} — ${e.message}`;
          row.style.color = 'var(--danger)';
        }
        list.appendChild(row);
      });
      go.disabled = !ok || !texts.length;
      go.textContent = `Import ${texts.length} note${texts.length === 1 ? '' : 's'}`;
    };
    sfx.addEventListener('input', preview);
    preview();

    go.onclick = async () => {
      go.disabled = true;
      msg.textContent = 'Importing…';
      try {
        const made = texts.map(t => textToDoc(t, { suffix: sfx.value }));
        await onImport(made);
        msg.textContent = `Imported ${made.length}. They will sync to your other devices.`;
        setTimeout(close, 1200);
      } catch (e) {
        msg.textContent = 'Import failed: ' + (e.message || e);
        msg.style.color = 'var(--danger)';
        go.disabled = false;
      }
    };
    root.querySelector('#im-close').onclick = close;
  }

  picker.addEventListener('change', () => {
    files = [...picker.files];
    if (files.length) render();
  });

  return {
    /** Open the system file picker. Must be called from a user gesture. */
    pick() { picker.click(); },
    close,
  };
}
