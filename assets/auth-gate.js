/* ============================================================================
 * Redwoods — site-wide login gate + per-user cloud sync.
 * Included on EVERY page. Blocks the page with a full-screen login until the
 * user signs in; the session cookie then carries across all pages.
 * On dashboards (window.RWD_PROJECT set) it also loads & auto-saves state.
 * If the API is unreachable, offers a local-only fallback so you're never
 * fully locked out. Depends on window.RWDState only on dashboards.
 * ==========================================================================*/
(function () {
  'use strict';
  var API = window.RWD_API || '/api/api.php';
  var PROJECT = window.RWD_PROJECT || null;
  var IS_DASH = !!PROJECT;
  var state = { loggedIn: false, username: null };
  var pushTimer = null, registerMode = false;

  function api(action, opts) {
    opts = opts || {};
    return fetch(API + '?action=' + encodeURIComponent(action), {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-RWD': '1' },
      credentials: 'same-origin',
      body: opts.body || null
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        return { ok: r.ok, status: r.status, j: j };
      });
    });
  }
  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------- styles
  function injectStyles() {
    if ($('rwdg-style')) return;
    var css =
      '#rwdg-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:1.2rem;' +
      'font-family:"Plus Jakarta Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;' +
      'background:radial-gradient(1100px 560px at 50% -10%,rgba(91,80,232,0.14),transparent 60%),#0f1320;}' +
      '#rwdg-card{background:#ffffff;color:#1b2138;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,0.45);width:100%;max-width:380px;padding:2rem 1.9rem 1.7rem;text-align:center;}' +
      '#rwdg-logo{width:54px;height:54px;border-radius:15px;margin:0 auto 1rem;display:flex;align-items:center;justify-content:center;' +
      'background:linear-gradient(135deg,#5b50e8,#8b83f5);color:#fff;font-weight:800;font-size:1.3rem;box-shadow:0 8px 22px rgba(91,80,232,0.4);}' +
      '#rwdg-eyebrow{font-size:0.64rem;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#9aa2b4;}' +
      '#rwdg-title{font-size:1.35rem;font-weight:800;letter-spacing:-0.02em;margin:0.25rem 0 0.3rem;}' +
      '#rwdg-sub{font-size:0.82rem;color:#6b7385;line-height:1.5;margin-bottom:1.3rem;}' +
      '.rwdg-inp{width:100%;box-sizing:border-box;padding:11px 13px;margin-bottom:9px;border:1px solid rgba(28,35,60,0.18);border-radius:11px;background:#f4f6fa;color:#1b2138;font-family:inherit;font-size:0.92rem;}' +
      '.rwdg-inp:focus{outline:none;border-color:#5b50e8;background:#fff;}' +
      '#rwdg-msg{font-size:0.76rem;min-height:17px;margin:1px 0 9px;color:#e5533c;text-align:left;}' +
      '#rwdg-go{width:100%;padding:12px;border:none;border-radius:12px;background:#5b50e8;color:#fff;font-family:inherit;font-size:0.95rem;font-weight:700;cursor:pointer;transition:background .15s;}' +
      '#rwdg-go:hover{background:#4b41d6;}#rwdg-go:disabled{opacity:0.6;cursor:default;}' +
      '#rwdg-toggle{margin-top:0.9rem;font-size:0.8rem;color:#6b7385;}' +
      '#rwdg-toggle b{color:#5b50e8;font-weight:700;cursor:pointer;}' +
      '#rwdg-offline{margin-top:1rem;display:none;}' +
      '#rwdg-offline button{background:none;border:none;color:#9aa2b4;font-family:inherit;font-size:0.76rem;text-decoration:underline;cursor:pointer;}' +
      '#rwdg-spin{width:30px;height:30px;border:3px solid rgba(91,80,232,0.25);border-top-color:#5b50e8;border-radius:50%;margin:1rem auto;animation:rwdgspin 0.8s linear infinite;}' +
      '@keyframes rwdgspin{to{transform:rotate(360deg);}}' +
      '#rwdg-chip{position:fixed;bottom:14px;right:14px;z-index:2147482000;font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
      '#rwdg-chip-btn{display:flex;align-items:center;gap:7px;background:rgba(27,33,56,0.92);color:#fff;border:none;border-radius:999px;padding:8px 14px;font-size:0.76rem;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,0.25);}' +
      '#rwdg-chip-dot{width:7px;height:7px;border-radius:50%;background:#34c281;}' +
      '#rwdg-chip-menu{position:absolute;bottom:42px;right:0;background:#fff;color:#1b2138;border:1px solid rgba(28,35,60,0.12);border-radius:11px;box-shadow:0 12px 30px rgba(0,0,0,0.2);padding:6px;display:none;min-width:150px;}' +
      '#rwdg-chip-menu .who{font-size:0.7rem;color:#9aa2b4;padding:6px 9px 4px;}' +
      '#rwdg-chip-menu button{display:block;width:100%;text-align:left;background:none;border:none;padding:8px 9px;border-radius:8px;font-family:inherit;font-size:0.82rem;color:#1b2138;cursor:pointer;}' +
      '#rwdg-chip-menu button:hover{background:#f4f6fa;}';
    var s = document.createElement('style'); s.id = 'rwdg-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------- gate DOM
  function buildGate() {
    if ($('rwdg-gate')) return;
    var g = document.createElement('div'); g.id = 'rwdg-gate';
    g.innerHTML =
      '<div id="rwdg-card" role="dialog" aria-modal="true" aria-label="Sign in">' +
        '<div id="rwdg-logo">R</div>' +
        '<div id="rwdg-eyebrow">Redwoods Solutions</div>' +
        '<div id="rwdg-title">Checking…</div>' +
        '<div id="rwdg-sub">Verifying your session.</div>' +
        '<div id="rwdg-spin"></div>' +
        '<div id="rwdg-form" style="display:none;">' +
          '<input id="rwdg-u" class="rwdg-inp" placeholder="Username" autocomplete="username">' +
          '<input id="rwdg-p" class="rwdg-inp" type="password" placeholder="Password" autocomplete="current-password">' +
          '<input id="rwdg-code" class="rwdg-inp" placeholder="Signup code" style="display:none;">' +
          '<div id="rwdg-msg"></div>' +
          '<button id="rwdg-go">Sign in</button>' +
          '<div id="rwdg-toggle">New here? <b>Create an account</b></div>' +
        '</div>' +
        '<div id="rwdg-offline"><button>Continue offline (local only)</button></div>' +
      '</div>';
    document.body.appendChild(g);
    $('rwdg-toggle').querySelector('b').addEventListener('click', toggleMode);
    $('rwdg-go').addEventListener('click', submit);
    $('rwdg-p').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('rwdg-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('rwdg-offline').querySelector('button').addEventListener('click', function () { hideGate(); });
  }
  function showForm(mode) {
    $('rwdg-spin').style.display = 'none';
    $('rwdg-form').style.display = 'block';
    $('rwdg-title').textContent = 'Sign in';
    $('rwdg-sub').textContent = 'This workspace is private. Sign in to continue.';
    if (mode === 'offline') {
      $('rwdg-sub').textContent = 'Couldn’t reach the server.';
      $('rwdg-form').style.display = 'none';
      $('rwdg-spin').style.display = 'none';
      $('rwdg-offline').style.display = 'block';
      $('rwdg-title').textContent = 'Server unavailable';
    }
  }
  function toggleMode() {
    registerMode = !registerMode;
    $('rwdg-title').textContent = registerMode ? 'Create account' : 'Sign in';
    $('rwdg-code').style.display = registerMode ? 'block' : 'none';
    $('rwdg-go').textContent = registerMode ? 'Create account' : 'Sign in';
    $('rwdg-toggle').innerHTML = registerMode ? 'Have an account? <b>Sign in</b>' : 'New here? <b>Create an account</b>';
    $('rwdg-toggle').querySelector('b').addEventListener('click', toggleMode);
    $('rwdg-p').setAttribute('autocomplete', registerMode ? 'new-password' : 'current-password');
    msg('');
  }
  function msg(t) { var m = $('rwdg-msg'); if (m) m.textContent = t || ''; }

  function submit() {
    var u = ($('rwdg-u').value || '').trim(), p = $('rwdg-p').value || '', code = ($('rwdg-code').value || '').trim();
    if (!u || !p) { msg('Enter a username and password.'); return; }
    $('rwdg-go').disabled = true; msg('');
    var action = registerMode ? 'register' : 'login';
    var payload = registerMode ? { username: u, password: p, code: code } : { username: u, password: p };
    api(action, { method: 'POST', body: JSON.stringify(payload) }).then(function (res) {
      $('rwdg-go').disabled = false;
      if (res.ok && res.j && res.j.ok) { onAuthed(res.j.username); }
      else { msg((res.j && res.j.error) || 'Something went wrong.'); }
    }).catch(function () { $('rwdg-go').disabled = false; msg('Could not reach the server.'); });
  }

  function hideGate() { var g = $('rwdg-gate'); if (g) g.parentNode.removeChild(g); }

  function onAuthed(username) {
    state.loggedIn = true; state.username = username;
    hideGate();
    buildChip();
    if (IS_DASH) { loadCloud(); wireAutosave(); }
  }

  // ---------------------------------------------------------------- account chip
  function buildChip() {
    if ($('rwdg-chip')) { updateChip(); return; }
    var c = document.createElement('div'); c.id = 'rwdg-chip';
    c.innerHTML =
      '<button id="rwdg-chip-btn"><span id="rwdg-chip-dot"></span><span id="rwdg-chip-name"></span></button>' +
      '<div id="rwdg-chip-menu"><div class="who" id="rwdg-chip-who"></div>' +
      (IS_DASH ? '<button id="rwdg-chip-save">Save to cloud now</button>' : '') +
      '<button id="rwdg-chip-logout">Sign out</button></div>';
    document.body.appendChild(c);
    $('rwdg-chip-btn').addEventListener('click', function () {
      var m = $('rwdg-chip-menu'); m.style.display = m.style.display === 'block' ? 'none' : 'block';
    });
    $('rwdg-chip-logout').addEventListener('click', logout);
    if ($('rwdg-chip-save')) $('rwdg-chip-save').addEventListener('click', function () { pushCloud(false); $('rwdg-chip-menu').style.display = 'none'; });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('#rwdg-chip')) { var m = $('rwdg-chip-menu'); if (m) m.style.display = 'none'; }
    });
    updateChip();
  }
  function updateChip(status) {
    var n = $('rwdg-chip-name'), w = $('rwdg-chip-who');
    if (n) n.textContent = '☁ ' + state.username + (status ? ' · ' + status : '');
    if (w) w.textContent = 'Signed in as ' + state.username;
  }

  function logout() {
    api('logout', { method: 'POST' }).then(function () { location.reload(); })
      .catch(function () { location.reload(); });
  }

  // ---------------------------------------------------------------- cloud state (dashboards)
  function loadCloud() {
    updateChip('loading…');
    api('load?project=' + encodeURIComponent(PROJECT)).then(function (res) {
      if (res.ok && res.j && res.j.ok) {
        if (res.j.data && window.RWDState && window.RWDState.apply) {
          try { window.RWDState.apply(res.j.data); } catch (e) {}
          updateChip('synced');
        } else { pushCloud(true); }
      }
      setTimeout(function () { updateChip(); }, 1500);
    }).catch(function () { updateChip(); });
  }
  function pushCloud(silent) {
    if (!state.loggedIn || !window.RWDState || !window.RWDState.read) return;
    if (!silent) updateChip('saving…');
    var data = window.RWDState.read();
    api('save', { method: 'POST', body: JSON.stringify({ project: PROJECT, data: data }) }).then(function (res) {
      if (res.ok && res.j && res.j.ok) updateChip('synced');
      else if (res.status === 401) location.reload();
      else updateChip('sync error');
      setTimeout(function () { updateChip(); }, 1500);
    }).catch(function () { updateChip('offline'); });
  }
  function schedulePush() { if (!state.loggedIn) return; clearTimeout(pushTimer); pushTimer = setTimeout(function () { pushCloud(false); }, 1500); }
  function wireAutosave() {
    document.addEventListener('input', schedulePush, true);
    document.addEventListener('change', schedulePush, true);
    document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#rwdg-chip')) return; schedulePush(); }, true);
  }

  // ---------------------------------------------------------------- init
  function init() {
    injectStyles();
    buildGate();
    api('me').then(function (res) {
      if (res.j && typeof res.j.loggedIn !== 'undefined') {
        if (res.j.loggedIn) { onAuthed(res.j.username); }
        else { showForm('login'); }
      } else {
        // API reachable but unexpected response, or not configured → offer offline escape
        showForm('offline');
      }
    }).catch(function () { showForm('offline'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
