/* update.js — service-worker update orchestration. GUIDE §7.
 *
 * Not a module: it must run as a classic script so the inline <head> capture of
 * __HAD_CONTROLLER__ (GUIDE §7.8) is already settled by the time this evaluates.
 *
 * The one thing this file exists for: an installed home-screen app is BACKGROUNDED
 * AND RESUMED, never navigated. The browser's automatic update check is piggy-backed
 * on navigation, so it never runs, so the device serves whatever build it installed,
 * indefinitely. A deploy that is provably live on the server simply never arrives.
 * That bug exists ONLY in the installed app and cannot be found in development.
 *
 * Public API — the app attaches to these, never edits this file:
 *   UPDATE.isBusy           = () => bool   GUIDE §7.4  (you MUST supply this)
 *   UPDATE.onPrimarySurface = () => bool   GUIDE §7.6
 *   UPDATE.notify           = msg => void  interrupting toast, suppressed while busy
 *   UPDATE.onAvailable      = bool => void GUIDE §7.7  passive badge, never suppressed
 *   UPDATE.buildId()                       GUIDE §7.13 read from the LIVE cache
 *   UPDATE.checkNow()
 */
(function () {
  'use strict';

  var CACHE_PREFIX   = 'notes';
  var POLL_MS        = 1500;
  var DEBOUNCE_MS    = 1500;   // GUIDE §11.14 — coalescing, not a cure
  var MIN_GAP_MS     = 20000;  // app-switcher thrash guard
  var HANDOVER_MS    = 3000;

  // GUIDE §7.12 — the DOM contract these scripts require. If an OLD shell is paired
  // with THIS javascript, these ids are what would be missing.
  var REQUIRED_IDS = ['app', 'panes', 'footer', 'sidebar'];
  var LATCH = CACHE_PREFIX + ':shellFix';   // GUIDE §8.1 — namespaced; the origin is shared

  var UPDATE = window.UPDATE = window.UPDATE || {};
  var registration = null;

  function safeSession(fn, fallback) {
    try { return fn(window.sessionStorage); } catch (e) { return fallback; }
  }

  // GUIDE §7.6 — two DIFFERENT predicates. busy() is about state destruction and
  // blocks always; onPrimarySurface() is about visual interruption and blocks only
  // while visible. Collapsing them means either a hidden-but-busy app never updates,
  // or a visible-and-idle app reloads under the user. Both fail SAFE on a throw.
  function busy() {
    try { return typeof UPDATE.isBusy === 'function' ? !!UPDATE.isBusy() : false; }
    catch (e) { return true; }
  }
  function onPrimarySurface() {
    try { return typeof UPDATE.onPrimarySurface === 'function' ? !!UPDATE.onPrimarySurface() : false; }
    catch (e) { return true; }
  }

  // GUIDE §7.7 — the passive signal fires even while busy. Only the toast waits.
  function signalAvailable(v) {
    try { if (typeof UPDATE.onAvailable === 'function') UPDATE.onAvailable(v); } catch (e) {}
  }
  // The notice is cosmetic; the update is not. A missing or throwing helper must never
  // abort the reload path — at handover time the helper may not be defined yet.
  function notifyQuietly(msg) {
    try { if (typeof UPDATE.notify === 'function') UPDATE.notify(msg); } catch (e) {}
  }

  // ===========================================================================
  // GUIDE §7.12 — stale-shell self-heal. Runs FIRST: a mismatched pair must not be
  // allowed to arm an update loop. Three corrections to the source's version, all
  // real bugs: delete by PREFIX only (unfiltered deletion on a *.github.io origin
  // destroys every other project there); require navigator.onLine (nuking the cache
  // offline turns a cosmetically-wrong app into a blank one); write the latch BEFORE
  // the reload (after is an infinite boot loop).
  // ===========================================================================
  function shellOk() {
    for (var i = 0; i < REQUIRED_IDS.length; i++) {
      if (!document.getElementById(REQUIRED_IDS[i])) return false;
    }
    return true;
  }

  function healStaleShell() {
    if (shellOk()) { safeSession(function (ss) { ss.removeItem(LATCH); }); return false; }
    // If storage throws, assume "already tried" — fail closed into no-reload.
    var tried = safeSession(function (ss) { return ss.getItem(LATCH); }, '1');
    if (tried) { console.warn('[update] shell/script mismatch survived a reload; running anyway'); return false; }
    if (navigator.onLine === false) { console.warn('[update] shell mismatch but offline; not clearing'); return false; }
    safeSession(function (ss) { ss.setItem(LATCH, '1'); });
    var clearing = ('caches' in window)
      ? caches.keys().then(function (keys) {
          return Promise.all(keys
            .filter(function (k) { return k.indexOf(CACHE_PREFIX + '-') === 0; })
            .map(function (k) { return caches.delete(k); }));
        })
      : Promise.resolve();
    clearing['catch'](function () {}).then(function () { location.reload(); });
    return true;
  }

  // ===========================================================================
  // GUIDE §7.6 + §7.9 — the idle gate, ranked rather than binary:
  //   (1) hidden and not busy  -> free: no state cost, no visible flash
  //   (2) visible, not busy, off the work surface -> acceptable
  //   (3) on the work surface  -> never, however long that takes
  // Polled, not hooked: if the interaction path had to notify this file, every new
  // surface would have to remember, and a missed call is a silent reload-during-work
  // bug that only shows on a device. Bounded and self-terminating — the loop ENDS by
  // reloading. Never setInterval: in a test harness that keeps the process alive.
  // ===========================================================================
  var pollTimer = null, looping = false, handoverAsked = false, reloaded = false;
  var waitingSince = 0;
  var STALE_MS = 5 * 60 * 1000;   // after this long, hidden beats busy

  function goodMoment() {
    var hidden = document.visibilityState === 'hidden';
    if (hidden && !busy()) return true;                     // (1) free: no state, no flash
    if (!busy() && !onPrimarySurface()) return true;        // (2) acceptable
    // Safety valve. GUIDE §7.6 says wait indefinitely, and that is right while someone
    // is looking. But an update waiting against a busy() that never clears is an update
    // that is never arriving, and a stuck build is worse than a reload nobody sees.
    if (hidden && waitingSince && (Date.now() - waitingSince) > STALE_MS) return true;
    return false;                                           // (3) never
  }

  function reloadWhenIdle() {
    signalAvailable(true);                 // §7.7 — inform immediately, interrupt later
    if (!waitingSince) waitingSince = Date.now();
    if (looping) return;
    looping = true;
    tick();
  }

  function tick() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (goodMoment()) {
      // Announce only at the moment the gate has ALREADY passed. Announcing at
      // schedule time interrupts the very work that is postponing the reload.
      notifyQuietly('Updated — reloading');
      handover();
      return;
    }
    pollTimer = setTimeout(tick, POLL_MS);
  }

  function doReload() { if (!reloaded) { reloaded = true; location.reload(); } }

  // GUIDE §7.5 — the worker does NOT skipWaiting() in install. We tell it to take over
  // only once idle is already confirmed, so the window in which a running page is
  // backed by a new cache is milliseconds rather than minutes. That closes the
  // lifecycle route to the two-builds-on-screen bug.
  function handover() {
    if (registration && registration.waiting) {
      handoverAsked = true;
      try { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
      setTimeout(doReload, HANDOVER_MS);
      return;
    }
    doReload();
  }

  // GUIDE §7.8 — controllerchange covers two events: the first-ever clients.claim() on
  // a fresh install, and a real handover. Only the second means new code is waiting.
  var hadController = !!window.__HAD_CONTROLLER__;
  var armed = false;

  function onControllerChange() {
    if (!hadController) return;                    // first claim: not an update
    if (handoverAsked) { doReload(); return; }     // we asked, and we were idle
    if (armed) return;
    armed = true;
    reloadWhenIdle();
  }

  // ===========================================================================
  // GUIDE §7.1 — the heartbeat. Debounced and rate-limited so app-switcher thrash
  // coalesces into one check. pageshow is required alongside visibilitychange: a
  // bfcache restore does not reliably produce a visibility transition.
  // ===========================================================================
  var lastCheck = 0, checkTimer = null;

  function requestCheck() {
    if (!registration || document.visibilityState !== 'visible' || checkTimer) return;
    checkTimer = setTimeout(function () {
      checkTimer = null;
      var now = Date.now();
      if (now - lastCheck < MIN_GAP_MS) return;
      lastCheck = now;
      // .catch is mandatory: update() rejects on any network failure, and an
      // unhandled rejection here is noisy and useless.
      registration.update()['catch'](function () {});
    }, DEBOUNCE_MS);
  }

  function onResume() {
    if (document.visibilityState !== 'visible') return;
    requestCheck();
    if (looping) tick();          // re-drive a poll that was blocked while hidden
  }

  // GUIDE §7.13 — from the LIVE cache name, so it reports what is RUNNING. A constant
  // reports what was DEPLOYED, and those two disagreeing is the exact condition being
  // diagnosed — so a constant lies in the only case that matters.
  UPDATE.buildId = function () {
    if (!('caches' in window)) return Promise.resolve(null);
    return caches.keys().then(function (keys) {
      var mine = keys.filter(function (k) { return k.indexOf(CACHE_PREFIX + '-') === 0; });
      return mine.length ? mine.sort().pop() : null;
    })['catch'](function () { return null; });
  };

  UPDATE.checkNow = function () {
    if (!('serviceWorker' in navigator)) return Promise.resolve('Not supported');
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return 'Not installed';
      lastCheck = Date.now();
      return reg.update().then(function () {
        // reg.installing can be null on the tick update() resolves, and is null if the
        // worker skip-waited straight to activating. Reporting "up to date" on the very
        // load that found an update is the worst lie this button can tell, so wait for
        // updatefound with a short grace window instead.
        if (reg.installing || reg.waiting) return 'New build found — will apply when idle';
        return new Promise(function (resolve) {
          var done = false;
          var t = setTimeout(function () { if (!done) { done = true; resolve('Already up to date'); } }, 1200);
          reg.addEventListener('updatefound', function () {
            if (done) return; done = true; clearTimeout(t);
            resolve('New build found — will apply when idle');
          }, { once: true });
        });
      });
    })['catch'](function () { return 'Check failed'; });
  };

  // GUIDE §7.14 — outside this worker's scope by construction, so it can never be the
  // stale copy it exists to replace. Linked from INSIDE the app because on iOS the
  // installed app has its own storage container and clearing site data in Safari does
  // not reach it.
  UPDATE.resetUrl = '../reset/';

  function boot() {
    if (healStaleShell()) return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker.register('./sw.js', {
      scope: './',
      updateViaCache: 'none'   // GUIDE §7.3 — takes the host's max-age out of the conversation
    }).then(function (reg) {
      registration = reg;
      if (reg.waiting && hadController) reloadWhenIdle();
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && hadController) reloadWhenIdle();
        });
      });
      document.addEventListener('visibilitychange', onResume);
      window.addEventListener('pageshow', onResume);
      window.addEventListener('online', requestCheck);
      onResume();
    })['catch'](function (e) { console.warn('[update] registration failed', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
