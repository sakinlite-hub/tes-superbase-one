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
  try { if (peerAvatar && user.id) { peerAvatar.dataset.userId = user.id; decorateAvatarWithStory(peerAvatar, user.id); } } catch {}
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

// Stories UI elements
const storiesBar = document.getElementById('stories-bar');
const btnAddStory = document.getElementById('btn-add-story');
const btnAddStoryMobile = document.getElementById('btn-add-story-mobile');
// Story viewer elements
const storyViewer = document.getElementById('story-viewer');
const svAvatar = document.getElementById('sv-avatar');
const svUsername = document.getElementById('sv-username');
const svTimestamp = document.getElementById('sv-timestamp');
const svImg = document.getElementById('sv-media-img');
const svVideo = document.getElementById('sv-media-video');
const svCaption = document.getElementById('sv-caption');
const svPrev = document.getElementById('sv-prev');
const svNext = document.getElementById('sv-next');
const svCloseBtn = document.getElementById('sv-close');
const svReplyInput = document.getElementById('sv-reply-input');
const svReplySend = document.getElementById('sv-reply-send');
// Add Story modal elements
const addStoryModal = document.getElementById('add-story-modal');
const addStoryForm = document.getElementById('add-story-form');
const addStoryFile = document.getElementById('story-file');
const addStoryCaption = document.getElementById('story-caption');
const addStoryCancel = document.getElementById('add-story-cancel');
const addStorySubmitBtn = document.getElementById('add-story-submit');
// Modernized Add Story UI elements
const storyDropzone = document.getElementById('story-dropzone');
const storyPreviewWrap = document.getElementById('story-preview');
const storyPreviewImg = document.getElementById('story-preview-img');
const storyPreviewVideo = document.getElementById('story-preview-video');
const btnPickStory = document.getElementById('btn-pick-story');
const storyFileMeta = document.getElementById('story-file-meta');
const storyFiletype = document.getElementById('story-filetype');
const storyFilename = document.getElementById('story-filename');
const storyFilesize = document.getElementById('story-filesize');
const storyClearBtn = document.getElementById('story-clear');
const storyProgress = document.getElementById('story-progress');

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

// Open Add Story modal (desktop header and mobile profile)
function openAddStoryModal() {
  if (!addStoryModal || !addStoryForm) return;
  if (!currentUser) { toast('error','Not signed in','Please sign in to post a story.'); return; }
  try { addStoryForm.reset(); } catch {}
  // reset modern UI state
  try {
    if (storyPreviewWrap) storyPreviewWrap.hidden = true;
    if (storyPreviewImg) { storyPreviewImg.src = ''; storyPreviewImg.hidden = true; }
    if (storyPreviewVideo) { storyPreviewVideo.src = ''; storyPreviewVideo.hidden = true; }
    if (storyFileMeta) storyFileMeta.hidden = true;
    if (storyProgress) storyProgress.hidden = true;
  } catch {}
  if (typeof addStoryModal.showModal === 'function') addStoryModal.showModal();
}
if (btnAddStory) btnAddStory.addEventListener('click', openAddStoryModal);
if (btnAddStoryMobile) btnAddStoryMobile.addEventListener('click', openAddStoryModal);

// ========= Modern Add Story wiring =========
// Helpers
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const sizes = ['B','KB','MB','GB'];
  if (bytes === 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function updateStoryUIForFile(file) {
  if (!file) {
    if (storyPreviewWrap) storyPreviewWrap.hidden = true;
    if (storyPreviewImg) { storyPreviewImg.hidden = true; storyPreviewImg.src = ''; }
    if (storyPreviewVideo) { storyPreviewVideo.hidden = true; storyPreviewVideo.src = ''; }
    if (storyFileMeta) storyFileMeta.hidden = true;
    return;
  }
  // file meta chips
  if (storyFileMeta) storyFileMeta.hidden = false;
  if (storyFiletype) storyFiletype.textContent = file.type || 'unknown';
  if (storyFilename) storyFilename.textContent = file.name || 'untitled';
  if (storyFilesize) storyFilesize.textContent = formatBytes(file.size || 0);
  // preview
  const isVideo = /^video\//.test(file.type);
  const url = URL.createObjectURL(file);
  if (storyPreviewWrap) storyPreviewWrap.hidden = false;
  if (isVideo) {
    if (storyPreviewImg) { storyPreviewImg.hidden = true; storyPreviewImg.src = ''; }
    if (storyPreviewVideo) {
      storyPreviewVideo.hidden = false;
      storyPreviewVideo.src = url;
      try { storyPreviewVideo.play().catch(()=>{}); } catch {}
    }
  } else {
    if (storyPreviewVideo) { storyPreviewVideo.hidden = true; storyPreviewVideo.src = ''; }
    if (storyPreviewImg) {
      storyPreviewImg.hidden = false;
      storyPreviewImg.src = url;
    }
  }
}

function setStoryFileFromDrop(file) {
  if (!addStoryFile) return;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    addStoryFile.files = dt.files;
  } catch {}
  updateStoryUIForFile(file);
}

// Event wiring
if (addStoryForm) addStoryForm.addEventListener('submit', handleAddStorySubmit);
if (addStoryCancel) addStoryCancel.addEventListener('click', () => { try { addStoryModal?.close(); } catch {} });
if (btnPickStory) btnPickStory.addEventListener('click', () => addStoryFile?.click());
if (storyClearBtn) storyClearBtn.addEventListener('click', () => { if (addStoryFile) addStoryFile.value = ''; updateStoryUIForFile(null); });
if (addStoryFile) addStoryFile.addEventListener('change', () => updateStoryUIForFile(addStoryFile.files?.[0]));
if (storyDropzone) {
  const enter = (e) => { e.preventDefault(); e.stopPropagation(); storyDropzone.classList.add('drag'); };
  const over = (e) => { e.preventDefault(); e.stopPropagation(); };
  const leave = (e) => { e.preventDefault(); e.stopPropagation(); storyDropzone.classList.remove('drag'); };
  const drop = (e) => {
    e.preventDefault(); e.stopPropagation(); storyDropzone.classList.remove('drag');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type) && !/^video\//.test(file.type)) { toast('error','Unsupported file','Choose an image or a video.'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('error','Too large','Max 20 MB'); return; }
    setStoryFileFromDrop(file);
  };
  storyDropzone.addEventListener('dragenter', enter);
  storyDropzone.addEventListener('dragover', over);
  storyDropzone.addEventListener('dragleave', leave);
  storyDropzone.addEventListener('drop', drop);
  storyDropzone.addEventListener('click', () => addStoryFile?.click());
}

// Open story viewer when clicking any avatar that has a story
document.addEventListener('click', (e) => {
  const el = e.target && e.target.closest ? e.target.closest('.avatar.has-story') : null;
  if (!el) return;
  const uid = el.dataset && el.dataset.userId;
  if (!uid) return;
  // Avoid if inside a button with explicit actions (e.g., upload avatar)
  const inButton = e.target.closest('button');
  if (inButton && !inButton.classList.contains('avatar')) return;
  openStoryViewer(uid);
});
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

// =============================
// Stories: data, loading, viewer, add, reply
// =============================
const STORIES_BUCKET = 'stories';
let storiesByUser = new Map(); // userId -> { user: {id,username,avatar_url}, stories: [rows], allViewed: bool }
let storyOrder = []; // ordered list of userIds for bar
let currentView = { userId: null, index: 0 };
let storiesChan = null;

async function loadStories() {
  try {
    if (!storiesBar) return;
    storiesBar.innerHTML = '';
    const meUser = await getCurrentUserSafe(); if (!meUser) return;
    // Fetch non-expired stories
    const { data: stories, error } = await sb.from('stories')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { console.warn('loadStories err', error); return; }
    const ids = (stories || []).map(s => s.id);
    // Fetch my view rows
    let viewedSet = new Set();
    if (ids.length) {
      try {
        const { data: myViews } = await sb.from('story_views')
          .select('story_id')
          .eq('viewer_id', meUser.id)
          .in('story_id', ids);
        (myViews || []).forEach(v => viewedSet.add(v.story_id));
      } catch {}
    }
    // Fetch public profiles for mapping
    const { data: profs } = await sb.rpc('get_public_profiles');
    const profMap = new Map((profs || []).map(p => [p.id, p]));
    // Group by user
    storiesByUser = new Map();
    for (const s of stories || []) {
      let entry = storiesByUser.get(s.user_id);
      if (!entry) {
        entry = { user: profMap.get(s.user_id) || { id: s.user_id, username: 'User', avatar_url: null }, stories: [], allViewed: true };
        storiesByUser.set(s.user_id, entry);
      }
      entry.stories.push(s);
      if (!viewedSet.has(s.id)) entry.allViewed = false;
    }
    // Order: me first (if has stories), then others by most recent story
    const sorted = Array.from(storiesByUser.entries()).sort((a,b) => {
      const at = new Date(a[1].stories[0]?.created_at || 0).getTime();
      const bt = new Date(b[1].stories[0]?.created_at || 0).getTime();
      return bt - at;
    });
    storyOrder = sorted.map(([uid]) => uid);
    // Update avatars with story rings
    decorateAllAvatars();
    // The old stories bar can be hidden via CSS; keep render available if needed
    renderStoriesBar();
  } catch (e) { console.warn('loadStories exception', e); }
}

// Ensure legacy storage URLs include "/public/" segment
function normalizeStoryUrl(url) {
  try {
    if (!url || typeof url !== 'string') return url;
    return url.replace('/storage/v1/object/stories/', '/storage/v1/object/public/stories/');
  } catch { return url; }
}

// Decorate avatar with story ring if user has active stories
function decorateAvatarWithStory(avatarEl, userId) {
  if (!avatarEl || !userId) return;
  const entry = storiesByUser.get(userId);
  const has = !!entry && (entry.stories?.length > 0);
  avatarEl.classList.toggle('has-story', has);
  avatarEl.classList.toggle('story-viewed', has && !!entry?.allViewed);
}

function decorateAllAvatars() {
  try {
    document.querySelectorAll('.avatar[data-user-id]').forEach((el) => {
      const uid = el.dataset.userId;
      if (uid) decorateAvatarWithStory(el, uid);
    });
    if (meAvatar && currentUser?.id) decorateAvatarWithStory(meAvatar, currentUser.id);
    if (peerAvatar && peerAvatar.dataset.userId) decorateAvatarWithStory(peerAvatar, peerAvatar.dataset.userId);
  } catch {}
}

function renderStoriesBar() {
  if (!storiesBar) return;
  storiesBar.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const uid of storyOrder) {
    const entry = storiesByUser.get(uid); if (!entry) continue;
    const item = document.createElement('div'); item.className = 'story' + (entry.allViewed ? ' viewed' : '');
    const ring = document.createElement('div'); ring.className = 'ring';
    const av = document.createElement('div'); av.className = 'avatar'; setAvatar(av, entry.user?.username || 'User', entry.user?.avatar_url);
    ring.appendChild(av);
    const name = document.createElement('div'); name.className = 'name'; name.textContent = entry.user?.username || 'User';
    item.appendChild(ring); item.appendChild(name);
    item.addEventListener('click', () => openStoryViewer(uid));
    frag.appendChild(item);
  }
  storiesBar.appendChild(frag);
}

function subscribeStories() {
  try {
    if (storiesChan) { sb.removeChannel(storiesChan); storiesChan = null; }
  } catch {}
  storiesChan = sb.channel('stories-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stories' }, () => { loadStories(); })
    .subscribe();
}

function setStoryMedia(story) {
  if (!story) return;
  try { svCaption.hidden = !story.caption; if (story.caption) svCaption.textContent = story.caption; } catch {}
  try { svTimestamp.textContent = formatTimeAgo(story.created_at); } catch {}
  const author = storiesByUser.get(story.user_id)?.user;
  setAvatar(svAvatar, author?.username || 'User', author?.avatar_url);
  if (svUsername) svUsername.textContent = author?.username || 'User';
  // Switch media
  const mediaUrl = normalizeStoryUrl(story.media_url);
  if (story.media_type === 'video') {
    if (svImg) svImg.hidden = true;
    if (svVideo) { svVideo.hidden = false; svVideo.src = mediaUrl; try { svVideo.play().catch(()=>{}); } catch {} }
  } else { // image or gif
    if (svVideo) { try { svVideo.pause(); } catch {}; svVideo.hidden = true; svVideo.src = ''; }
    if (svImg) { svImg.hidden = false; svImg.src = mediaUrl; }
  }
}

async function recordStoryView(story) {
  try {
    const meUser = await getCurrentUserSafe(); if (!meUser) return;
    await sb.from('story_views').upsert({ story_id: story.id, viewer_id: meUser.id }, { onConflict: 'story_id,viewer_id', ignoreDuplicates: true });
  } catch (e) {
    // fallback: ignore unique violation
  }
}

function openStoryViewer(userId, startIndex = null) {
  const entry = storiesByUser.get(userId); if (!entry) return;
  currentView.userId = userId;
  // Prefer first unviewed
  let idx = startIndex != null ? startIndex : entry.stories.findIndex(s => !isStoryViewedLocal(s.id));
  if (idx < 0) idx = 0;
  currentView.index = idx;
  const story = entry.stories[idx];
  setStoryMedia(story);
  recordStoryView(story).then(() => loadStories());
  if (storyViewer && typeof storyViewer.showModal === 'function') storyViewer.showModal();
}

function isStoryViewedLocal(storyId) {
  // We use ring state computed at loadStories time; after a view, we reload
  for (const [, entry] of storiesByUser) {
    if (entry.stories.some(s => s.id === storyId)) {
      // approximate: if not in any unviewed set at load time, treat as viewed
      // precise check requires a local set; for simplicity rely on reload
      return entry.allViewed; // may be inaccurate per-story; we reload after view
    }
  }
  return false;
}

function nextStory(step) {
  const entry = storiesByUser.get(currentView.userId); if (!entry) return;
  let idx = currentView.index + step;
  if (idx < 0) idx = 0;
  if (idx >= entry.stories.length) {
    // end: close viewer
    try { if (storyViewer) storyViewer.close(); } catch {}
    return;
  }
  currentView.index = idx;
  const story = entry.stories[idx];
  setStoryMedia(story);
  recordStoryView(story).then(() => loadStories());
}

async function handleAddStorySubmit(e) {
  e.preventDefault();
  console.debug('[Stories] Submit clicked');
  const meUser = await getCurrentUserSafe(); if (!meUser) { toast('error','Not signed in','Please sign in.'); return; }
  const file = addStoryFile?.files?.[0];
  if (!file) { toast('error','No file selected','Please choose an image or video.'); return; }
  if (!/^image\//.test(file.type) && !/^video\//.test(file.type)) { toast('error','Unsupported file','Choose an image or a video.'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('error','Too large','Max 20 MB'); return; }
  const prevText = addStorySubmitBtn ? addStorySubmitBtn.textContent : '';
  if (addStorySubmitBtn) { addStorySubmitBtn.disabled = true; addStorySubmitBtn.textContent = 'Posting...'; }
  if (storyProgress) storyProgress.hidden = false; // show indeterminate progress
  try {
    const media_type = /^video\//.test(file.type) ? 'video' : (file.type.includes('gif') ? 'gif' : 'image');
    const safe = `${meUser.id}/${Date.now()}-${(file.name||'story').replace(/[^a-zA-Z0-9-_.]/g,'_')}`;
    console.debug('[Stories] Uploading to bucket', STORIES_BUCKET, 'path', safe);
    // Upload
    const up = await sb.storage.from(STORIES_BUCKET).upload(safe, file, { contentType: file.type, upsert: false });
    if (up.error) { console.warn('[Stories] Upload error', up.error); toast('error','Upload failed', up.error.message); return; }
    const { data: pub } = sb.storage.from(STORIES_BUCKET).getPublicUrl(safe);
    const media_url = normalizeStoryUrl(pub?.publicUrl);
    if (!media_url) { toast('error','URL error','Could not resolve public URL'); return; }
    console.debug('[Stories] Public URL', media_url);
    const caption = addStoryCaption?.value?.trim() || null;
    const { error: insErr } = await sb.from('stories').insert({ user_id: meUser.id, media_url, media_type, caption });
    if (insErr) { console.warn('[Stories] Insert error', insErr); toast('error','Post failed', insErr.message); return; }
    try { addStoryForm?.reset(); addStoryModal?.close(); } catch {}
    await loadStories();
    toast('success','Story posted','Your story is live for 24 hours.');
  } finally {
    if (addStorySubmitBtn) { addStorySubmitBtn.disabled = false; addStorySubmitBtn.textContent = prevText || 'Post'; }
    if (storyProgress) storyProgress.hidden = true;
  }
}

async function sendStoryReply(text) {
  const entry = storiesByUser.get(currentView.userId); if (!entry) return;
  const authorId = entry.user?.id || currentView.userId;
  const meUser = await getCurrentUserSafe(); if (!meUser) return toast('error','Not signed in','Please sign in.');
  const body = (text || '').trim(); if (!body) return;
  const { error } = await sb.from('messages').insert({ sender_id: meUser.id, receiver_id: authorId, type: 'text', content: body });
  if (error) { toast('error','Reply failed', error.message); return; }
  // Jump to DM thread with author
  openConversation(authorId);
  try { storyViewer?.close(); } catch {}
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
  try { console.debug('[Auth] refreshSession -> hasSession:', !!session, 'userId:', currentUser?.id || null); } catch {}
  setLoggedInUI(!!currentUser);
  // On reload with a valid session, eagerly load profile so UI doesn't show 'Anonymous'
  try {
    if (currentUser) {
      await ensureProfile();
    }
  } catch {}
}

async function getCurrentUserSafe() {
  if (!currentUser) await refreshSession();
  return currentUser;
}

async function ensureProfile(usernameFromSignup) {
  const meUser = await getCurrentUserSafe();
  if (!meUser) {
    try { console.warn('ensureProfile: no session'); } catch {}
    return;
  }
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
  try { if (meAvatar && currentUser?.id) { meAvatar.dataset.userId = currentUser.id; decorateAvatarWithStory(meAvatar, currentUser.id); } } catch {}
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
let userListChan = null;
const unreadCountByPeer = new Map();
// Typing indicator: realtime bus and state
let typingBus = null;
const typingTimers = new Map(); // peerId -> timeout id for list indicator
let convoTypingEl = null;
let convoTypingTimer = null;
let typingLastSentAt = 0;

function ensureTypingBus() {
  try {
    if (!currentUser) return;
    if (typingBus) return;
    typingBus = sb.channel('typing-bus')
      .on('broadcast', { event: 'typing' }, (p) => {
        const payload = p?.payload || {};
        const from = payload.from; const to = payload.to;
        if (!from || !to) return;
        if (!currentUser || to !== currentUser.id) return; // only if directed to me
        // Update user list snippet to "Typing…"
        showTypingInList(from);
        // If active chat with that peer, show convo typing indicator
        if (activePeerId === from && chatScreen.classList.contains('active')) {
          showConversationTypingIndicator();
        }
      })
      .subscribe();
  } catch {}
}

function teardownTypingBus() {
  try { if (typingBus) { sb.removeChannel(typingBus); typingBus = null; } } catch {}
  typingTimers.forEach((t) => clearTimeout(t)); typingTimers.clear();
  hideConversationTypingIndicator();
}

async function loadUsers() {
  if (!userList) return;
  userList.innerHTML = '';
  try {
    const { data, error } = await sb.rpc('get_public_profiles');
    if (error) throw error;
    const meUser = await getCurrentUserSafe();
    const peers = (data || []).filter(u => !meUser || u.id !== meUser.id);
    // Fetch latest messages for all peers in two batched queries (outgoing and incoming)
    let lastByPeer = new Map();
    if (meUser && peers.length) {
      const peerIds = peers.map(u => u.id);
      const sel = 'sender_id,receiver_id,content,type,created_at';
      const [outRes, inRes] = await Promise.all([
        sb.from('messages').select(sel).eq('sender_id', meUser.id).in('receiver_id', peerIds).order('created_at', { ascending: false }),
        sb.from('messages').select(sel).eq('receiver_id', meUser.id).in('sender_id', peerIds).order('created_at', { ascending: false })
      ]);
      const combine = (rows, incoming) => {
        (rows?.data || []).forEach(m => {
          const peerId = incoming ? m.sender_id : m.receiver_id;
          const prev = lastByPeer.get(peerId);
          if (!prev || new Date(m.created_at) > new Date(prev.created_at)) {
            lastByPeer.set(peerId, { ...m, incoming });
          }
        });
      };
      combine(outRes, false); // messages you sent
      combine(inRes, true);   // messages you received
    }

    // Build initial unread counts (one query)
    if (meUser && peers.length) {
      try {
        const peerIds = peers.map(u => u.id);
        const { data: unseenRows } = await sb.from('messages')
          .select('sender_id')
          .eq('receiver_id', meUser.id)
          .in('sender_id', peerIds)
          .is('seen_at', null);
        unreadCountByPeer.clear();
        (unseenRows || []).forEach(r => {
          const n = unreadCountByPeer.get(r.sender_id) || 0;
          unreadCountByPeer.set(r.sender_id, n + 1);
        });
      } catch (e) { console.warn('init unread failed', e); }
    }

    peers.forEach(u => {
        const li = document.createElement('li');
        li.dataset.userId = u.id;
        li.innerHTML = `
          <div class="avatar"></div>
          <div class="info">
            <div class="name"></div>
            <div class="status"></div>
          </div>
        `;
        const av = li.querySelector('.avatar');
        setAvatar(av, u.username || 'User', u.avatar_url);
        // Append presence dot
        const dot = document.createElement('div');
        dot.className = 'status-dot ' + (u.is_online ? 'online' : 'offline');
        dot.setAttribute('aria-label', u.is_online ? 'Online' : 'Offline');
        av.appendChild(dot);
        // Unread badge
        const badge = document.createElement('span');
        badge.className = 'unread-badge';
        badge.hidden = true;
        av.appendChild(badge);
        li.querySelector('.name').textContent = u.username || 'User';
        // Last message snippet
        const last = lastByPeer.get(u.id);
        const statusEl = li.querySelector('.status');
        if (last) {
          const isIncoming = !!last.incoming;
          const prefix = isIncoming ? 'Received: ' : 'You: ';
          let snippet = '';
          const t = (last.type || 'text');
          const isDel = (t === 'deleted') || (last.content === '::deleted::');
          if (isDel) {
            snippet = 'This message was deleted';
          } else if (t === 'text') {
            const text = (last.content || '').replace(/\s+/g, ' ').trim();
            snippet = text.length > 42 ? text.slice(0, 42) + '…' : text;
          } else if (t === 'image') snippet = '[Photo]';
          else if (t === 'video') snippet = '[Video]';
          else if (t === 'gif') snippet = '[GIF]';
          else if (t === 'audio') snippet = '[Audio]';
          else snippet = '[Attachment]';
          statusEl.textContent = prefix + snippet;
        } else {
          // Fallback to presence/last active
          statusEl.textContent = u.is_online ? 'Active now' : (u.last_active ? formatTimeAgo(u.last_active) : 'Offline');
        }
        // Set initial unread
        const uc = unreadCountByPeer.get(u.id) || 0;
        applyUnreadBadge(li, uc);
        li.addEventListener('click', () => openConversation(u.id));
        userList.appendChild(li);
      });
  } catch (e) {
    console.warn('loadUsers failed', e);
  }
}

function formatListSnippetFromRow(m, meId) {
  if (!m) return '';
  const incoming = m.receiver_id === meId; // if me is receiver, it's incoming
  const prefix = incoming ? 'Received: ' : 'You: ';
  const t = (m.type || 'text');
  const isDel = (t === 'deleted') || (m.content === '::deleted::');
  let body = '';
  if (isDel) body = 'This message was deleted';
  else if (t === 'text') {
    const text = (m.content || '').replace(/\s+/g, ' ').trim();
    body = text.length > 42 ? text.slice(0, 42) + '…' : text;
  } else if (t === 'image') body = '[Photo]';
  else if (t === 'video') body = '[Video]';
  else if (t === 'gif') body = '[GIF]';
  else if (t === 'audio') body = '[Audio]';
  else body = '[Attachment]';
  return prefix + body;
}

function updateUserListItemSnippet(peerId, row) {
  try {
    const li = userList?.querySelector(`li[data-user-id="${peerId}"]`);
    if (!li) return;
    const status = li.querySelector('.status');
    if (!status) return;
    status.textContent = formatListSnippetFromRow(row, currentUser?.id);
  } catch {}
}

function subscribeUserListMessages() {
  try {
    if (!currentUser) return;
    if (userListChan) { sb.removeChannel(userListChan); userListChan = null; }
    const meId = currentUser.id;
    userListChan = sb.channel('inbox-overview')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${meId}` }, (p) => {
        const m = p.new; if (!m) return; updateUserListItemSnippet(m.receiver_id, m);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${meId}` }, (p) => {
        const m = p.new; if (!m) return; updateUserListItemSnippet(m.sender_id, m); refreshUnreadForPeer(m.sender_id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${meId}` }, (p) => {
        const m = p.new; if (!m) return; updateUserListItemSnippet(m.receiver_id, m);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `receiver_id=eq.${meId}` }, (p) => {
        const m = p.new; if (!m) return; updateUserListItemSnippet(m.sender_id, m); refreshUnreadForPeer(m.sender_id);
      })
      .subscribe();
  } catch (e) { console.warn('subscribeUserListMessages failed', e); }
}

function applyUnreadBadge(li, count) {
  try {
    const badge = li.querySelector('.unread-badge');
    if (!badge) return;
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 9 ? '9+' : String(count);
    } else {
      badge.hidden = true;
      badge.textContent = '';
    }
  } catch {}
}

function setUnreadBadge(peerId, count) {
  unreadCountByPeer.set(peerId, count);
  const li = userList?.querySelector(`li[data-user-id="${peerId}"]`);
  if (li) applyUnreadBadge(li, count);
}

async function refreshUnreadForPeer(peerId) {
  try {
    if (!currentUser) return;
    const { count } = await sb.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', currentUser.id)
      .eq('sender_id', peerId)
      .is('seen_at', null);
    setUnreadBadge(peerId, count || 0);
  } catch (e) { console.warn('refreshUnreadForPeer failed', e); }
}

async function enterChat() {
  // Navigate to chat screen, set presence, and load user list
  show(chatScreen);
  await setPresence(true);
  await loadUsers();
  // Start realtime updates for inbox previews (last message per user)
  subscribeUserListMessages();
  // Load stories bar once in chat
  try { await loadStories(); subscribeStories(); } catch (e) { console.warn('stories init failed', e); }
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
  // Clear unread badge for this peer in the user list immediately
  try { setUnreadBadge(activePeerId, 0); } catch {}
  updateDeliveryStatus();
  subscribeMessages();
  ensureTypingBus();
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
        hideConversationTypingIndicator();
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
  let edited = false;
  try {
    if (m.updated_at) {
      const cu = new Date(m.created_at).getTime();
      const uu = new Date(m.updated_at).getTime();
      // Consider edited only if meaningfully later (>2s) to avoid default updated_at on insert
      edited = isFinite(cu) && isFinite(uu) && (uu - cu) > 2000;
    }
  } catch {}
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
      messagesById.set(m.id, m);
      // Re-render to update meta with edited timestamp logic
      renderMessage(m, { replace: true });
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
  hideConversationTypingIndicator();
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
    try { console.debug('[Auth] onAuthStateChange', event, 'hasSession:', !!s, 'userId:', s?.user?.id || null); } catch {}
    if (event === 'SIGNED_IN') {
      await refreshSession();
      ensureTypingBus();
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
      teardownTypingBus();
      setLoggedInUI(false);
      show(calculatorScreen);
    }
  });
}

(async function init() {
  // Enforce dark mode by default
  applyTheme('dark');
  try { await refreshSession(); } catch { /* ignore */ }
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
  // Typing emit wiring
  try {
    if (msgInput) {
      msgInput.addEventListener('input', emitTyping);
      msgInput.addEventListener('focus', emitTyping);
      msgInput.addEventListener('blur', () => { typingLastSentAt = 0; });
    }
  } catch {}
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

// Stories UI wiring
try {
  if (btnAddStory && addStoryModal && typeof addStoryModal.showModal === 'function') {
    btnAddStory.addEventListener('click', async () => {
      await refreshSession();
      if (!currentUser) { toast('error','Not signed in','Sign in to post a story.'); return; }
      addStoryModal.showModal();
    });
  }
  if (addStoryCancel && addStoryModal) addStoryCancel.addEventListener('click', () => addStoryModal.close());
  if (addStoryForm) addStoryForm.addEventListener('submit', handleAddStorySubmit);
  if (svPrev) svPrev.addEventListener('click', () => nextStory(-1));
  if (svNext) svNext.addEventListener('click', () => nextStory(1));
  if (svCloseBtn && storyViewer) svCloseBtn.addEventListener('click', () => { try { if (svVideo) svVideo.pause(); } catch {} storyViewer.close(); });
  if (storyViewer) storyViewer.addEventListener('click', (e) => { if (e.target === storyViewer) { try { if (svVideo) svVideo.pause(); } catch {} storyViewer.close(); } });
  if (svReplySend) svReplySend.addEventListener('click', async () => { const v = svReplyInput?.value || ''; await sendStoryReply(v); if (svReplyInput) svReplyInput.value=''; });
  if (svReplyInput) svReplyInput.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = svReplyInput.value; await sendStoryReply(v); svReplyInput.value=''; } });
} catch {}

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
