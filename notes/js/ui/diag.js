// diag.js — the device truth kit. GUIDE §9.
//
// Shipped on day one, not when something breaks: by then you are spending device
// round trips to get the instrument there.
//
// It renders INSIDE the app, because on iOS an installed home-screen app has its own
// storage container and may not reach a sibling page from within its scope. It writes
// NOTHING — IndexedDB is opened with no version, so it can never trigger an upgrade
// or a VersionError. And it reports its own configuration, so a pasted report needs
// no follow-up question about which meta or which build produced it.

const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const cssVar = n => num(getComputedStyle(document.documentElement).getPropertyValue(n));
const meta = n => { const el = document.querySelector(`meta[name="${n}"]`); return el ? el.content : null; };

/**
 * GUIDE §0.2.4-5 — the two obvious formulas are both wrong BY CONSTRUCTION:
 *   innerHeight - rect.bottom  measures the broken viewport against itself -> always 0,
 *                              even on a device visibly showing a dead band.
 *   screen.height - rect.bottom  mixes coordinate origins -> always the full shortfall,
 *                              even when the box is perfectly flush.
 * Two device round trips, both wasted. No API exposes the layout viewport's origin in
 * screen coordinates, so the band must be DERIVED from two independent same-origin
 * facts: the frame is taller than the viewport, AND the top inset is non-zero (which
 * is what proves the viewport is pinned to the top and the deficit falls at the bottom).
 */
function geometry() {
  const vv = window.visualViewport || null;
  const saTop = cssVar('--sa-top'), saBottom = cssVar('--sa-bottom');

  // iOS screen.width/height historically do NOT swap on rotation, so in landscape the
  // subtraction is a large meaningless number that looks like a catastrophic band.
  const portrait = !window.matchMedia || window.matchMedia('(orientation: portrait)').matches;
  const shortfall = portrait ? (screen.height - window.innerHeight) : null;
  const bottomBand = (shortfall !== null && shortfall > 0 && saTop > 0) ? shortfall : 0;

  // A report taken while typing is unreadable unless it says so.
  const keyboardLikely = !!(vv && (window.innerHeight - vv.height - vv.offsetTop) > 80);

  let verdict;
  if (shortfall === null)   verdict = 'landscape — shortfall not derived (iOS screen.* does not rotate)';
  else if (shortfall === 0) verdict = 'OK — frame == layout viewport, no dead band';
  else if (saTop > 0)       verdict = `DEAD BAND ${shortfall}px below the content — status bar is translucent`;
  else                      verdict = `frame inset ${shortfall}px below the status bar — no band`;

  return {
    verdict, orientation: portrait ? 'portrait' : 'landscape', keyboardLikely,
    screenH: screen.height, screenW: screen.width,
    innerHeight: window.innerHeight, innerWidth: window.innerWidth,
    outerHeight: window.outerHeight, availHeight: screen.availHeight,
    docClientHeight: document.documentElement.clientHeight,
    visualViewport: vv ? { h: +vv.height.toFixed(1), offsetTop: +vv.offsetTop.toFixed(1), scale: +vv.scale.toFixed(3) } : null,
    shortfall, bottomBand,
    saTop, saBottom, saLeft: cssVar('--sa-left'), saRight: cssVar('--sa-right'),
    appH: cssVar('--app-h'), kb: cssVar('--kb'),
    // Measured, not read: --bar-h is a calc() and getPropertyValue returns the
    // unresolved token stream, which parseFloat turns into 0.
    barH: (() => { const b = document.getElementById('footer');
                   return b ? +b.getBoundingClientRect().height.toFixed(1) : null; })(),
    dpr: window.devicePixelRatio || 1,
    // The report must identify its own configuration (GUIDE §9).
    statusBarStyle: meta('apple-mobile-web-app-status-bar-style'),
    viewportMeta: meta('viewport'),
    appleCapable: meta('apple-mobile-web-app-capable'),
    webCapable: meta('mobile-web-app-capable'),
    standalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
    displayMode: ['standalone', 'minimal-ui', 'fullscreen', 'browser']
      .find(m => window.matchMedia && window.matchMedia(`(display-mode:${m})`).matches) || 'unknown',
  };
}

async function build() {
  const out = { running: 'unknown', cacheNames: [], swScript: null, swState: null };
  const sw = navigator.serviceWorker;
  if (sw && sw.controller) { out.swScript = sw.controller.scriptURL; out.swState = sw.controller.state; }
  if (!('caches' in window)) return out;
  try {
    const names = await caches.keys();
    out.cacheNames = names;
    const mine = names.filter(n => n.startsWith('notes-'));
    out.running = mine.length ? mine.sort().pop() : 'uncached';
    if (mine.length > 1) out.WARNING_multipleCaches = mine;   // two builds present at once
  } catch (e) { out.running = 'caches-unavailable: ' + e.name; }
  return out;
}

async function storage() {
  const out = { localStorage: null, persisted: null, quota: null, usage: null, idb: null };
  try { out.localStorage = Object.keys(localStorage).length + ' keys'; }
  catch (e) { out.localStorage = 'blocked: ' + e.name; }
  if (navigator.storage?.persisted) {
    try { out.persisted = await navigator.storage.persisted(); } catch (e) { out.persisted = 'err:' + e.name; }
  }
  if (navigator.storage?.estimate) {
    try { const est = await navigator.storage.estimate(); out.quota = est.quota; out.usage = est.usage; }
    catch (e) { out.quota = 'err:' + e.name; }
  }
  // Opened with NO version, so it can never trigger an upgrade or a VersionError.
  out.idb = await new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try { req = indexedDB.open('notes'); } catch (e) { return done('open threw: ' + e.name); }
    setTimeout(() => done('TIMEOUT (3s) — blocked or wedged'), 3000);
    req.onblocked = () => done('BLOCKED — another context holds it');
    req.onerror = () => done('error: ' + (req.error && req.error.name));
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (e) {} done('DID NOT EXIST'); };
    req.onsuccess = () => {
      const db = req.result;
      const info = { version: db.version, stores: [...db.objectStoreNames] };
      try { db.close(); } catch (e) {}
      done(info);
    };
  });
  return out;
}

function environment() {
  const mm = q => window.matchMedia && window.matchMedia(q).matches;
  return {
    ua: navigator.userAgent, lang: navigator.language, online: navigator.onLine,
    maxTouchPoints: navigator.maxTouchPoints,
    hover: mm('(hover: hover)'), coarse: mm('(any-pointer: coarse)'),
    prefersDark: mm('(prefers-color-scheme: dark)'),
    reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    href: location.href, secureContext: window.isSecureContext,
    has: {
      serviceWorker: 'serviceWorker' in navigator, caches: 'caches' in window,
      indexedDB: 'indexedDB' in window, visualViewport: 'visualViewport' in window,
      asyncClipboard: !!(navigator.clipboard && navigator.clipboard.writeText),
      execCommand: typeof document.execCommand === 'function',
    },
    now: new Date().toISOString(),
  };
}

export async function report() {
  const [b, s] = await Promise.all([build(), storage()]);
  return {
    _: 'DEVICE TRUTH REPORT — paste this whole block back to Claude',
    geometry: geometry(), build: b, storage: s, env: environment(),
  };
}

/**
 * GUIDE §4.9 — three tiers, and tier 3 is the one that must never be omitted.
 * `str` must ALREADY be a string built before this call: WebKit drops transient user
 * activation across an await, so computing the payload with caches.keys() or an
 * IndexedDB read — i.e. exactly what this kit does — makes writeText silently reject.
 */
export function copyText(str, selectEl) {
  let p;
  try { p = navigator.clipboard && navigator.clipboard.writeText(str); }
  catch (e) { p = Promise.reject(e); }
  if (!p) p = Promise.reject(new Error('no async clipboard'));

  return p.then(() => 'clipboard').catch(() => {
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');     // or iOS pops the keyboard
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, str.length); // iOS needs the explicit range
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    if (ok) return 'execCommand';
    if (selectEl) {
      try {
        const sel = window.getSelection(), r = document.createRange();
        r.selectNodeContents(selectEl); sel.removeAllRanges(); sel.addRange(r);
      } catch (e) {}
    }
    return 'selected';
  });
}

export async function mount(root) {
  root.hidden = false;
  root.innerHTML = `
    <h2 style="font-size:17px;margin:0 0 4px">Device truth</h2>
    <div id="dg-verdict" style="padding:10px;border-radius:8px;background:var(--paper-2);margin:8px 0;font-size:14px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button id="dg-copy" class="go" style="flex:1 1 auto;min-height:44px">Copy report</button>
      <button id="dg-again" class="go" style="flex:1 1 auto;min-height:44px;background:var(--chrome);color:var(--ink)">Re-measure</button>
      <button id="dg-close" class="go" style="flex:1 1 auto;min-height:44px;background:var(--chrome);color:var(--ink)">Close</button>
    </div>
    <p style="font-size:12px;color:var(--ink-2);margin:0 0 8px">Reset the app (keeps your notes): <a id="dg-reset" href="../reset/">../reset/</a></p>
    <pre id="dg-dump" style="white-space:pre-wrap;word-break:break-word;background:var(--paper-2);padding:10px;border-radius:8px;font:12px/1.4 var(--mono);user-select:text;-webkit-user-select:text"></pre>`;

  // The payload string is built on paint and cached, so the copy handler is fully
  // synchronous and never loses user activation (GUIDE §4.9).
  let current = '';
  const dump = root.querySelector('#dg-dump');
  const verdict = root.querySelector('#dg-verdict');

  async function measure() {
    const r = await report();
    current = JSON.stringify(r, null, 1);
    verdict.textContent = r.geometry.verdict + (r.geometry.keyboardLikely ? '  ⚠ keyboard is open — re-measure with it closed' : '');
    dump.textContent = current;
  }

  root.querySelector('#dg-copy').onclick = () => {
    copyText(current, dump).then(tier => {
      verdict.textContent = tier === 'selected'
        ? 'Copy blocked — the text is selected, copy it by hand'
        : 'Copied (' + tier + ') — paste it back to Claude';
    });
  };
  root.querySelector('#dg-again').onclick = measure;
  root.querySelector('#dg-close').onclick = () => { root.hidden = true; root.innerHTML = ''; };

  await measure();
}
