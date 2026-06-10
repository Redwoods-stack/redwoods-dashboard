/* ============================================================================
 * Redwoods dashboard — cloud sync (per-user accounts)
 * Adds a small account widget to the rail; logs in via /api/api.php; loads &
 * auto-saves the dashboard state per user. Falls back silently to local-only
 * (localStorage) if the API isn't set up or is unreachable. Depends on
 * window.RWDState (exposed by each dashboard) and window.RWD_PROJECT.
 * ==========================================================================*/
(function () {
  'use strict';
  var PROJECT = window.RWD_PROJECT || 'app';
  var API = window.RWD_API || '/api/api.php';
  var state = { ready: false, loggedIn: false, username: null, available: true };
  var pushTimer = null;

  function api(action, opts) {
    opts = opts || {};
    return fetch(API + '?action=' + encodeURIComponent(action), {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-RWD': '1' },
      credentials: 'same-origin',
      body: opts.body || null
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, status: r.status, j: j };
      });
    });
  }

  // ---- tiny DOM helpers ----
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function $(id) { return document.getElementById(id); }

  // ---- account button (in the rail footer) ----
  function buildButton() {
    var foot = document.querySelector('.rail-foot');
    if (!foot) return;
    var btn = el('button', {
      id: 'rwd-acct', class: 'theme-toggle',
      style: 'margin-bottom:8px;justify-content:space-between;'
    }, '<span id="rwd-acct-label">☁ Sign in to sync</span><span id="rwd-acct-dot">○</span>');
    btn.addEventListener('click', openModal);
    foot.insertBefore(btn, foot.firstChild);
  }
  function renderButton() {
    var lbl = $('rwd-acct-label'), dot = $('rwd-acct-dot');
    if (!lbl) return;
    if (!state.available) { lbl.textContent = '☁ Cloud sync offline'; dot.textContent = '○'; dot.style.color = 'var(--text3)'; return; }
    if (state.loggedIn) { lbl.textContent = '☁ ' + state.username; dot.textContent = '●'; dot.style.color = 'var(--green)'; }
    else { lbl.textContent = '☁ Sign in to sync'; dot.textContent = '○'; dot.style.color = 'var(--text3)'; }
  }
  function setStatus(text, color) {
    var dot = $('rwd-acct-dot'), lbl = $('rwd-acct-label');
    if (lbl && state.loggedIn) lbl.textContent = '☁ ' + state.username + (text ? ' · ' + text : '');
    if (dot && color) dot.style.color = color;
  }

  // ---- modal ----
  function buildModal() {
    var ov = el('div', { id: 'rwd-modal', style:
      'position:fixed;inset:0;background:rgba(10,14,25,0.55);display:none;align-items:center;justify-content:center;z-index:9999;padding:1rem;' });
    ov.innerHTML =
      '<div role="dialog" aria-modal="true" style="background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.35);width:100%;max-width:360px;padding:1.5rem 1.5rem 1.3rem;font-family:inherit;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.2rem;">' +
          '<div id="rwd-m-title" style="font-size:1.05rem;font-weight:800;letter-spacing:-0.01em;">Sign in to sync</div>' +
          '<button id="rwd-m-x" aria-label="Close" style="background:none;border:none;color:var(--text3);font-size:1.2rem;cursor:pointer;line-height:1;">×</button>' +
        '</div>' +
        '<div id="rwd-m-sub" style="font-size:0.78rem;color:var(--text2);margin-bottom:1rem;line-height:1.5;">Your sliders, scenario and theme save to your account and follow you to any device.</div>' +
        '<div id="rwd-m-forms">' +
          '<input id="rwd-u" placeholder="Username" autocomplete="username" style="' + inp() + '">' +
          '<input id="rwd-p" type="password" placeholder="Password" autocomplete="current-password" style="' + inp() + '">' +
          '<input id="rwd-code" placeholder="Signup code (new accounts only)" style="' + inp() + 'display:none;">' +
          '<div id="rwd-msg" style="font-size:0.76rem;min-height:16px;margin:2px 0 8px;color:var(--red);"></div>' +
          '<button id="rwd-go" style="' + primaryBtn() + '">Sign in</button>' +
          '<div style="text-align:center;margin-top:0.7rem;font-size:0.78rem;color:var(--text2);">' +
            '<span id="rwd-toggle-mode" style="color:var(--accent);font-weight:600;cursor:pointer;">Create an account</span>' +
          '</div>' +
        '</div>' +
        '<div id="rwd-m-account" style="display:none;">' +
          '<div style="font-size:0.85rem;margin-bottom:1rem;">Signed in as <strong id="rwd-who"></strong>. Changes auto-save to the cloud.</div>' +
          '<button id="rwd-logout" style="' + primaryBtn() + '">Log out</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    $('rwd-m-x').addEventListener('click', closeModal);
    $('rwd-toggle-mode').addEventListener('click', toggleMode);
    $('rwd-go').addEventListener('click', submit);
    $('rwd-logout').addEventListener('click', logout);
    $('rwd-p').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('rwd-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }
  function inp() { return 'width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:9px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3);color:var(--text);font-family:inherit;font-size:0.9rem;'; }
  function primaryBtn() { return 'width:100%;padding:11px;border:none;border-radius:11px;background:var(--accent);color:#fff;font-family:inherit;font-size:0.92rem;font-weight:700;cursor:pointer;'; }

  var registerMode = false;
  function toggleMode() {
    registerMode = !registerMode;
    $('rwd-m-title').textContent = registerMode ? 'Create an account' : 'Sign in to sync';
    $('rwd-code').style.display = registerMode ? 'block' : 'none';
    $('rwd-go').textContent = registerMode ? 'Create account' : 'Sign in';
    $('rwd-toggle-mode').textContent = registerMode ? 'I already have an account' : 'Create an account';
    $('rwd-p').setAttribute('autocomplete', registerMode ? 'new-password' : 'current-password');
    msg('');
  }
  function msg(t, ok) { var m = $('rwd-msg'); if (m) { m.textContent = t || ''; m.style.color = ok ? 'var(--green)' : 'var(--red)'; } }

  function openModal() {
    if (!$('rwd-modal')) return;
    // logged-in view vs forms
    $('rwd-m-forms').style.display = state.loggedIn ? 'none' : 'block';
    $('rwd-m-account').style.display = state.loggedIn ? 'block' : 'none';
    if (state.loggedIn) { $('rwd-who').textContent = state.username; $('rwd-m-title').textContent = 'Account'; $('rwd-m-sub').style.display = 'none'; }
    else { $('rwd-m-sub').style.display = 'block'; if (!state.available) msg('Cloud sync isn’t set up on the server yet.'); }
    $('rwd-modal').style.display = 'flex';
  }
  function closeModal() { var m = $('rwd-modal'); if (m) m.style.display = 'none'; msg(''); }

  function submit() {
    var u = ($('rwd-u').value || '').trim(), p = $('rwd-p').value || '', code = ($('rwd-code').value || '').trim();
    if (!u || !p) { msg('Enter a username and password.'); return; }
    $('rwd-go').disabled = true; msg(registerMode ? 'Creating account…' : 'Signing in…', true);
    var action = registerMode ? 'register' : 'login';
    var payload = registerMode ? { username: u, password: p, code: code } : { username: u, password: p };
    api(action, { method: 'POST', body: JSON.stringify(payload) }).then(function (res) {
      $('rwd-go').disabled = false;
      if (res.ok && res.j && res.j.ok) {
        state.loggedIn = true; state.username = res.j.username; state.available = true;
        renderButton(); closeModal(); loadCloud();
      } else {
        msg((res.j && res.j.error) || 'Something went wrong.');
      }
    }).catch(function () { $('rwd-go').disabled = false; state.available = false; msg('Could not reach the server.'); });
  }

  function logout() {
    api('logout', { method: 'POST' }).then(function () {
      state.loggedIn = false; state.username = null; renderButton(); closeModal();
    }).catch(function () {});
  }

  function loadCloud() {
    if (!state.loggedIn) return;
    setStatus('loading…');
    api('load?project=' + encodeURIComponent(PROJECT)).then(function (res) {
      if (res.ok && res.j && res.j.ok) {
        if (res.j.data && window.RWDState && window.RWDState.apply) {
          try { window.RWDState.apply(res.j.data); } catch (e) {}
          setStatus('synced', 'var(--green)');
        } else {
          // No cloud state yet — push the current local state up as the starting point.
          pushCloud(true);
        }
      }
      setTimeout(function () { setStatus(''); }, 1500);
    }).catch(function () {});
  }

  function pushCloud(silent) {
    if (!state.loggedIn || !window.RWDState || !window.RWDState.read) return;
    if (!silent) setStatus('saving…', 'var(--amber)');
    var data = window.RWDState.read();
    api('save', { method: 'POST', body: JSON.stringify({ project: PROJECT, data: data }) }).then(function (res) {
      if (res.ok && res.j && res.j.ok) setStatus('synced', 'var(--green)');
      else if (res.status === 401) { state.loggedIn = false; renderButton(); }
      else setStatus('sync error', 'var(--red)');
      setTimeout(function () { setStatus(''); }, 1500);
    }).catch(function () { setStatus('offline', 'var(--text3)'); });
  }

  function schedulePush() {
    if (!state.loggedIn) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushCloud(false); }, 1500);
  }

  function init() {
    buildButton();
    buildModal();
    renderButton();
    // Auto-save to cloud on any change (sliders, scenario/theme/tab clicks)
    document.addEventListener('input', schedulePush, true);
    document.addEventListener('change', schedulePush, true);
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#rwd-modal')) return; // ignore modal clicks
      schedulePush();
    }, true);
    // Check existing session
    api('me').then(function (res) {
      if (res.j && typeof res.j.loggedIn !== 'undefined') {
        state.available = true;
        if (res.j.loggedIn) { state.loggedIn = true; state.username = res.j.username; renderButton(); loadCloud(); }
      } else { state.available = false; }
      renderButton();
    }).catch(function () { state.available = false; renderButton(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);
})();
