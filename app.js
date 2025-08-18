/* CalcChat main client */

const sb = window.sb;
// Boot log to confirm script loaded
try { console.debug('[CalcChat] app.js loaded'); } catch {}

// Tenor GIF/Stickers Picker Logic
function openGifPicker(kind = 'gifs') {
  gifKind = kind === 'stickers' ? 'stickers' : 'gifs';
  if (gifTabs) {
    gifTabs.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.kind===gifKind));
  }
  if (gifSearch) gifSearch.value = '';
  if (gifGrid) { gifGrid.innerHTML = ''; gifGrid.scrollTop = 0; }
  gifNextPos = null;
  if (gifModal && typeof gifModal.showModal === 'function') gifModal.showModal();
  reloadGifResults();
}

function reloadGifResults() {
  gifNextPos = null;
  if (gifGrid) { gifGrid.innerHTML = ''; gifGrid.scrollTop = 0; }
  loadMoreGifs(true);
}

async function loadMoreGifs(isFirst = false) {
  if (gifLoading) return; gifLoading = true;
  try {
    const q = (gifSearch?.value || '').trim();
    const { results, next } = await fetchTenor({ kind: gifKind, q, pos: gifNextPos });
    gifNextPos = next || null;
    if (!results || !results.length) {
      if (isFirst && gifGrid) {
        const empty = document.createElement('div'); empty.className = 'gif-empty';
        empty.textContent = 'No results.'; gifGrid.appendChild(empty);
      }
      return;
    }
    const frag = document.createDocumentFragment();
    for (const r of results) {
      const url = pickTenorUrl(r);
      if (!url) continue;
      const tile = document.createElement('div'); tile.className = 'gif-tile';
      const img = document.createElement('img'); img.src = url; img.loading = 'lazy'; img.alt = 'GIF';
      tile.appendChild(img);
      tile.addEventListener('click', async () => {
        try {
          await sendGifMessage(url, gifKind === 'stickers' ? 'sticker' : 'gif');
          if (gifModal) gifModal.close();
        } catch (e) { toast('error','Send failed', String(e?.message||e)); }
      });
      frag.appendChild(tile);
    }
    if (gifGrid) gifGrid.appendChild(frag);
  } finally {
    gifLoading = false;
  }
}

function pickTenorUrl(item) {
  try {
    const fm = item.media_formats || {};
    return (
      fm.nanogif?.url ||
      fm.tinygif?.url ||
      fm.gif?.url ||
      fm.mediumgif?.url ||
      null
    );
  } catch { return null; }
}

async function fetchTenor({ kind = 'gifs', q = '', pos = null } = {}) {
  const key = window.TENOR_API_KEY;
  const base = 'https://tenor.googleapis.com/v2';
  const isSearch = !!q;
  const ep = isSearch ? 'search' : 'featured';
  const params = new URLSearchParams();
  params.set('key', key || '');
  params.set('limit', '24');
  params.set('media_filter', 'gif');
  params.set('contentfilter', 'high');
  if (kind === 'stickers') params.set('searchfilter', 'sticker');
  if (isSearch) params.set('q', q);
  if (pos) params.set('pos', pos);
  const url = `${base}/${ep}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Tenor request failed');
  const data = await res.json();
  return { results: data.results || [], next: data.next };
}

async function sendGifMessage(url, type) {
  if (!activePeerId) throw new Error('No chat selected');
  const { data: rows, error } = await sb.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: activePeerId,
    // Use the real media type now that DB allows it
    type,
    content: url,
    reply_to_id: replyTarget ? replyTarget.id : null
  }).select('*');
  if (error) throw error;
  if (rows && rows.length) rows.forEach(r => renderMessage(r));
  replyTarget = null; updateReplyBar();
}

// Update all reply preview blocks that reference a given base message id
function refreshReplyPreviewsFor(baseId) {
  try {
    const base = messagesById.get(baseId);
    const blocks = messagesEl?.querySelectorAll(`.reply-block[data-reply-id="${baseId}"]`) || [];
    blocks.forEach((rb) => {
      const rs = rb.querySelector('.reply-snippet');
      if (!rs) return;
      let thumb = rs.querySelector('img.reply-thumb');
      let text = rs.querySelector('span');
      if (!text) { text = document.createElement('span'); rs.appendChild(text); }
      if (base) {
        text.textContent = messageSnippet(base);
        if ((base.type === 'image' || base.type === 'gif' || base.type === 'sticker') && base.content) {
          if (!thumb) { thumb = document.createElement('img'); thumb.className = 'reply-thumb'; rs.prepend(thumb); }
          thumb.src = base.content; thumb.hidden = false;
        } else if (thumb) {
          thumb.hidden = true;
        }
      } else {
        text.textContent = '…';
      }
    });
  } catch {}
}

// (moved) image viewer wiring comes after DOM refs are set

function renderImage(url) {
  const wrap = document.createElement('div');
  wrap.className = 'image-wrap';
  const img = document.createElement('img');
  img.className = 'image';
  img.src = url;
  img.alt = 'Image';
  img.loading = 'lazy';
  wrap.appendChild(img);
  return wrap;
}
let session = null;
let currentUser = null; // { id, email }

// Theme + Avatar helpers
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
    if (btnTheme) btnTheme.textContent = '☀️';
  } else {
    root.removeAttribute('data-theme');
    if (btnTheme) btnTheme.textContent = '🌙';
  }
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const current = localStorage.getItem('theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }
}

function initialsFromName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const a = (parts[0] || '').charAt(0).toUpperCase();
  const b = (parts[1] || '').charAt(0).toUpperCase();
  return (a + b).trim() || (name || 'U').charAt(0).toUpperCase();
}

function colorFromString(str) {
  let h = 0; for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i))>>>0;
  const hue = h % 360; return `hsl(${hue} 60% 40%)`;
}

function setAvatar(el, name, url) {
  if (!el) return;
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  if (url) {
    el.textContent = '';
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundColor = '#222';
  } else {
    el.textContent = initialsFromName(name);
    el.style.background = colorFromString(name || 'User');
  }
}

function updatePeerHeader(user) {
  if (!user) return;
  peerName.textContent = user.username || 'User';
  peerStatus.textContent = user.is_online ? 'Active now' : (user.last_active ? formatTimeAgo(user.last_active) : 'Offline');
  setAvatar(peerAvatar, user.username || 'User', user.avatar_url);
}
let meProfile = null;   // fetched profile
let activePeerId = null;
let messageUnsub = null;
const hiddenMsgKey = () => currentUser && activePeerId ? `hide_${currentUser.id}_${activePeerId}` : null;
function getHiddenSet() {
  try { const k = hiddenMsgKey(); if (!k) return new Set(); return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); }
}
function setHiddenSet(s) {
  try { const k = hiddenMsgKey(); if (!k) return; localStorage.setItem(k, JSON.stringify(Array.from(s))); } catch {}
}

// Edit policy
const EDIT_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
let UNLIMITED_EDIT = true; // enable unlimited edits for now; change to false to enforce limit
function canEditMessage(m) {
  if (UNLIMITED_EDIT) return true;
  const created = new Date(m.created_at).getTime();
  return Date.now() - created <= EDIT_LIMIT_MS;
}

// UI Elements
const calcDisplay = document.getElementById('calc-display');
const calcKeys = document.querySelectorAll('.calc-keys button');
const lockHint = document.getElementById('lock-hint');
const calculatorScreen = document.getElementById('calculator-screen');
const chatScreen = document.getElementById('chat-screen');

const btnOpenAuth = document.getElementById('btn-open-auth');
const btnLogout = document.getElementById('btn-logout');
const btnPasscode = document.getElementById('btn-passcode');
const btnTheme = document.getElementById('btn-theme');
const btnBack = document.getElementById('btn-back');
const authModal = document.getElementById('auth-modal');
const authForms = document.getElementById('auth-forms');
const authError = document.getElementById('auth-error');
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const authClose = document.getElementById('auth-close');

const signupEmail = document.getElementById('signup-email');
const signupUsername = document.getElementById('signup-username');
const signupPassword = document.getElementById('signup-password');
const btnSignup = document.getElementById('btn-signup');

const signinEmail = document.getElementById('signin-email');
const signinPassword = document.getElementById('signin-password');
const btnSignin = document.getElementById('btn-signin');
// Optional passcode at signup
const signupPass1 = document.getElementById('signup-passcode1');
const signupPass2 = document.getElementById('signup-passcode2');

const passcodeModal = document.getElementById('passcode-modal');
const passcodeForm = document.getElementById('passcode-form');
const pass1 = document.getElementById('passcode1');
const pass2 = document.getElementById('passcode2');
const passErr = document.getElementById('passcode-error');
const passcodeClose = document.getElementById('passcode-close');
const btnSavePasscode = document.getElementById('btn-save-passcode');

const meUsername = document.getElementById('me-username');
const meStatus = document.getElementById('me-status');
const meAvatar = document.getElementById('me-avatar');
const userList = document.getElementById('user-list');
const userSearch = document.getElementById('user-search');
const convoHeader = document.getElementById('conversation-header');
const peerAvatar = document.getElementById('peer-avatar');
const peerName = document.getElementById('peer-name');
const peerStatus = document.getElementById('peer-status');
const messagesEl = document.getElementById('messages');
const msgForm = document.getElementById('message-form');
const msgInput = document.getElementById('message-input');
const btnAttach = document.getElementById('btn-attach');
const imageInput = document.getElementById('image-input');
// GIF/Stickers picker elements
const btnGif = document.getElementById('btn-gif');
const gifModal = document.getElementById('gif-modal');
const gifGrid = document.getElementById('gif-grid');
const gifSearch = document.getElementById('gif-search');
const gifClose = document.getElementById('gif-close');
const gifTabs = document.getElementById('gif-tabs');
let gifKind = 'gifs'; // 'gifs' | 'stickers'
let gifNextPos = null;
let gifLoading = false;
const toastsEl = document.getElementById('toasts');
// Image viewer modal elements
const iv = document.getElementById('image-viewer');
const ivImg = document.getElementById('iv-img');
const ivClose = document.getElementById('iv-close');
// Reply bar elements
const replyBar = document.getElementById('reply-bar');
const replyTitle = document.getElementById('reply-title');
const replySnippet = document.getElementById('reply-snippet');
const replyThumb = document.getElementById('reply-thumb');
const replyCancel = document.getElementById('reply-cancel');
let replyTarget = null;
const messagesById = new Map();

// Profile modal elements
const profileModal = document.getElementById('profile-modal');
const profileForm = document.getElementById('profile-form');
const profileUsername = document.getElementById('profile-username');
const profileAvatarInput = document.getElementById('profile-avatar');
const profilePreview = document.getElementById('profile-preview');
const profileError = document.getElementById('profile-error');
const btnEditProfile = document.getElementById('btn-edit-profile');
const btnRemoveAvatar = document.getElementById('btn-remove-avatar');

// Image viewer wiring (now safe: DOM refs exist)
if (messagesEl && iv && ivImg) {
  messagesEl.addEventListener('click', (e) => {
    const img = e.target && e.target.closest && e.target.closest('img.image');
    if (!img) return;
    try { ivImg.src = img.src; } catch {}
    if (iv.showModal) iv.showModal();
  });
}
if (ivClose && iv) {
  ivClose.addEventListener('click', () => { try { iv.close(); } catch {} });
}
if (iv) {
  iv.addEventListener('click', (e) => {
    // Close when clicking backdrop (dialog itself)
    if (e.target === iv) { try { iv.close(); } catch {} }
  });
}
const btnSaveProfile = document.getElementById('btn-save-profile');
const btnProfileClose = document.getElementById('profile-close');
const btnUploadAvatar = document.getElementById('btn-upload-avatar');
const profileDropzone = document.getElementById('profile-dropzone');
let removeAvatarRequested = false;

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getCurrentUserSafe() {
  if (currentUser) return currentUser;
  try {
    const { data } = await sb.auth.getUser();
    currentUser = data?.user || null;
  } catch {}
  return currentUser;
}
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.classList.remove('active');
  view.classList.add('active');
  updatePasscodeButtonVisibility();
}
function isLoggedIn(){ return !!currentUser; }
function onChatScreen(){ return chatScreen?.classList.contains('active'); }
function updatePasscodeButtonVisibility(){
  if (!btnPasscode) return;
  // Show only when logged in AND chat screen is active
  const visible = isLoggedIn() && onChatScreen();
  btnPasscode.hidden = !visible;
}
function setLoggedInUI(loggedIn) {
  if (btnLogout) btnLogout.hidden = !loggedIn;
  updatePasscodeButtonVisibility();
  if (btnOpenAuth) btnOpenAuth.hidden = !!loggedIn;
  if (btnEditProfile) btnEditProfile.hidden = !loggedIn;
  if (!loggedIn) {
    meUsername.textContent = 'Anonymous';
    meStatus.textContent = 'Offline';
    setAvatar(meAvatar, 'Anonymous', null);
  }
}
function shake(el) {
  el.style.transition = 'transform .1s';
  el.style.transform = 'translateX(-6px)';
  setTimeout(()=> el.style.transform = 'translateX(6px)', 100);
  setTimeout(()=> el.style.transform = 'translateX(0)', 200);
}
function formatTimeAgo(ts) {
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
function isTikTokUrl(text) {
  try { const u = new URL(text); return u.hostname.includes('tiktok.com'); } catch { return false; }
}
function renderTikTokEmbed(url) {
  const w = document.createElement('div');
  w.className = 'tiktok-embed-wrap';
  w.innerHTML = `<blockquote class="tiktok-embed" cite="${url}" data-video-id="" style="max-width: 605px;min-width: 325px;">
      <section> </section>
    </blockquote>
  `;
  // ensure embed script loads/refreshes
  const existing = document.querySelector('script[src="https://www.tiktok.com/embed.js"]');
  if (existing) existing.remove();
  const s = document.createElement('script');
  s.src = 'https://www.tiktok.com/embed.js';
  s.async = true;
  document.body.appendChild(s);
  return wrap;
}

// Toasts
function toast(type, title, msg) {
  if (!toastsEl) return;
  const t = document.createElement('div');
  t.className = `toast ${type || ''}`.trim();
  t.innerHTML = `<div class="title">${title || ''}</div><div class="msg">${msg || ''}</div>`;
  toastsEl.appendChild(t);
  setTimeout(()=> { t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; }, 3500);
  setTimeout(()=> t.remove(), 4000);
}

// Calculator state
let input = '';
function updateDisplay() {
  calcDisplay.textContent = input || '0';
}
calcKeys.forEach(btn => {
  btn.addEventListener('click', async () => {
    const k = btn.dataset.key;
    if (k === 'C') { input = ''; }
    else if (k === '⌫') { input = input.slice(0, -1); }
    else if (k === '=') {
      if (!session) {
        // calculator mode before login
        try {
          // simple calc: eval digits only
          calcDisplay.textContent = input || '0';
        } catch {}
        return;
      }
      // verify passcode
      if (!input) return;
      const { data, error } = await sb.rpc('verify_passcode', { passcode: input });
      if (error) {
        console.error(error); shake(calcDisplay); return;
      }
      if (data === true) {
        input = ''; updateDisplay();
        await enterChat();
      } else {
        shake(calcDisplay);
      }
    } else {
      if (/^[0-9]$/.test(k)) input += k;
    }
    updateDisplay();
  });
});

// Auth modal tabs
for (const t of tabs) {
  t.addEventListener('click', () => {
    tabs.forEach(x=>x.classList.remove('active'));
    panels.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab).classList.add('active');
  });
}

btnOpenAuth.addEventListener('click', () => authModal.showModal());

btnPasscode.addEventListener('click', async () => {
  await refreshSession();
  if (!currentUser) { toast('error','Not signed in','Please sign in first.'); return; }
  // reload profile to check passcode
  const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  meProfile = data;
  pass1.value = pass2.value = '';
  passErr.hidden = true;
  passcodeModal.showModal();
});

// Note: auth close button may not exist; close handlers are added later with guards

btnSignup.addEventListener('click', async () => {
  authError.hidden = true;
  const email = signupEmail.value.trim();
  const username = signupUsername.value.trim();
  const password = signupPassword.value;
  if (!email || !username || !password) return;
  btnSignup.disabled = true; btnSignup.textContent = 'Creating...';
  try {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
    if (error) { throw error; }
    // If email confirmations are off, session may already be present.
    if (data?.session) {
      await refreshSession();
      await ensureProfile(username);
      // If user provided a valid passcode during signup, set it now
      const p1 = signupPass1?.value?.trim() || '';
      const p2 = signupPass2?.value?.trim() || '';
      if (p1 && /^[0-9]{4,}$/.test(p1) && p1 === p2) {
        const { error: pcErr } = await sb.rpc('set_passcode', { passcode: p1 });
        if (!pcErr) {
          const { data: me } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
          meProfile = me;
        }
      }
      toast('success','Account created','You are signed in.');
      authModal.close();
      await ensurePasscode();
      show(calculatorScreen);
      return;
    }
    // If session missing, attempt immediate sign in
    // Stash pending passcode to apply right after sign-in
    (function stashPendingPasscode(){
      const p1 = signupPass1?.value?.trim() || '';
      const p2 = signupPass2?.value?.trim() || '';
      if (p1 && /^[0-9]{4,}$/.test(p1) && p1 === p2) {
        try { sessionStorage.setItem('pending_passcode', p1); } catch {}
      }
    })();
    const { error: siErr } = await sb.auth.signInWithPassword({ email, password });
    if (siErr) {
      toast('success','Account created','Now sign in with your credentials.');
    } else {
      // onAuthStateChange will handle next steps
    }
  } catch (e) {
    authError.textContent = e?.message || 'Sign up failed'; authError.hidden = false; toast('error','Sign up failed', authError.textContent);
  } finally {
    btnSignup.disabled = false; btnSignup.textContent = 'Create Account';
  }
});

btnSignin.addEventListener('click', async () => {
  authError.hidden = true;
  const email = signinEmail.value.trim();
  const password = signinPassword.value;
  btnSignin.disabled = true; btnSignin.textContent = 'Signing in...';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { throw error; }
    // onAuthStateChange listener will proceed
  } catch (e) {
    authError.textContent = e?.message || 'Sign in failed'; authError.hidden = false; toast('error','Sign in failed', authError.textContent);
  } finally {
    btnSignin.disabled = false; btnSignin.textContent = 'Sign In';
  }
});

btnLogout.addEventListener('click', async () => {
  await setPresence(false);
  await sb.auth.signOut();
  session = null; currentUser = null; meProfile = null; activePeerId = null;
  setLoggedInUI(false);
  show(calculatorScreen);
  toast('success','Signed out','You have been logged out.');
});

async function refreshSession() {
  if (!sb || !sb.auth) { session = null; currentUser = null; setLoggedInUI(false); return; }
  const { data: { session: s } } = await sb.auth.getSession();
  session = s;
  currentUser = s?.user || null;
  setLoggedInUI(!!currentUser);
}

async function getCurrentUserSafe() {
  if (!currentUser) await refreshSession();
  return currentUser;
}

async function ensureProfile(usernameFromSignup) {
  const meUser = await getCurrentUserSafe();
  if (!meUser) throw new Error('No session');
  const { data: me, error } = await sb.from('profiles').select('*').eq('id', meUser.id).single();
  if (error && error.code !== 'PGRST116') { // not found
    console.error('insert profile err', error);
    // try creating one optimistically
    const { data: ins, error: insErr } = await sb.from('profiles').insert({ id: meUser.id, email: meUser.email, username: usernameFromSignup || null }).select().single();
    if (!insErr) { meProfile = ins; return; }
    throw error;
  }
  if (!me) {
    const { data: ins, error: insErr } = await sb.from('profiles').insert({ id: meUser.id, email: meUser.email, username: usernameFromSignup || null }).select().single();
    if (insErr) throw insErr; meProfile = ins; return;
  }
  meProfile = me;
  meUsername.textContent = meProfile?.username || 'Me';
  setAvatar(meAvatar, meProfile?.username || 'Me', meProfile?.avatar_url);
}

async function ensurePasscode() {
  await ensureProfile();
  if (!meProfile) return;
  if (!meProfile.passcode_hash) {
    pass1.value = pass2.value = '';
    passErr.hidden = true;
    passcodeModal.showModal();
    toast('warning','Passcode required','Set a numeric passcode to unlock via calculator.');
  }
}

passcodeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = pass1.value.trim();
  const p2 = pass2.value.trim();
  if (!/^[0-9]{4,}$/.test(p1)) { passErr.textContent = 'Passcode must be at least 4 digits.'; passErr.hidden = false; return; }
  if (p1 !== p2) { passErr.textContent = 'Passcodes do not match.'; passErr.hidden = false; return; }
  const prev = btnSavePasscode ? btnSavePasscode.textContent : '';
  if (btnSavePasscode) { btnSavePasscode.disabled = true; btnSavePasscode.textContent = 'Saving...'; }
  try {
    const { error } = await sb.rpc('set_passcode', { passcode: p1 });
    if (error) { passErr.textContent = error.message; passErr.hidden = false; return; }
    const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
    meProfile = data;
    passcodeModal.close();
    show(calculatorScreen);
    toast('success','Passcode saved','Use the calculator and press = to unlock.');
  } finally {
    if (btnSavePasscode) { btnSavePasscode.disabled = false; btnSavePasscode.textContent = prev; }
  }
});

if (passcodeClose && passcodeModal) {
  passcodeClose.addEventListener('click', () => passcodeModal.close());
}

// Presence and navigation helpers
async function setPresence(online) {
  try {
    const meUser = await getCurrentUserSafe();
    if (!meUser) return;
    const payload = { is_online: !!online, last_active: new Date().toISOString() };
    await sb.from('profiles').update(payload).eq('id', meUser.id);
    // Reflect in UI immediately
    if (meStatus) meStatus.textContent = online ? 'Online' : 'Offline';
  } catch {}
}

async function loadUsers() {
  if (!userList) return;
  userList.innerHTML = '';
  try {
    // Prefer secure view via RPC
    const { data, error } = await sb.rpc('get_public_profiles');
    if (error) throw error;
    const meUser = await getCurrentUserSafe();
    (data || [])
      .filter(u => !meUser || u.id !== meUser.id)
      .forEach(u => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="avatar"></div>
          <div class="info">
            <div class="name"></div>
            <div class="status"></div>
          </div>
        `;
        setAvatar(li.querySelector('.avatar'), u.username || 'User', u.avatar_url);
        li.querySelector('.name').textContent = u.username || 'User';
        li.querySelector('.status').textContent = u.is_online ? 'Active now' : (u.last_active ? formatTimeAgo(u.last_active) : 'Offline');
        li.addEventListener('click', () => openConversation(u.id));
        userList.appendChild(li);
      });
  } catch (e) {
    console.warn('loadUsers failed', e);
  }
}

async function enterChat() {
  // Navigate to chat screen, set presence, and load user list
  show(chatScreen);
  await setPresence(true);
  await loadUsers();
}

async function openConversation(peerId) {
  const meUser = await getCurrentUserSafe();
  if (!meUser) { console.warn('openConversation: no session'); return; }
  activePeerId = peerId;
  // Load peer profile for header via RPC (security definer) to bypass RLS select restrictions
  try {
    const { data: allPeers, error: rpErr } = await sb.rpc('get_public_profiles');
    if (!rpErr && Array.isArray(allPeers)) {
      const peer = allPeers.find(p => p.id === activePeerId);
      if (peer) updatePeerHeader(peer);
    }
  } catch {}
  messagesEl.innerHTML = '';
  // Mobile: switch to conversation view
  chatScreen.classList.add('show-convo');
  // Fetch recent messages between me and peer
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${meUser.id},receiver_id.eq.${activePeerId}),and(sender_id.eq.${activePeerId},receiver_id.eq.${meUser.id})`)
    .order('created_at', { ascending: true })
    .limit(200);
  if (!error) data.forEach(renderMessage);
  // After rendering, mark any unseen/un-delivered messages for this open chat
  await bulkMarkDeliveredAndSeenForOpenConversation();
  updateDeliveryStatus();
  subscribeMessages();
}

function subscribeMessages() {
  if (!currentUser) { console.warn('subscribeMessages: no session'); return; }
  if (messageUnsub) { sb.removeChannel(messageUnsub); messageUnsub = null; }
  // Subscribe to new inserts where sender/receiver is in the pair
  const chan = sb.channel('dm-' + activePeerId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUser.id}` }, (p) => {
      if (p.new.sender_id === activePeerId) {
        renderMessage(p.new);
        // Mark delivered and seen if appropriate
        markDeliveredAndMaybeSeen(p.new);
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${currentUser.id}` }, (p) => {
      if (p.new.receiver_id === activePeerId) renderMessage(p.new);
    })
    // Listen to updates to support edit/delete for both sides
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUser.id}` }, (p) => {
      const m = p.new; if (m.sender_id === activePeerId) { messagesById.set(m.id, m); renderMessage(m, { replace: true }); refreshReplyPreviewsFor(m.id); if (replyTarget?.id === m.id) { replyTarget = m; updateReplyBar(); } }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${currentUser.id}` }, (p) => {
      const m = p.new; if (m.receiver_id === activePeerId) { messagesById.set(m.id, m); renderMessage(m, { replace: true }); refreshReplyPreviewsFor(m.id); if (replyTarget?.id === m.id) { replyTarget = m; updateReplyBar(); } }
    })
    .subscribe();
  messageUnsub = chan;
}

async function markDeliveredAndMaybeSeen(msg) {
  try {
    if (!currentUser || !msg) return;
    if (msg.receiver_id !== currentUser.id) return;
    // Mark delivered if not already
    if (!msg.delivered_at) {
      const { error: delErr } = await sb.from('messages').update({ delivered_at: new Date().toISOString() }).eq('id', msg.id);
      if (delErr) console.warn('deliver update failed', delErr);
    }
    // If this conversation is open with the sender, mark seen
    if (activePeerId === msg.sender_id && chatScreen.classList.contains('active')) {
      const { error: seenErr } = await sb.from('messages').update({ seen_at: new Date().toISOString() }).eq('id', msg.id);
      if (seenErr) console.warn('seen update failed', seenErr);
    }
  } catch (e) { console.warn('markDeliveredAndMaybeSeen error', e); }
}

async function bulkMarkDeliveredAndSeenForOpenConversation() {
  if (!currentUser || !activePeerId) return;
  try {
    const { error: delErr } = await sb.from('messages').update({ delivered_at: new Date().toISOString() })
      .eq('receiver_id', currentUser.id).eq('sender_id', activePeerId).is('delivered_at', null);
    if (delErr) console.warn('bulk deliver update failed', delErr);
  } catch {}
  try {
    const { error: seenErr } = await sb.from('messages').update({ seen_at: new Date().toISOString() })
      .eq('receiver_id', currentUser.id).eq('sender_id', activePeerId).is('seen_at', null);
    if (seenErr) console.warn('bulk seen update failed', seenErr);
  } catch {}
}

function updateDeliveryStatus() {
  if (!messagesEl) return;
  // Remove any existing indicator
  const old = messagesEl.querySelector('.delivery-status');
  if (old) old.remove();
  // Show only if the latest message in the thread is mine
  const last = Array.from(messagesEl.querySelectorAll('.message')).pop();
  if (!last || !last.classList.contains('mine')) return;
  const seenAt = last.dataset.seenAt;
  const deliveredAt = last.dataset.deliveredAt;
  const div = document.createElement('div');
  div.className = 'delivery-status' + (seenAt ? ' seen' : '');
  div.textContent = seenAt ? 'Seen' : (deliveredAt ? 'Delivered' : 'Sent');
  // Insert right after the message
  if (last.nextSibling) messagesEl.insertBefore(div, last.nextSibling); else messagesEl.appendChild(div);
}

function renderMessage(m, { replace = false } = {}) {
  const hidden = getHiddenSet();
  if (!m) return;
  // Track message by id for reply previews
  if (m.id) messagesById.set(m.id, m);
  const exists = !!messagesEl.querySelector(`[data-id="${m.id}"]`);
  const isMine = m.sender_id === currentUser?.id;
  const isDeleted = m.type === 'deleted' || m.content === '::deleted::';
  let div = exists ? messagesEl.querySelector(`[data-id="${m.id}"]`) : null;
  if (!div) {
    div = document.createElement('div');
    div.dataset.id = m.id;
    div.className = 'message' + (isMine ? ' mine' : '');
  } else {
    div.innerHTML = '';
  }
  // store delivery info for status rendering
  if (m.delivered_at) div.dataset.deliveredAt = m.delivered_at; else delete div.dataset.deliveredAt;
  if (m.seen_at) div.dataset.seenAt = m.seen_at; else delete div.dataset.seenAt;
  // Content area
  const contentWrap = document.createElement('div');
  contentWrap.className = 'message-content';
  // If this message is a reply to another, render a small quoted block above
  if (m.reply_to_id) {
    const rb = document.createElement('div');
    rb.className = 'reply-block';
    rb.dataset.replyId = m.reply_to_id;
    const rs = document.createElement('div'); rs.className = 'reply-snippet';
    const rthumb = document.createElement('img'); rthumb.className = 'reply-thumb';
    const rtext = document.createElement('span');
    const base = messagesById.get(m.reply_to_id);
    if (base) {
      rtext.textContent = messageSnippet(base);
      if ((base.type === 'image' || base.type === 'gif' || base.type === 'sticker') && base.content) {
        rthumb.src = base.content; rs.appendChild(rthumb);
      }
    } else {
      rtext.textContent = '…';
      // Lazy fetch minimal data for preview
      sb.from('messages').select('id,sender_id,type,content').eq('id', m.reply_to_id).single().then(({ data }) => {
        if (data) {
          messagesById.set(data.id, data);
          rtext.textContent = messageSnippet(data);
          if ((data.type === 'image' || data.type === 'gif' || data.type === 'sticker') && data.content) { rthumb.src = data.content; if (!rthumb.isConnected) rs.prepend(rthumb); }
        }
      }).catch(()=>{});
    }
    rs.appendChild(rtext);
    rb.appendChild(rs);
    rb.addEventListener('click', () => scrollToMessage(m.reply_to_id));
    contentWrap.appendChild(rb);
  }
  if (isDeleted) {
    const del = document.createElement('div');
    del.className = 'deleted';
    del.textContent = 'This message was deleted';
    contentWrap.appendChild(del);
  } else if (m.type === 'tiktok' && isTikTokUrl(m.content)) {
    contentWrap.appendChild(renderTikTokEmbed(m.content));
  } else if ((m.type === 'image' || m.type === 'gif' || m.type === 'sticker') && m.content) {
    // Render image inside normal bubble
    contentWrap.appendChild(renderImage(m.content));
  } else {
    const p = document.createElement('div');
    p.className = 'text';
    p.textContent = m.content;
    contentWrap.appendChild(p);
  }
  div.appendChild(contentWrap);
  // Meta
  const meta = document.createElement('div');
  meta.className = 'meta';
  const ts = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const edited = m.updated_at && m.updated_at !== m.created_at; // show if column exists
  meta.textContent = ts + (edited ? ' (edited)' : '');
  // Force color to white to ensure visibility regardless of theme overrides
  try { meta.style.color = '#ffffff'; } catch {}
  div.appendChild(meta);
  // Interactions: right-click / long-press / swipe-to-reply (also for deleted messages)
  attachMessageInteractions(div, m);

  if (!exists) {
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
  // Update the status indicator under latest outgoing message
  updateDeliveryStatus();
}

// Smoothly scroll to a specific message by id and highlight it briefly
function scrollToMessage(id) {
  try {
    const target = messagesEl?.querySelector(`[data-id="${id}"]`);
    if (!target) return;
    // Scroll into center of the messages container
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    // Flash highlight
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1200);
  } catch {}
}

// Reply helpers
function messageSnippet(m) {
  if (!m) return '';
  if (m.type === 'image') return 'Image';
  if (m.type === 'gif') return 'GIF';
  if (m.type === 'sticker') return 'Sticker';
  if (m.type === 'tiktok') return 'TikTok';
  return (m.content || '').slice(0, 80);
}
function updateReplyBar() {
  if (!replyBar) return;
  if (replyTarget) {
    replyBar.hidden = false;
    try {
      const isMine = replyTarget.sender_id === currentUser?.id;
      if (replyTitle) { replyTitle.hidden = false; replyTitle.textContent = 'Replying:'; }
      if (replySnippet) replySnippet.textContent = messageSnippet(replyTarget);
      if (replyThumb) {
        if ((replyTarget.type === 'image' || replyTarget.type === 'gif' || replyTarget.type === 'sticker') && replyTarget.content) {
          replyThumb.src = replyTarget.content; replyThumb.hidden = false;
        } else { replyThumb.hidden = true; }
      }
      // Make the bar preview clickable to jump to original
      if (replySnippet) {
        replySnippet.style.cursor = 'pointer';
        replySnippet.onclick = () => { if (replyTarget?.id) scrollToMessage(replyTarget.id); };
      }
      if (replyThumb) {
        replyThumb.style.cursor = 'pointer';
        replyThumb.onclick = () => { if (replyTarget?.id) scrollToMessage(replyTarget.id); };
      }
    } catch {}
  } else {
    replyBar.hidden = true;
  }
}
if (replyCancel) replyCancel.addEventListener('click', () => { replyTarget = null; updateReplyBar(); });

function attachMessageInteractions(el, m) {
  // Replace any prior handlers to avoid stacking stale closures
  el.oncontextmenu = null;
  el.ontouchstart = null;
  el.ontouchend = null;
  el.ontouchmove = null;
  // Avoid re-binding swipe listeners on rerenders
  if (el.dataset.boundSwipe === '1') {
    // Context menu still needs rebinding because element content resets
  } else {
    el.dataset.boundSwipe = '1';
  }
  // Right click
  el.oncontextmenu = (e) => { e.preventDefault(); showMsgMenu(e.clientX, e.clientY, m, el); };
  // Long press (touch)
  let touchTimer;
  el.ontouchstart = (e) => {
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { showMsgMenu(e.touches[0].clientX, e.touches[0].clientY, m, el); }, 500);
  };
  el.ontouchmove = () => clearTimeout(touchTimer);
  el.ontouchend = () => clearTimeout(touchTimer);
  // Swipe to reply
  if (!el._swipeBound) {
    el._swipeBound = true;
    let sx = 0, sy = 0, horiz = false;
    const TH = 25; // threshold px
    const MAX = 90; // max visual drag in px
    const resetTransform = () => { el.style.transition = 'transform 120ms ease'; el.style.transform = 'translateX(0px)'; setTimeout(() => { el.style.transition = ''; }, 140); };
    el.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; horiz = false; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      const dx = t.clientX - sx; const dy = t.clientY - sy;
      if (!horiz && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        horiz = true;
      }
      if (horiz) {
        // prevent vertical scroll when doing horizontal swipe
        e.preventDefault();
        const isMine = m.sender_id === currentUser?.id;
        // lock direction: mine -> left only, others -> right only
        const dirDx = isMine ? Math.min(0, dx) : Math.max(0, dx);
        const clamped = Math.max(-MAX, Math.min(MAX, dirDx));
        el.style.transform = `translateX(${clamped}px)`;
        el.classList.add('swiping');
      }
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - sx; const dy = t.clientY - sy;
      if (!horiz) { el.style.transform = ''; el.classList.remove('swiping'); return; }
      el.classList.remove('swiping');
      if (Math.abs(dx) < TH || Math.abs(dx) < Math.abs(dy)) { resetTransform(); return; }
      const isMine = m.sender_id === currentUser?.id;
      if (!isMine && dx > TH) {
        console.debug('[Reply] swipe right');
        el.style.transition = 'transform 120ms ease'; el.style.transform = `translateX(${Math.min(MAX, Math.max(TH, dx))}px)`;
        setTimeout(() => { selectReply(m); resetTransform(); }, 120);
      } else if (isMine && dx < -TH) {
        console.debug('[Reply] swipe left');
        el.style.transition = 'transform 120ms ease'; el.style.transform = `translateX(${Math.max(-MAX, Math.min(-TH, dx))}px)`;
        setTimeout(() => { selectReply(m); resetTransform(); }, 120);
      } else {
        resetTransform();
      }
    });
    // Mouse drag (desktop) to emulate swipe
    let mx = 0, my = 0, down = false, mh = false;
    el.addEventListener('mousedown', (e) => { if (e.button !== 0) return; down = true; mx = e.clientX; my = e.clientY; mh = false; });
    document.addEventListener('mousemove', (e) => {
      if (!down) return;
      const dx = e.clientX - mx; const dy = e.clientY - my;
      if (!mh && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) mh = true;
      if (!mh) return;
      const isMine = m.sender_id === currentUser?.id;
      const dirDx = isMine ? Math.min(0, dx) : Math.max(0, dx);
      const clamped = Math.max(-MAX, Math.min(MAX, dirDx));
      el.style.transform = `translateX(${clamped}px)`;
      el.classList.add('swiping');
    });
    document.addEventListener('mouseup', (e) => {
      if (!down) return; down = false;
      el.classList.remove('swiping');
      const dx = e.clientX - mx; const dy = e.clientY - my;
      if (!mh) { el.style.transform = ''; return; }
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) { resetTransform(); return; }
      const isMine = m.sender_id === currentUser?.id;
      if (!isMine && dx > 40) { el.style.transition = 'transform 120ms ease'; el.style.transform = `translateX(${Math.min(MAX, Math.max(40, dx))}px)`; setTimeout(() => { selectReply(m); resetTransform(); }, 120); return; }
      if (isMine && dx < -40) { el.style.transition = 'transform 120ms ease'; el.style.transform = `translateX(${Math.max(-MAX, Math.min(-40, dx))}px)`; setTimeout(() => { selectReply(m); resetTransform(); }, 120); return; }
      resetTransform();
    });
  }
}

function selectReply(m) {
  replyTarget = m; updateReplyBar();
  try { console.debug('[Reply] Target set to id', m.id); } catch {}
  try { msgInput?.focus(); } catch {}
}

function showMsgMenu(x, y, m, el) {
  hideMsgMenu();
  const menu = document.createElement('div');
  menu.id = 'msg-menu';
  menu.className = 'msg-menu';
  const addItem = (label, onClick) => {
    const it = document.createElement('button'); it.textContent = label; it.className = 'menu-item';
    it.addEventListener('click', () => { onClick(); hideMsgMenu(); });
    menu.appendChild(it);
  };
  // Only for own non-deleted messages
  if (m.type !== 'deleted' && m.sender_id === currentUser?.id) addItem('Edit', () => startInlineEdit(el, m));
  addItem('Delete for me', () => deleteForMe(m, el));
  if (m.sender_id === currentUser?.id) addItem('Delete for everyone', () => deleteForEveryone(m, el));
  addItem('Reply', () => selectReply(m));
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  setTimeout(() => {
    const closePointer = (e) => { if (!menu.contains(e.target)) hideMsgMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); hideMsgMenu(); } };
    window.addEventListener('mousedown', closePointer, { once: true });
    window.addEventListener('click', closePointer, { once: true });
    window.addEventListener('touchstart', closePointer, { once: true, passive: true });
    window.addEventListener('keydown', onKey, { once: true });
    window.addEventListener('scroll', hideMsgMenu, { once: true });
    window.addEventListener('resize', hideMsgMenu, { once: true });
  }, 0);
}
function hideMsgMenu() { const m = document.getElementById('msg-menu'); if (m) m.remove(); }

function startInlineEdit(el, m) {
  if (!canEditMessage(m)) { toast('error', 'Editing disabled', 'You can only edit within 5 minutes.'); return; }
  const content = el.querySelector('.text');
  if (!content) return;
  const orig = content.textContent;
  const area = document.createElement('textarea');
  area.className = 'edit-area';
  area.value = orig;
  content.replaceWith(area);
  area.focus();
  autoSize(area);
  const cleanup = () => {
    document.removeEventListener('mousedown', onOutsideClick, true);
    area.removeEventListener('keydown', onKey);
  };
  const revert = () => {
    area.replaceWith(createTextDiv(orig));
    cleanup();
  };
  const commit = async () => {
    const newText = area.value.trim();
    if (!newText || newText === orig) { revert(); return; }
    const { data: rows, error } = await sb.from('messages')
      .update({ content: newText })
      .eq('id', m.id)
      .eq('sender_id', currentUser.id)
      .select('*')
      .limit(1);
    if (error) { toast('error', 'Edit failed', (error.code || '') + ' ' + (error.message || '')); return; }
    if (!rows || rows.length === 0) { console.warn('Edit affected 0 rows; likely RLS or constraint. msgId=', m.id); toast('error', 'Edit failed', 'No rows updated (permissions?)'); return; }
    const updated = Array.isArray(rows) ? rows[0] : rows;
    if (updated) {
      m = updated; // replace local ref
      messagesById.set(updated.id, updated);
      renderMessage(updated, { replace: true });
      refreshReplyPreviewsFor(updated.id);
      if (replyTarget?.id === updated.id) { replyTarget = updated; updateReplyBar(); }
    } else {
      // Fallback optimistic UI
      m.content = newText;
      try { m.updated_at = new Date().toISOString(); } catch {}
      area.replaceWith(createTextDiv(newText));
      const meta = el.querySelector('.meta'); if (meta && !/edited\)/.test(meta.textContent)) meta.textContent += ' (edited)';
      messagesById.set(m.id, m);
      refreshReplyPreviewsFor(m.id);
      if (replyTarget?.id === m.id) { updateReplyBar(); }
    }
    cleanup();
  };
  const onOutsideClick = (e) => {
    const menu = document.getElementById('msg-menu');
    if (el.contains(e.target) || (menu && menu.contains(e.target))) return; // clicks inside message or menu ignored
    // Clicked outside → auto-save if changed, else revert
    e.stopPropagation();
    commit();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); revert(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
  };
  // Auto-save on click outside
  document.addEventListener('mousedown', onOutsideClick, true);
  area.addEventListener('keydown', onKey);
}
function createTextDiv(text) { const p = document.createElement('div'); p.className = 'text'; p.textContent = text; return p; }
function autoSize(el) {
  const apply = () => {
    el.style.height = 'auto';
    const sh = el.scrollHeight;
    const cs = window.getComputedStyle(el);
    const maxH = cs.maxHeight && cs.maxHeight !== 'none' ? parseFloat(cs.maxHeight) : Infinity;
    const target = Math.min(sh, maxH);
    el.style.height = target + 'px';
    // If capped, allow scrolling; otherwise hide
    if (sh > target) {
      el.style.overflow = 'auto';
    } else {
      el.style.overflow = 'hidden';
    }
  };
  apply();
  el.addEventListener('input', apply);
}

function deleteForMe(m, el) {
  const set = getHiddenSet(); set.add(m.id); setHiddenSet(set);
  el.style.transition = 'opacity .2s ease'; el.style.opacity = '0'; setTimeout(() => el.remove(), 200);
}
async function deleteForEveryone(m, el) {
  try {
    const { data: rows, error } = await sb.from('messages')
      .update({ type: 'deleted', content: '' })
      .eq('id', m.id)
      .eq('sender_id', currentUser.id)
      .select('*')
      .limit(1);
    if (error) { toast('error', 'Delete failed', (error.code || '') + ' ' + (error.message || '')); return; }
    if (!rows || rows.length === 0) { console.warn('Delete affected 0 rows; likely RLS or constraint. msgId=', m.id); toast('error', 'Delete failed', 'No rows updated (permissions?)'); return; }
    const updated = Array.isArray(rows) ? rows[0] : rows;
    if (updated) {
      renderMessage(updated, { replace: true });
    } else {
      // Fallback optimistic UI
      el.style.transition = 'opacity .15s ease'; el.style.opacity = '0';
      setTimeout(() => {
        el.style.opacity = '';
        const content = el.querySelector('.message-content'); if (content) content.innerHTML = '<div class="deleted">This message was deleted</div>';
      }, 160);
    }
  } catch (e) {
    toast('error', 'Delete failed', String(e?.message || e));
  }
}

msgForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activePeerId) return;
  const text = msgInput.value.trim();
  if (!text) return;
  const isTik = isTikTokUrl(text);
  const { data: rows, error } = await sb.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: activePeerId,
    type: isTik ? 'tiktok' : 'text',
    content: text,
    reply_to_id: replyTarget ? replyTarget.id : null
  }).select('*');
  if (error) {
    toast('error', 'Send failed', error.message);
    return;
  }
  if (rows && rows.length) rows.forEach(r => renderMessage(r));
  // clear reply state after send
  replyTarget = null; updateReplyBar();
  msgInput.value = '';
});

// Image sending
const IMAGE_BUCKET = 'chat-images'; // Ensure this bucket exists and is public
if (btnAttach && imageInput) {
  btnAttach.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async () => {
    try {
      if (!activePeerId) { toast('error','No chat selected','Choose a user first.'); imageInput.value=''; return; }
      const file = imageInput.files && imageInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast('error','Unsupported file','Please choose an image.'); imageInput.value=''; return; }
      if (file.size > 5 * 1024 * 1024) { toast('error','Too large','Max 5 MB'); imageInput.value=''; return; }
      // Create a temporary uploading bubble
      const tempId = 'temp-' + Date.now();
      const tempMsg = {
        id: tempId,
        sender_id: currentUser.id,
        receiver_id: activePeerId,
        type: 'image',
        content: '',
        created_at: new Date().toISOString()
      };
      // Render with a tiny preview using local object URL
      const urlPreview = URL.createObjectURL(file);
      const tempEl = document.createElement('div');
      tempEl.className = 'message mine uploading';
      tempEl.dataset.id = tempId;
      const cw = document.createElement('div'); cw.className = 'message-content';
      cw.appendChild(renderImage(urlPreview));
      const meta = document.createElement('div'); meta.className = 'meta';
      const sp = document.createElement('span'); sp.className = 'spinner';
      meta.appendChild(sp); meta.append(' Uploading...');
      tempEl.appendChild(cw); tempEl.appendChild(meta);
      messagesEl.appendChild(tempEl); messagesEl.scrollTop = messagesEl.scrollHeight;

      const path = `${currentUser.id}/${Date.now()}-${file.name}`.replace(/[^a-zA-Z0-9-_./]/g, '_');
      const { error: upErr } = await sb.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        toast('error','Upload failed', upErr.message);
        try { tempEl.remove(); } catch {}
        imageInput.value=''; return;
      }
      const { data: pub } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) {
        toast('error','URL error','Could not get public URL');
        try { tempEl.remove(); } catch {}
        imageInput.value=''; return;
      }
      const { data: rows, error: insErr } = await sb.from('messages').insert({
        sender_id: currentUser.id,
        receiver_id: activePeerId,
        type: 'image',
        content: url,
        reply_to_id: replyTarget ? replyTarget.id : null
      }).select('*');
      if (insErr) {
        toast('error','Send failed', (insErr.code||'')+' '+insErr.message);
        try { tempEl.remove(); } catch {}
        return;
      }
      if (rows && rows.length) {
        try { tempEl.remove(); } catch {}
        rows.forEach(r => renderMessage(r));
        replyTarget = null; updateReplyBar();
      }
    } catch (e) {
      toast('error','Send failed', String(e?.message || e));
    } finally {
      imageInput.value = '';
    }
  });
}

// Initial load
// Auth state listener to handle email confirmation and sign-ins
if (sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
  sb.auth.onAuthStateChange(async (event, s) => {
    if (event === 'SIGNED_IN') {
      await refreshSession();
      await ensureProfile();
      setLoggedInUI(true);
      if (authModal?.close) authModal.close();
      toast('success','Signed in', 'Welcome back!');
      // Apply pending passcode from signup if present
      try {
        const pending = sessionStorage.getItem('pending_passcode');
        if (pending && /^[0-9]{4,}$/.test(pending)) {
          await sb.rpc('set_passcode', { passcode: pending });
          sessionStorage.removeItem('pending_passcode');
          const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
          meProfile = data;
        }
      } catch {}
      await ensurePasscode();
      show(calculatorScreen);
    }
    if (event === 'SIGNED_OUT') {
      session = null; currentUser = null; meProfile = null;
      setLoggedInUI(false);
      show(calculatorScreen);
    }
  });
}

(async function init() {
  // Enforce dark mode by default
  applyTheme('dark');
  try { await refreshSession(); } catch { /* ignore */ }
  setLoggedInUI(!!currentUser);
  // If already signed in (page reload), load profile so username/avatar render
  if (currentUser) {
    await ensureProfile();
  }
  show(calculatorScreen);
})();

// Ensure listeners are bound even if DOM was not fully ready
document.addEventListener('DOMContentLoaded', () => {
  try { console.debug('[CalcChat] DOM ready'); } catch {}
  // Auth modal open
  const btn = document.getElementById('btn-open-auth');
  const dlg = document.getElementById('auth-modal');
  if (btn && dlg && typeof dlg.showModal === 'function') {
    if (!btn.__cc_bound) { btn.addEventListener('click', () => dlg.showModal()); btn.__cc_bound = true; }
  }
  // Chat textarea auto-grow
  const ta = document.getElementById('message-input');
  if (ta) {
    try { autoSize(ta); } catch {}
  }
  // GIF picker wiring
  try {
    if (btnGif && gifModal && typeof gifModal.showModal === 'function') {
      btnGif.addEventListener('click', () => {
        if (!activePeerId) { toast('error','No chat selected','Choose a user first.'); return; }
        if (!window.TENOR_API_KEY) { toast('error','GIFs unavailable','Missing TENOR_API_KEY in config.js'); return; }
        openGifPicker('gifs');
      });
    }
    if (gifClose && gifModal) gifClose.addEventListener('click', () => gifModal.close());
    if (gifTabs) {
      gifTabs.addEventListener('click', (e) => {
        const t = e.target.closest('.tab'); if (!t) return;
        gifTabs.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        const kind = t.dataset.kind === 'stickers' ? 'stickers' : 'gifs';
        openGifPicker(kind);
      });
    }
    if (gifSearch) {
      gifSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); reloadGifResults(); }
      });
    }
    if (gifGrid) {
      gifGrid.addEventListener('scroll', () => {
        if (gifLoading || !gifNextPos) return;
        const nearBottom = gifGrid.scrollTop + gifGrid.clientHeight >= gifGrid.scrollHeight - 200;
        if (nearBottom) loadMoreGifs();
      });
    }
  } catch {}
});

// Mobile back button: return to user list
if (btnBack) {
  btnBack.addEventListener('click', () => {
    chatScreen.classList.remove('show-convo');
    activePeerId = null;
  });
}

// Auth modal open/close
if (btnOpenAuth && authModal) {
  btnOpenAuth.addEventListener('click', () => authModal.showModal());
}
if (authClose && authModal) {
  authClose.addEventListener('click', () => authModal.close());
}
// Close buttons inside auth panels
document.querySelectorAll('[data-close-auth]').forEach(btn => {
  btn.addEventListener('click', () => authModal && authModal.close());
});
// Delegated close (robust if content changes)
if (authForms) {
  authForms.addEventListener('click', (e) => {
    const t = e.target.closest('[data-close-auth]');
    if (t && authModal) {
      e.preventDefault();
      authModal.close();
    }
  });
}

// Profile Editing
if (btnEditProfile) {
  btnEditProfile.addEventListener('click', () => {
    if (!currentUser) return toast('error','Not signed in','Sign in first.');
    profileError.hidden = true;
    profileUsername.value = meProfile?.username || '';
    setAvatar(profilePreview, meProfile?.username || 'Me', meProfile?.avatar_url);
    profileAvatarInput.value = '';
    removeAvatarRequested = false;
    profileModal.showModal();
  });
}

if (profileAvatarInput) {
  profileAvatarInput.addEventListener('change', () => {
    const f = profileAvatarInput.files?.[0];
    if (!f) return;
    // validate
    profileError.hidden = true;
    if (!f.type.startsWith('image/')) {
      profileError.textContent = 'Please select an image file.';
      profileError.hidden = false; profileAvatarInput.value = ''; return;
    }
    if (f.size > 3 * 1024 * 1024) { // 3MB
      profileError.textContent = 'Image is too large. Max 3 MB.';
      profileError.hidden = false; profileAvatarInput.value = ''; return;
    }
    const url = URL.createObjectURL(f);
    profilePreview.textContent = '';
    profilePreview.style.backgroundImage = `url(${url})`;
    profilePreview.style.backgroundSize = 'cover';
    profilePreview.style.backgroundPosition = 'center';
    removeAvatarRequested = false; // user selected a new one
  });
}

// Remove avatar: clear file input and show initials preview; will null it on save
if (btnRemoveAvatar) {
  btnRemoveAvatar.addEventListener('click', () => {
    profileAvatarInput.value = '';
    setAvatar(profilePreview, profileUsername.value?.trim() || (meProfile?.username || 'Me'), null);
    removeAvatarRequested = true;
  });
}

// Upload button triggers hidden input
if (btnUploadAvatar && profileAvatarInput) {
  btnUploadAvatar.addEventListener('click', () => profileAvatarInput.click());
}

// Drag & drop support on dropzone
if (profileDropzone && profileAvatarInput) {
  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover'].forEach(ev => profileDropzone.addEventListener(ev, (e)=>{ prevent(e); profileDropzone.classList.add('dragover'); }));
  ;['dragleave','drop'].forEach(ev => profileDropzone.addEventListener(ev, (e)=>{ prevent(e); profileDropzone.classList.remove('dragover'); }));
  profileDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    // Programmatically set the input's files
    const dt = new DataTransfer();
    dt.items.add(file);
    profileAvatarInput.files = dt.files;
    // Trigger change handler for validation + preview
    profileAvatarInput.dispatchEvent(new Event('change'));
  });
  // Click to open file picker
  profileDropzone.addEventListener('click', () => profileAvatarInput.click());
  profileDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); profileAvatarInput.click(); }
  });
}

if (btnProfileClose && profileModal) {
  btnProfileClose.addEventListener('click', () => profileModal.close());
}

if (profileForm) {
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    profileError.hidden = true;
    const newUsername = profileUsername.value.trim();
    if (newUsername.length < 2 || newUsername.length > 24) {
      profileError.textContent = 'Username must be 2-24 characters.';
      profileError.hidden = false;
      return;
    }
    const prevSaveText = btnSaveProfile ? btnSaveProfile.textContent : '';
    if (btnSaveProfile) { btnSaveProfile.disabled = true; btnSaveProfile.textContent = 'Saving...'; }
    let newAvatarUrl = meProfile?.avatar_url || null;
    try {
      const file = profileAvatarInput.files?.[0];
      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${currentUser.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from('avatars').upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { data } = sb.storage.from('avatars').getPublicUrl(path);
        newAvatarUrl = data.publicUrl;
      } else if (removeAvatarRequested) {
        newAvatarUrl = null; // clear avatar
      }
      const payload = { username: newUsername };
      // include avatar_url explicitly even if null to clear it
      payload.avatar_url = newAvatarUrl;
      const { error: updErr } = await sb.from('profiles').update(payload).eq('id', currentUser.id);
      if (updErr) throw updErr;
      // Refresh meProfile and UI
      const { data: me } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
      meProfile = me;
      meUsername.textContent = meProfile.username;
      setAvatar(meAvatar, meProfile.username, meProfile.avatar_url);
      profileModal.close();
      toast('success','Profile updated','Your profile was saved.');
      // Reload user list so others see avatar
      await loadUsers();
    } catch (err) {
      console.error(err);
      profileError.textContent = err.message || 'Failed to save profile';
      profileError.hidden = false;
    } finally {
      if (btnSaveProfile) { btnSaveProfile.disabled = false; btnSaveProfile.textContent = prevSaveText; }
    }
  });
}
