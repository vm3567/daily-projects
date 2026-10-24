// Signing in on worktask.in, inside the one app (the owner, a manager and a team member all sign in here).
// The same card as the owner's key screen. Then, the first time (or after the manager reset it), the person
// chooses their own password before anything else.

import { h } from './dom.js';

const card = (onSubmit, ...kids) => h('form', { class: 'key-card sign-card', onSubmit },
  h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }), ...kids);
// (each box carries its own name too, so screen readers say "Username", "Password": owner, 24 Oct)
const field = (label, input) => { input.id = input.id || 'sign-' + input.getAttribute('name'); input.setAttribute('aria-label', label); return h('label', { class: 'sign-field', for: input.id }, h('span', null, label), input); };

/**
 * Username and password. onSignedIn({ token, user }) once the server says yes.
 * post(a, body) → the server's answer as { status, out } (no sign-in sent); it throws when there is no internet.
 */
export function signInCard({ post, onSignedIn, message = '' }) {
  const msg = h('p', { class: 'key-msg warn', hidden: !message }, message);
  const say = (m) => { msg.textContent = m; msg.hidden = !m; };
  let busy = false;
  return card(async (e, form) => {
    e.preventDefault();
    if (busy) return;
    const f = form || e.target;
    const username = f.elements.username.value.trim(), password = f.elements.password.value;
    if (!username || !password) { say('Type your username and password.'); return; }
    busy = true; say('');
    const btn = f.querySelector('button'); if (btn) btn.disabled = true;
    try {
      const { status, out } = await post('login', { username, password });
      if (out && out.ok && out.token && out.user) { onSignedIn({ token: out.token, user: out.user }); return; }
      say((out && out.error) || (status >= 500 ? 'Something went wrong. Try again.' : 'Wrong username or password.'));
    } catch { say('No connection. Try again when the internet is back.'); }
    busy = false; if (btn) btn.disabled = false;
  },
  h('h1', null, 'Task List'),
  h('p', null, 'Sign in with the username and password from your manager.'),
  field('Username', h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', autofocus: true })),
  field('Password', h('input', { name: 'password', type: 'password', autocomplete: 'current-password' })),
  h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
  msg);
}

/** The first password (or one the manager reset): chosen before anything else. onDone(user) after it is saved. */
export function firstPasswordCard({ api, user, onDone, onSignOut }) {
  const msg = h('p', { class: 'key-msg warn', hidden: true });
  const say = (m) => { msg.textContent = m; msg.hidden = !m; };
  let busy = false;
  return card(async (e, form) => {
    e.preventDefault();
    if (busy) return;
    const f = form || e.target;
    const old = f.elements.old.value, n1 = f.elements.new1.value, n2 = f.elements.new2.value;
    if (!old) { say('Type the password from your manager.'); return; }
    if (n1.length < 8) { say('The new password needs 8 or more characters.'); return; }
    if (n1 !== n2) { say('The two new passwords are not the same.'); return; }
    busy = true; say('');
    try {
      const out = await api('password', { old, new: n1 });
      onDone(out.user);
      return;
    } catch (ex) { say(ex.message); }
    busy = false;
  },
  h('h1', null, 'Choose your own password'),
  h('p', null, `Welcome${user && user.name ? ', ' + user.name : ''}! First choose a password only you know. 8 or more characters.`),
  field('Password from your manager', h('input', { name: 'old', type: 'password', autocomplete: 'current-password' })),
  field('New password', h('input', { name: 'new1', type: 'password', autocomplete: 'new-password', minlength: 8 })),
  field('New password again', h('input', { name: 'new2', type: 'password', autocomplete: 'new-password', minlength: 8 })),
  h('button', { class: 'btn primary', type: 'submit' }, 'Save password'),
  msg,
  onSignOut ? h('button', { class: 'link small', type: 'button', onClick: onSignOut }, 'Sign out') : null);
}
