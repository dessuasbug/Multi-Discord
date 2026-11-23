const {
  app, BaseWindow, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell, dialog, nativeImage, screen, safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DISCORD_URL = 'https://discord.com/app';
const SIDEBAR_FULL = 220;
const SIDEBAR_COMPACT = 72;
const SIDEBAR_COLLAPSED = 22;
const NOTIF_WIDTH = 380;
const POP_BAR = 38;
const TITLE_H = 38;
const DIVIDER_W = 8;
const MIN_PANE = 320;
const PROXY_TYPES = ['none', 'http', 'https', 'socks4', 'socks5'];
const HEX = /^#[0-9a-f]{6}$/i;
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const ALLOWED_PERMISSIONS = [
  'notifications', 'media', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write',
];

const T = (label, scheme, accent, bg, deep, hover, active, text, muted, line, field) => ({
  label, scheme, accent,
  vars: { '--bg': bg, '--bg-deep': deep, '--hover': hover, '--active': active, '--text': text, '--muted': muted, '--line': line, '--field': field },
});
const THEMES = {
  midnight: T('Midnight', 'dark', '#7d8cff', '#17181c', '#121317', '#22242a', '#2f3340', '#e3e5ea', '#8a8f9c', '#3a3e4b', '#101114'),
  obsidian: T('Obsidian', 'dark', '#d4af6a', '#0e0e10', '#080809', '#1a1a1d', '#262219', '#ece8df', '#8f8a7c', '#2e2c26', '#070708'),
  graphite: T('Graphite', 'dark', '#8ab4f8', '#1f1f1f', '#181818', '#2a2a2a', '#383838', '#ececec', '#9a9a9a', '#474747', '#171717'),
  nord: T('Nord', 'dark', '#88c0d0', '#2e3440', '#262b35', '#3b4252', '#434c5e', '#eceff4', '#9aa7bd', '#4c566a', '#242933'),
  tokyo: T('Tokyo Night', 'dark', '#7aa2f7', '#1a1b26', '#14151e', '#24283b', '#2f3549', '#c0caf5', '#7982a9', '#3b4261', '#13131b'),
  mocha: T('Mocha', 'dark', '#cba6f7', '#1e1e2e', '#181825', '#2a2b3c', '#363850', '#cdd6f4', '#9399b2', '#45475a', '#11111b'),
  gruvbox: T('Gruvbox', 'dark', '#fabd2f', '#282828', '#1d2021', '#32302f', '#413d3a', '#ebdbb2', '#a89984', '#504945', '#1d2021'),
  solarized: T('Solarized', 'dark', '#2aa198', '#002b36', '#00212a', '#073642', '#0d4452', '#b5c1c1', '#7f9296', '#1f5260', '#00202a'),
  ember: T('Ember', 'dark', '#e8844a', '#1c1512', '#150f0d', '#271d19', '#3a2a22', '#f1e5dc', '#a38f82', '#4a362c', '#120c0a'),
  forest: T('Forest', 'dark', '#5fb98a', '#14201a', '#0f1814', '#1c2b23', '#28402f', '#e4efe8', '#8fa89a', '#2f4a3b', '#0e1712'),
  rose: T('Rose', 'dark', '#e58aa0', '#231519', '#1a0f13', '#2e1d22', '#432831', '#f4e6ea', '#b08f98', '#5a3640', '#190f12'),
  daylight: T('Daylight', 'light', '#5865f2', '#f3f4f7', '#ebedf2', '#e6e8ee', '#d9dcea', '#1d2030', '#666c80', '#c5c9d6', '#ffffff'),
  mist: T('Mist', 'light', '#3b6fd8', '#eef1f5', '#e5e9ef', '#e1e6ee', '#d3dbe8', '#1f2733', '#5f6b7c', '#c9d1dd', '#ffffff'),
  linen: T('Linen', 'light', '#b4572b', '#f4f0ea', '#ebe5db', '#e8e1d6', '#ddd3c3', '#2b2620', '#7a6f60', '#d4c9b8', '#fffdf9'),
};

const DEFAULT_SETTINGS = {
  theme: 'midnight', accent: '#7d8cff', compact: false, collapsed: false,
  hideMenuBar: false, dnd: false, updateUrl: '', autoUpdate: true, splitRatio: 0.5,
};

let win = null;
let sidebar = null;
let notifView = null;
let settingsWin = null;
let divider = null;
let titlebar = null;
let overlayView = null;
let overlayOpen = false;
let overlayDialogResolve = null;
let overlayDialogCancel = -1;
let menuSeq = 0;
const overlayActions = new Map();
let notifOpen = false;
let quitting = false;
let accounts = [];
let groups = [];              // [{ id, name, collapsed }]
let activeId = null;
let splitId = null;           // account shown beside the active one
let windowState = null;
let notifications = [];
let settings = { ...DEFAULT_SETTINGS };
let updater = { status: 'idle', message: '' };
const views = new Map();      // account id -> WebContentsView
const badges = new Map();     // account id -> { mentions, unread }
const cssKeys = new Map();
const popouts = new Map();    // account id -> { win, bar, onTop, docked, layout }
const notifRate = new Map();
const proxyTries = new Map();

// ---------- storage ----------
const storePath = () => path.join(app.getPath('userData'), 'accounts.json');
const notifPath = () => path.join(app.getPath('userData'), 'notifications.json');

function normalizeAccount(a) {
  const icon = a.icon && a.icon.value && (
    (a.icon.type === 'emoji') ||
    (a.icon.type === 'image' && String(a.icon.value).startsWith('data:image/'))
  ) ? { type: a.icon.type, value: String(a.icon.value) } : null;
  return {
    id: String(a.id),
    name: String(a.name || 'Account').slice(0, 24),
    color: HEX.test(a.color || '') ? a.color : null,
    icon,
    muteNotifications: !!a.muteNotifications,
    muteAudio: !!a.muteAudio,
    zoom: Math.min(2, Math.max(0.5, Number(a.zoom) || 1)),
    css: String(a.css || '').slice(0, 20000),
    groupId: a.groupId ? String(a.groupId) : null,
    proxy: normalizeProxy(a.proxy),
  };
}

function normalizeProxy(p) {
  if (!p || !PROXY_TYPES.includes(p.type) || p.type === 'none') return null;
  const host = String(p.host || '').trim();
  const port = parseInt(p.port, 10);
  if (!/^[A-Za-z0-9._\-\[\]:]{1,253}$/.test(host) || !(port >= 1 && port <= 65535)) return null;
  return {
    type: p.type,
    host,
    port,
    username: String(p.username || '').slice(0, 128),
    passwordEnc: p.passwordEnc ? String(p.passwordEnc) : '',
  };
}

function encryptPw(pw) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(pw).toString('base64');
}
function decryptPw(enc) {
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
}

function cleanUrl(u) {
  const s = String(u || '').trim().slice(0, 300);
  return /^https?:\/\//i.test(s) ? s : '';
}

function loadStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (Array.isArray(data.accounts)) accounts = data.accounts.map(normalizeAccount);
    activeId = data.activeId;
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    if (Array.isArray(data.groups)) {
      groups = data.groups.filter((g) => g && g.id).map((g) => ({
        id: String(g.id), name: String(g.name || 'Group').slice(0, 24), collapsed: !!g.collapsed,
      }));
    }
    splitId = data.splitId ? String(data.splitId) : null;
    const w = data.windowState;
    if (w && [w.width, w.height].every((n) => Number.isFinite(n))) {
      windowState = { x: w.x, y: w.y, width: w.width, height: w.height, maximized: !!w.maximized };
    }
  } catch {
    accounts = [];
  }
  if (!THEMES[settings.theme]) settings.theme = DEFAULT_SETTINGS.theme;
  if (!HEX.test(settings.accent)) settings.accent = THEMES[settings.theme].accent;
  settings.updateUrl = cleanUrl(settings.updateUrl);
  if (!accounts.length) accounts = [normalizeAccount({ id: crypto.randomUUID(), name: 'Account 1' })];
  if (!accounts.some((a) => a.id === activeId)) activeId = accounts[0].id;
  if (!accounts.some((a) => a.id === splitId) || splitId === activeId) splitId = null;
  accounts.forEach((a) => { if (a.groupId && !groups.some((g) => g.id === a.groupId)) a.groupId = null; });
  settings.splitRatio = Math.min(0.85, Math.max(0.15, Number(settings.splitRatio) || 0.5));
  try {
    const n = JSON.parse(fs.readFileSync(notifPath(), 'utf8'));
    if (Array.isArray(n)) {
      notifications = n.filter((x) => x && x.id && x.accountId).slice(0, 200).map((x) => ({
        id: String(x.id), accountId: String(x.accountId), title: String(x.title || '').slice(0, 200),
        body: String(x.body || '').slice(0, 500), time: Number(x.time) || Date.now(), read: !!x.read,
      }));
    }
  } catch { /* none yet */ }
}

function saveStore() {
  fs.writeFileSync(storePath(), JSON.stringify({ accounts, groups, activeId, splitId, settings, windowState }, null, 2));
}

let notifTimer = null;
function saveNotifs() {
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => {
    try { fs.writeFileSync(notifPath(), JSON.stringify(notifications.slice(0, 100))); } catch { /* ignore */ }
  }, 400);
}

// ---------- state shared with the UI windows ----------
const acct = (id) => accounts.find((a) => a.id === id);
const sidebarWidth = () => (settings.collapsed ? SIDEBAR_COLLAPSED : settings.compact ? SIDEBAR_COMPACT : SIDEBAR_FULL);
const themeBg = () => THEMES[settings.theme].vars['--bg'];
const overlayFor = (height = TITLE_H) => ({
  color: THEMES[settings.theme].vars['--bg-deep'],
  symbolColor: THEMES[settings.theme].vars['--text'],
  height,
});

function getState() {
  const t = THEMES[settings.theme];
  const live = notifications.filter((n) => acct(n.accountId));
  return {
    activeId,
    splitId,
    groups,
    settings,
    updater: { ...updater, version: app.getVersion(), packaged: app.isPackaged },
    notifOpen,
    notifications: live.slice(0, 100),
    unreadNotifs: live.filter((n) => !n.read).length,
    theme: { id: settings.theme, scheme: t.scheme, vars: { ...t.vars, '--accent': settings.accent } },
    themes: Object.entries(THEMES).map(([id, th]) => ({ id, label: th.label, scheme: th.scheme, accent: th.accent, vars: th.vars })),
    accounts: accounts.map(({ proxy, ...a }) => ({
      ...a,
      proxy: proxy ? { type: proxy.type, host: proxy.host, port: proxy.port, username: proxy.username, hasPassword: !!proxy.passwordEnc } : null,
      popped: popouts.has(a.id),
      onTop: !!popouts.get(a.id)?.onTop,
      mentions: badges.get(a.id)?.mentions || 0,
      unread: !!badges.get(a.id)?.unread,
    })),
  };
}

function pushState() {
  const s = getState();
  const targets = [sidebar, settingsWin, notifView, divider, titlebar, overlayView, ...[...popouts.values()].map((p) => p.bar)];
  for (const w of targets) {
    if (w && !w.webContents.isDestroyed()) w.webContents.send('state', s);
  }
  const total = [...badges.values()].reduce((n, b) => n + b.mentions, 0);
  if (win) win.setTitle(total ? `Multi Discord (${total})` : 'Multi Discord');
  for (const [id, p] of popouts) {
    const a = acct(id);
    const m = badges.get(id)?.mentions || 0;
    if (a && !p.win.isDestroyed()) p.win.setTitle(`${m ? `(${m}) ` : ''}${a.name} - Multi Discord`);
  }
}

function changed() {
  saveStore();
  buildMenu();
  pushState();
}

// ---------- per-account behaviour ----------
async function applyCss(id) {
  const a = acct(id);
  const wc = views.get(id)?.webContents;
  if (!a || !wc || wc.isDestroyed()) return;
  const old = cssKeys.get(id);
  if (old) {
    try { await wc.removeInsertedCSS(old); } catch { /* page reloaded */ }
    cssKeys.delete(id);
  }
  if (a.css.trim()) {
    try { cssKeys.set(id, await wc.insertCSS(a.css)); } catch { /* ignore */ }
  }
}

function applyAccount(id, { css = false } = {}) {
  const a = acct(id);
  const wc = views.get(id)?.webContents;
  if (!a || !wc || wc.isDestroyed()) return;
  wc.setAudioMuted(a.muteAudio);
  if (!wc.isLoading()) wc.setZoomFactor(a.zoom);
  wc.send('md-muted', settings.dnd || a.muteNotifications);
  if (css) applyCss(id);
}

function updateAccount(id, patch) {
  const a = acct(id);
  if (!a) return;
  if ('name' in patch) {
    const n = String(patch.name || '').trim().slice(0, 24);
    if (n) a.name = n;
  }
  if ('color' in patch) a.color = HEX.test(patch.color || '') ? patch.color : null;
  if ('icon' in patch) {
    if (patch.icon && patch.icon.type === 'emoji') {
      const e = Array.from(String(patch.icon.value || '')).slice(0, 8).join('').trim();
      a.icon = e ? { type: 'emoji', value: e } : null;
    } else if (!patch.icon) {
      a.icon = null;
    }
  }
  if ('muteNotifications' in patch) a.muteNotifications = !!patch.muteNotifications;
  if ('muteAudio' in patch) a.muteAudio = !!patch.muteAudio;
  if ('zoom' in patch) a.zoom = Math.min(2, Math.max(0.5, Number(patch.zoom) || 1));
  if ('css' in patch) a.css = String(patch.css || '').slice(0, 20000);
  if ('groupId' in patch) a.groupId = groups.some((g) => g.id === patch.groupId) ? patch.groupId : null;
  applyAccount(id, { css: 'css' in patch });
  changed();
}

function updateSettings(patch) {
  if (patch.theme && THEMES[patch.theme]) {
    settings.theme = patch.theme;
    if (!('accent' in patch)) settings.accent = THEMES[patch.theme].accent;
  }
  if (HEX.test(patch.accent || '')) settings.accent = patch.accent;
  for (const k of ['compact', 'collapsed', 'hideMenuBar', 'dnd', 'autoUpdate']) {
    if (k in patch) settings[k] = !!patch[k];
  }
  if ('updateUrl' in patch) settings.updateUrl = cleanUrl(patch.updateUrl);
  applyWindowSettings();
  for (const id of views.keys()) applyAccount(id);
  changed();
}

function applyWindowSettings() {
  const bg = themeBg();
  const wins = [win, ...[...popouts.values()].map((p) => p.win)].filter((w) => w && !w.isDestroyed());
  for (const w of wins) {
    w.setBackgroundColor(bg);
    try { w.setTitleBarOverlay(overlayFor()); } catch { /* not supported here */ }
  }
  layout();
  for (const p of popouts.values()) p.layout();
  setTimeout(() => { layout(); for (const p of popouts.values()) p.layout(); }, 80);
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.setBackgroundColor(bg);
    try { settingsWin.setTitleBarOverlay(overlayFor()); } catch { /* not supported here */ }
  }
}

// ---------- layout ----------
function splitShown(areaWidth) {
  if (!win || !splitId || splitId === activeId || !views.has(splitId) || popouts.has(splitId)) return false;
  const a = areaWidth ?? Math.max(0, win.getContentBounds().width - sidebarWidth());
  return a >= 2 * MIN_PANE + DIVIDER_W;
}

function layout() {
  if (!win) return;
  const { width, height: fullH } = win.getContentBounds();
  const height = Math.max(0, fullH - TITLE_H);
  const top = TITLE_H;
  const sw = sidebarWidth();
  const area = Math.max(0, width - sw);
  titlebar.setBounds({ x: 0, y: 0, width, height: TITLE_H });
  overlayView.setBounds({ x: 0, y: 0, width, height: fullH });
  sidebar.setBounds({ x: 0, y: top, width: sw, height });

  const showSplit = splitShown(area);
  let leftW = area;
  if (showSplit) {
    leftW = Math.round((area - DIVIDER_W) * settings.splitRatio);
    leftW = Math.min(area - DIVIDER_W - MIN_PANE, Math.max(MIN_PANE, leftW));
  }
  for (const [id, v] of views) {
    if (popouts.has(id)) continue;
    if (showSplit && id === splitId) {
      v.setBounds({ x: sw + leftW + DIVIDER_W, y: top, width: area - leftW - DIVIDER_W, height });
      v.setVisible(true);
    } else {
      v.setBounds({ x: sw, y: top, width: showSplit ? leftW : area, height });
      v.setVisible(id === activeId);
    }
  }
  divider.setVisible(showSplit);
  if (showSplit) divider.setBounds({ x: sw + leftW, y: top, width: DIVIDER_W, height });
  notifView.setBounds({ x: sw, y: top, width: Math.min(NOTIF_WIDTH, area), height });
}

function openSplit(id) {
  if (!views.has(id) || id === activeId) return;
  if (popouts.has(id)) { focusWindow(popouts.get(id).win); return; }
  splitId = id;
  layout();
  changed();
  if (!splitShown()) {
    showDialog({
      type: 'info',
      message: 'Make the window wider to see split view.',
      detail: 'Each side needs about 320 pixels. It will appear as soon as there is room.',
    });
  }
}

function closeSplit() {
  if (!splitId) return;
  splitId = null;
  layout();
  changed();
}

function swapSplit() {
  if (!splitId || !splitShown()) return;
  [activeId, splitId] = [splitId, activeId];
  layout();
  changed();
}

const firstDocked = (exceptId) => accounts.find((a) => !popouts.has(a.id) && a.id !== exceptId);

// ---------- proxy ----------
const hostForUrl = (h) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);

async function applyProxy(id, { reload = false } = {}) {
  const a = acct(id);
  const wc = views.get(id)?.webContents;
  if (!a || !wc || wc.isDestroyed()) return;
  const ses = wc.session;
  try {
    if (a.proxy) {
      await ses.setProxy({
        proxyRules: `${a.proxy.type}://${hostForUrl(a.proxy.host)}:${a.proxy.port}`,
        proxyBypassRules: '<local>',
      });
      // Keeps calls from sending your real address around the proxy.
      wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } else {
      await ses.setProxy({ mode: 'system' });
      wc.setWebRTCIPHandlingPolicy('default');
    }
    if (reload) {
      await ses.closeAllConnections();
      wc.reload();
    }
  } catch { /* ignore */ }
}

app.on('login', (event, wc, _request, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  let a = null;
  if (wc) for (const [id, v] of views) if (v.webContents.id === wc.id) a = acct(id);
  if (!a) {
    a = accounts.find((x) => x.proxy && x.proxy.username && x.proxy.host === authInfo.host && x.proxy.port === authInfo.port);
  }
  if (!a || !a.proxy || !a.proxy.username) return;
  event.preventDefault();
  // Stop after a few tries so a wrong password can't loop forever.
  const now = Date.now();
  const tries = (proxyTries.get(a.id) || []).filter((t) => now - t < 30000);
  tries.push(now);
  proxyTries.set(a.id, tries);
  if (tries.length > 3) { callback(); return; }
  callback(a.proxy.username, decryptPw(a.proxy.passwordEnc));
});

// ---------- groups ----------
const group = (id) => groups.find((g) => g.id === id);

function createGroup(name, accountId) {
  const g = {
    id: crypto.randomUUID(),
    name: String(name || '').trim().slice(0, 24) || `Group ${groups.length + 1}`,
    collapsed: false,
  };
  groups.push(g);
  const a = acct(accountId);
  if (a) a.groupId = g.id;
  changed();
}

function setGroup(accountId, groupId) {
  const a = acct(accountId);
  if (!a) return;
  a.groupId = group(groupId) ? groupId : null;
  accounts = accounts.filter((x) => x !== a);
  accounts.push(a); // lands at the end of its new group
  changed();
}

// ---------- clean shutdown ----------
// Save everything and let the Discord pages close properly before the app exits,
// instead of killing them mid-write.
let shuttingDown = false;
function flushAll() {
  for (const v of views.values()) {
    try {
      const ses = v.webContents.session;
      ses.flushStorageData();
      ses.cookies.flushStore().catch(() => {});
    } catch { /* ignore */ }
  }
}
// Discord's page keeps its login out of storage while it runs and writes it back when the
// page unloads. Quitting without letting that happen loses the login, so fire the page's
// unload handlers and navigate away for real before the app exits.
const UNLOAD_JS = `(() => {
  try {
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('unload'));
  } catch (e) {}
  return true;
})()`;

function gracefulShutdown(done) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { saveWindowStateNow(); } catch { /* ignore */ }
  try { saveStore(); } catch { /* ignore */ }
  try { clearTimeout(notifTimer); fs.writeFileSync(notifPath(), JSON.stringify(notifications.slice(0, 100))); } catch { /* ignore */ }
  for (const w of [win, settingsWin, ...[...popouts.values()].map((p) => p.win)]) {
    try { if (w && !w.isDestroyed()) w.hide(); } catch { /* ignore */ }
  }
  // 1. run the pages' own unload handlers
  for (const v of views.values()) {
    try { v.webContents.executeJavaScript(UNLOAD_JS).catch(() => {}); } catch { /* ignore */ }
  }
  // 2. then leave the page for real so the browser unloads it properly
  setTimeout(() => {
    flushAll();
    for (const v of views.values()) {
      try { v.webContents.loadURL('about:blank').catch(() => {}); } catch { /* ignore */ }
    }
  }, 350);
  // 3. write everything to disk and exit
  setTimeout(() => {
    flushAll();
    for (const v of views.values()) { try { v.webContents.close(); } catch { /* ignore */ } }
  }, 1000);
  setTimeout(() => {
    flushAll();
    quitting = true;
    (done || (() => app.quit()))();
  }, 1250);
}

// ---------- window size and position ----------
let wsTimer = null;
function saveWindowStateNow() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  windowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
  saveStore();
}
function scheduleWindowState() {
  clearTimeout(wsTimer);
  wsTimer = setTimeout(saveWindowStateNow, 600);
}
function initialBounds() {
  const out = { width: 1300, height: 850 };
  const ws = windowState;
  if (!ws) return out;
  out.width = Math.max(900, Math.min(ws.width, 10000));
  out.height = Math.max(600, Math.min(ws.height, 10000));
  if (Number.isFinite(ws.x) && Number.isFinite(ws.y)) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      const ix = Math.min(ws.x + out.width, wa.x + wa.width) - Math.max(ws.x, wa.x);
      const iy = Math.min(ws.y + out.height, wa.y + wa.height) - Math.max(ws.y, wa.y);
      return ix >= 200 && iy >= 100;
    });
    if (onScreen) { out.x = ws.x; out.y = ws.y; }
  }
  return out;
}

// ---------- account views ----------
function createView(a) {
  const ses = session.fromPartition(`persist:acct-${a.id}`);

  const ua = ses
    .getUserAgent()
    .replace(/(\(KHTML, like Gecko\)) .*? (Chrome\/)/, '$1 $2')
    .replace(/ Electron\/\S+/, '');
  ses.setUserAgent(ua);

  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.includes(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.includes(permission));

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'page-preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('page-title-updated', (_e, title) => {
    const m = title.match(/^\((\d+)\)/);
    badges.set(a.id, {
      mentions: m ? parseInt(m[1], 10) : 0,
      unread: !m && title.startsWith('•'),
    });
    pushState();
  });

  view.webContents.on('dom-ready', () => applyAccount(a.id, { css: true }));
  view.webContents.on('will-prevent-unload', (e) => e.preventDefault());
  hookShortcuts(view.webContents);

  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(a.id, view);
  view.webContents.setAudioMuted(a.muteAudio);
  applyProxy(a.id).finally(() => view.webContents.loadURL(DISCORD_URL));
  return view;
}

function setNotifOpen(open) {
  if (notifOpen === open || !notifView) return;
  notifOpen = open;
  notifView.setVisible(open);
  if (open) {
    win.contentView.addChildView(notifView); // bring to front
    layout();
    notifView.webContents.focus();
  } else {
    const wc = views.get(activeId)?.webContents;
    if (wc && !popouts.has(activeId)) wc.focus();
  }
  pushState();
}

function focusWindow(w) {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

function activate(id) {
  if (!views.has(id)) return;
  if (popouts.has(id)) { focusWindow(popouts.get(id).win); return; }
  if (notifOpen) { notifOpen = false; notifView.setVisible(false); }
  if (id === splitId) splitId = activeId; // it is already on screen: swap sides
  activeId = id;
  layout();
  views.get(id).webContents.focus();
  changed();
}

function dockAny() {
  const first = [...popouts.keys()][0];
  if (first) dockInternal(first, { activate: false });
  return first;
}

async function removeAccount(id) {
  const a = acct(id);
  if (!a) return;
  if (accounts.length === 1) {
    showDialog({
      type: 'info',
      message: 'You need at least one account slot.',
      detail: 'Add another account first, then remove this one.',
    });
    return;
  }
  const response = await showDialog({
    type: 'warning',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Remove "${a.name}"?`,
    detail: "This signs out and deletes this account's data from the app. Your Discord account itself isn't affected.",
  });
  if (response !== 0) return;

  if (popouts.has(id)) {
    const p = popouts.get(id);
    dockInternal(id, { activate: false });
    p.win.destroy();
  }
  const view = views.get(id);
  const ses = view.webContents.session;
  win.contentView.removeChildView(view);
  view.webContents.close();
  await ses.clearStorageData();
  await ses.clearCache();
  views.delete(id);
  badges.delete(id);
  cssKeys.delete(id);
  accounts = accounts.filter((x) => x.id !== id);
  notifications = notifications.filter((n) => n.accountId !== id);
  saveNotifs();
  if (splitId === id) splitId = null;
  if (activeId === id) {
    const next = splitId || firstDocked(id)?.id || dockAny();
    if (next === splitId) splitId = null;
    activeId = next;
    layout();
    views.get(next)?.webContents.focus();
  }
  layout();
  changed();
}

// ---------- pop-out windows ----------
function popOut(id, at) {
  if (popouts.has(id) || !views.has(id) || !win) return;
  if (!firstDocked(id)) {
    showDialog({
      type: 'info',
      message: 'Keep one account in the main window.',
      detail: 'Dock another account back first, or add a new account.',
    });
    return;
  }
  const a = acct(id);
  const view = views.get(id);
  const b = win.getBounds();
  const pw = new BaseWindow({
    x: at ? Math.round(at.x - 140) : b.x + 70,
    y: at ? Math.round(at.y - 20) : b.y + 70,
    width: 1000,
    height: 720,
    minWidth: 520,
    minHeight: 420,
    title: `${a.name} - Multi Discord`,
    backgroundColor: themeBg(),
    icon: ICON_PATH,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayFor(POP_BAR),
  });
  const bar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  bar.webContents.on('will-navigate', (e) => e.preventDefault());

  win.contentView.removeChildView(view);
  pw.contentView.addChildView(view);
  pw.contentView.addChildView(bar);
  view.setVisible(true);

  const p = { win: pw, bar, onTop: false, docked: false };
  p.layout = () => {
    if (pw.isDestroyed()) return;
    const { width, height } = pw.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: POP_BAR });
    view.setBounds({ x: 0, y: POP_BAR, width, height: Math.max(0, height - POP_BAR) });
  };
  popouts.set(id, p);
  pw.on('resize', p.layout);
  pw.on('enter-full-screen', p.layout);
  pw.on('leave-full-screen', p.layout);
  pw.on('close', () => {
    if (quitting || !win) { p.docked = true; return; }
    dockInternal(id, { activate: true });
  });
  bar.webContents.loadFile(path.join(__dirname, 'popout.html'), { query: { id } });
  hookShortcuts(bar.webContents);
  p.layout();
  setTimeout(p.layout, 80);

  if (splitId === id) splitId = null;
  if (activeId === id) {
    const next = splitId || firstDocked(id).id;
    if (next === splitId) splitId = null;
    activeId = next;
  }
  layout();
  changed();
}

// Moves the account view back into the main window. Safe to call twice.
function dockInternal(id, { activate: doActivate = true } = {}) {
  const p = popouts.get(id);
  if (!p || p.docked) return;
  p.docked = true;
  const view = views.get(id);
  try {
    p.win.contentView.removeChildView(view);
    p.win.contentView.removeChildView(p.bar);
    p.bar.webContents.close();
  } catch { /* window already going away */ }
  popouts.delete(id);
  if (win && view) {
    win.contentView.addChildView(view);
    view.setVisible(false);
  }
  layout();
  if (doActivate) activate(id); else changed();
}

function togglePopOut(id) {
  if (popouts.has(id)) popouts.get(id).win.close();
  else popOut(id);
}

function popoutForSender(sender) {
  for (const [id, p] of popouts) if (p.bar.webContents.id === sender.id) return [id, p];
  return [null, null];
}

// ---------- notification center ----------
function accountIdForSender(sender) {
  for (const [id, v] of views) if (v.webContents.id === sender.id) return id;
  return null;
}

function addNotification(accountId, title, body) {
  const now = Date.now();
  const r = (notifRate.get(accountId) || []).filter((t) => now - t < 10000);
  if (r.length >= 30) { notifRate.set(accountId, r); return; }
  r.push(now);
  notifRate.set(accountId, r);
  notifications.unshift({
    id: crypto.randomUUID(),
    accountId,
    title: String(title || '').slice(0, 200),
    body: String(body || '').slice(0, 500),
    time: now,
    read: false,
  });
  if (notifications.length > 200) notifications.length = 200;
  saveNotifs();
  pushState();
}

// ---------- updates ----------
let autoUpdater = null;

function setUpdater(status, message) {
  updater = { status, message };
  pushState();
}

function setupUpdater() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdater('checking', 'Checking for updates...'));
  autoUpdater.on('update-available', (i) => setUpdater('downloading', `Downloading version ${i.version}...`));
  autoUpdater.on('update-not-available', () => setUpdater('idle', "You're on the latest version."));
  autoUpdater.on('download-progress', (p) => setUpdater('downloading', `Downloading... ${Math.round(p.percent)}%`));
  autoUpdater.on('error', (err) => {
    const msg = String((err && err.message) || err).split('\n')[0].slice(0, 160);
    setUpdater('error', `Update check failed: ${msg}`);
  });
  autoUpdater.on('update-downloaded', async (i) => {
    setUpdater('ready', `Version ${i.version} is ready to install.`);
    const response = await showDialog({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Multi Discord ${i.version} is ready`,
      detail: 'Restart to finish updating. It will also install the next time you close the app.',
    });
    if (response === 0) gracefulShutdown(() => autoUpdater.quitAndInstall());
  });
}

function checkForUpdates() {
  if (!app.isPackaged || !autoUpdater) {
    setUpdater('idle', 'Updates only work in the installed app, not when running from source.');
    return;
  }
  if (!settings.updateUrl) {
    setUpdater('error', 'Add an update address first.');
    return;
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: settings.updateUrl });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (e) {
    setUpdater('error', `Update check failed: ${String(e.message || e).slice(0, 160)}`);
  }
}

// ---------- settings window ----------
function openSettings(tab, accountId) {
  const t = ['account', 'updates'].includes(tab) ? tab : 'appearance';
  const query = { tab: t, account: accountId || activeId || '' };
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.loadFile(path.join(__dirname, 'settings.html'), { query });
    focusWindow(settingsWin);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: 'Multi Discord settings',
    backgroundColor: themeBg(),
    icon: ICON_PATH,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayFor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });
  settingsWin.on('closed', () => { settingsWin = null; });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'), { query });
}

// ---------- menu / shortcuts ----------
function currentId() {
  for (const [id, p] of popouts) if (!p.win.isDestroyed() && p.win.isFocused()) return id;
  if (splitId && views.get(splitId)?.webContents.isFocused()) return splitId;
  return activeId;
}

function zoom(delta) {
  const id = currentId();
  const a = acct(id);
  if (!a) return;
  a.zoom = delta === 0 ? 1 : Math.min(2, Math.max(0.5, Math.round((a.zoom + delta) * 100) / 100));
  applyAccount(id);
  changed();
}

function menuTemplates() {
  return {
    accounts: [
      ...accounts.slice(0, 9).map((a, i) => ({
        label: a.name,
        accelerator: `CmdOrCtrl+${i + 1}`,
        click: () => activate(a.id),
      })),
      { type: 'separator' },
      {
        label: 'Show beside current account',
        submenu: accounts
          .filter((a) => a.id !== activeId && !popouts.has(a.id))
          .map((a) => ({ label: a.name, click: () => openSplit(a.id) })),
      },
      { label: 'Close split view', enabled: !!splitId, click: closeSplit },
      { type: 'separator' },
      { label: 'Notification center', accelerator: 'CmdOrCtrl+Shift+N', click: () => setNotifOpen(!notifOpen) },
      { label: 'Collapse or expand sidebar', accelerator: 'CmdOrCtrl+B', click: () => updateSettings({ collapsed: !settings.collapsed }) },
      {
        label: 'Do Not Disturb',
        type: 'checkbox',
        checked: settings.dnd,
        accelerator: 'CmdOrCtrl+Shift+D',
        click: () => updateSettings({ dnd: !settings.dnd }),
      },
      { type: 'separator' },
      {
        label: popouts.has(currentId()) ? 'Dock current account back' : 'Pop out current account',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => togglePopOut(currentId()),
      },
      {
        label: 'Reload current account',
        accelerator: 'CmdOrCtrl+R',
        click: () => views.get(currentId())?.webContents.reload(),
      },
      {
        label: 'Developer tools',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => views.get(currentId())?.webContents.toggleDevTools(),
      },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings('appearance') },
      { label: 'Check for updates…', click: () => { openSettings('updates'); checkForUpdates(); } },
    ],
    view: [
      { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.1) },
      { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.1) },
      { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
    ],
  };
}

// macOS keeps its native menu bar. Windows and Linux use the themed title bar menus.
function buildMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  const t = menuTemplates();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Accounts', submenu: t.accounts },
    { label: 'View', submenu: t.view },
  ]));
}

// Keyboard shortcuts work on every view, so they don't depend on a native menu.
function handleShortcut(event, input) {
  if (process.platform === 'darwin' || input.type !== 'keyDown' || !input.control || input.alt) return;
  const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  let fn = null;
  if (!input.shift && /^[1-9]$/.test(k)) fn = () => { const a = accounts[Number(k) - 1]; if (a) activate(a.id); };
  else if (input.shift && k === 'n') fn = () => setNotifOpen(!notifOpen);
  else if (input.shift && k === 'd') fn = () => updateSettings({ dnd: !settings.dnd });
  else if (input.shift && k === 'o') fn = () => togglePopOut(currentId());
  else if (input.shift && k === 'i') fn = () => views.get(currentId())?.webContents.toggleDevTools();
  else if (!input.shift && k === 'b') fn = () => updateSettings({ collapsed: !settings.collapsed });
  else if (!input.shift && k === 'r') fn = () => views.get(currentId())?.webContents.reload();
  else if (!input.shift && k === ',') fn = () => openSettings('appearance');
  else if (k === '=' || k === '+') fn = () => zoom(0.1);
  else if (!input.shift && k === '-') fn = () => zoom(-0.1);
  else if (!input.shift && k === '0') fn = () => zoom(0);
  if (fn) { event.preventDefault(); fn(); }
}
function hookShortcuts(wc) { wc.on('before-input-event', handleShortcut); }

// ---------- themed menus and dialogs (drawn by overlay.html) ----------
const accelLabel = (a) => (a ? String(a).replace(/CmdOrCtrl/g, process.platform === 'darwin' ? 'Cmd' : 'Ctrl') : '');

function serializeMenu(items) {
  return items.filter(Boolean).map((it) => {
    if (it.type === 'separator') return { type: 'separator' };
    const id = String(++menuSeq);
    const out = {
      id,
      label: it.label || '',
      type: it.type || 'normal',
      checked: !!it.checked,
      enabled: it.enabled !== false && !(it.submenu && it.submenu.length === 0),
      accel: accelLabel(it.accelerator),
    };
    if (it.submenu) out.submenu = serializeMenu(it.submenu);
    if (it.click) overlayActions.set(id, it.click);
    return out;
  });
}

function openOverlay() {
  overlayOpen = true;
  overlayView.setVisible(true);
  win.contentView.addChildView(overlayView); // bring to front
  layout();
  overlayView.webContents.focus();
}

function closeOverlay() {
  if (!overlayOpen) return;
  overlayOpen = false;
  overlayActions.clear();
  overlayView.setVisible(false);
  overlayView.webContents.send('overlay-clear');
  if (overlayDialogResolve) {
    const r = overlayDialogResolve;
    overlayDialogResolve = null;
    r(overlayDialogCancel);
  }
  const wc = views.get(activeId)?.webContents;
  if (wc && !popouts.has(activeId) && !notifOpen) wc.focus();
}

function showMenu(items, pos) {
  if (!win) return;
  closeOverlay();
  let x; let y;
  if (pos) { x = pos.x; y = pos.y; } else {
    const pt = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    x = pt.x - b.x;
    y = pt.y - b.y;
  }
  overlayView.webContents.send('overlay-menu', { items: serializeMenu(items), x, y });
  openOverlay();
}

function showDialog(opts) {
  return new Promise((resolve) => {
    if (!win) { resolve(-1); return; }
    closeOverlay();
    const buttons = opts.buttons && opts.buttons.length ? opts.buttons : ['OK'];
    overlayDialogResolve = resolve;
    overlayDialogCancel = Number.isInteger(opts.cancelId) ? opts.cancelId : buttons.length - 1;
    overlayView.webContents.send('overlay-dialog', {
      message: opts.message || '',
      detail: opts.detail || '',
      buttons,
      defaultId: Number.isInteger(opts.defaultId) ? opts.defaultId : 0,
      cancelId: overlayDialogCancel,
      danger: opts.type === 'warning',
    });
    openOverlay();
  });
}

// ---------- IPC ----------
ipcMain.on('overlay-pick', (_e, id) => {
  const fn = overlayActions.get(String(id));
  closeOverlay();
  if (fn) setTimeout(fn, 0);
});
ipcMain.on('overlay-close', () => closeOverlay());
ipcMain.on('dialog-result', (_e, index) => {
  const r = overlayDialogResolve;
  overlayDialogResolve = null;
  closeOverlay();
  if (r) r(Number.isInteger(index) ? index : overlayDialogCancel);
});
ipcMain.on('app-menu', (_e, name, rect) => {
  const t = menuTemplates();
  if (!t[name] || !rect) return;
  showMenu(t[name], { x: Number(rect.left) || 0, y: (Number(rect.bottom) || TITLE_H) + 2 });
});

function windowForSender(sender) {
  if (titlebar && sender.id === titlebar.webContents.id) return win;
  for (const p of popouts.values()) if (p.bar.webContents.id === sender.id) return p.win;
  return null;
}
let dragTimer = null;
ipcMain.on('win-drag-start', (e) => {
  const w = windowForSender(e.sender);
  if (!w || w.isMaximized() || w.isFullScreen()) return;
  clearInterval(dragTimer);
  const c0 = screen.getCursorScreenPoint();
  const b0 = w.getBounds();
  const t0 = Date.now();
  dragTimer = setInterval(() => {
    if (w.isDestroyed() || Date.now() - t0 > 30000) { clearInterval(dragTimer); return; }
    const c = screen.getCursorScreenPoint();
    w.setBounds({ x: b0.x + c.x - c0.x, y: b0.y + c.y - c0.y, width: b0.width, height: b0.height });
  }, 8);
});
ipcMain.on('win-drag-end', () => clearInterval(dragTimer));
ipcMain.on('win-toggle-max', (e) => {
  const w = windowForSender(e.sender);
  if (w) { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
});

ipcMain.handle('get-state', () => getState());
ipcMain.on('switch', (_e, id) => activate(id));

ipcMain.on('add', (_e, name) => {
  const a = normalizeAccount({
    id: crypto.randomUUID(),
    name: String(name || '').trim().slice(0, 24) || `Account ${accounts.length + 1}`,
  });
  accounts.push(a);
  createView(a);
  activate(a.id);
});

ipcMain.on('reorder', (_e, fromId, toId, after) => {
  const from = accounts.findIndex((a) => a.id === fromId);
  if (from < 0 || fromId === toId) return;
  const [item] = accounts.splice(from, 1);
  const to = accounts.findIndex((a) => a.id === toId);
  if (to < 0) { accounts.splice(from, 0, item); return; }
  accounts.splice(after ? to + 1 : to, 0, item);
  item.groupId = accounts.find((a) => a.id === toId)?.groupId || null;
  changed();
});

// Dropped outside any valid target: pop the account out if the cursor left the window.
ipcMain.on('drag-end', (_e, id) => {
  if (!win || !acct(id)) return;
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const inside = pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
  if (!inside) popOut(id, pt);
});

ipcMain.on('update-account', (_e, id, patch) => {
  if (typeof id === 'string' && patch && typeof patch === 'object') updateAccount(id, patch);
});

ipcMain.on('update-settings', (_e, patch) => {
  if (patch && typeof patch === 'object') updateSettings(patch);
});

ipcMain.on('open-settings', (_e, tab, id) => openSettings(tab, id));
ipcMain.on('check-updates', () => checkForUpdates());

ipcMain.on('toggle-notifs', () => setNotifOpen(!notifOpen));
ipcMain.on('close-notifs', () => setNotifOpen(false));
ipcMain.on('notif-read-all', () => { notifications.forEach((n) => { n.read = true; }); saveNotifs(); pushState(); });
ipcMain.on('notif-clear', () => { notifications = []; saveNotifs(); pushState(); });
ipcMain.on('notif-click', (_e, id) => {
  const n = notifications.find((x) => x.id === id);
  if (!n) return;
  n.read = true;
  saveNotifs();
  setNotifOpen(false);
  if (acct(n.accountId)) {
    if (!popouts.has(n.accountId)) focusWindow(win);
    activate(n.accountId);
  }
});

ipcMain.on('md-notify', (e, data) => {
  const id = accountIdForSender(e.sender);
  if (id && data) addNotification(id, data.title, data.body);
});
ipcMain.on('md-notify-click', (e) => {
  const id = accountIdForSender(e.sender);
  if (!id) return;
  if (!popouts.has(id)) focusWindow(win);
  activate(id);
});

ipcMain.on('pop-toggle-top', (e) => {
  const [, p] = popoutForSender(e.sender);
  if (!p) return;
  p.onTop = !p.onTop;
  p.win.setAlwaysOnTop(p.onTop, 'floating');
  pushState();
});
ipcMain.on('pop-dock', (e) => {
  const [, p] = popoutForSender(e.sender);
  if (p) p.win.close();
});

ipcMain.on('split-open', (_e, id) => openSplit(id));
ipcMain.on('split-drag', (_e, screenX) => {
  if (!win || !splitShown()) return;
  const b = win.getContentBounds();
  const sw = sidebarWidth();
  const area = b.width - sw;
  const ratio = (Number(screenX) - b.x - sw - DIVIDER_W / 2) / (area - DIVIDER_W);
  if (!Number.isFinite(ratio)) return;
  settings.splitRatio = Math.min(0.85, Math.max(0.15, ratio));
  layout();
});
ipcMain.on('split-drag-end', () => changed());
ipcMain.on('split-reset', () => { settings.splitRatio = 0.5; layout(); changed(); });
ipcMain.on('split-menu', () => {
  showMenu([
    { label: 'Equal width', click: () => { settings.splitRatio = 0.5; layout(); changed(); } },
    { label: 'Swap sides', click: swapSplit },
    { type: 'separator' },
    { label: 'Close split view', click: closeSplit },
  ]);
});

ipcMain.on('group-add', (_e, name, accountId) => createGroup(name, accountId));
ipcMain.on('set-group', (_e, accountId, groupId) => setGroup(accountId, groupId));
ipcMain.on('group-update', (_e, id, patch) => {
  const g = group(id);
  if (!g || !patch || typeof patch !== 'object') return;
  if ('name' in patch) {
    const n = String(patch.name || '').trim().slice(0, 24);
    if (n) g.name = n;
  }
  if ('collapsed' in patch) g.collapsed = !!patch.collapsed;
  changed();
});
ipcMain.on('group-menu', (_e, id) => {
  const g = group(id);
  if (!g) return;
  const i = groups.indexOf(g);
  const move = (d) => { groups.splice(i, 1); groups.splice(i + d, 0, g); changed(); };
  showMenu([
    {
      label: 'Rename',
      enabled: !settings.compact && !settings.collapsed,
      click: () => sidebar.webContents.send('start-group-rename', id),
    },
    { label: g.collapsed ? 'Expand' : 'Collapse', click: () => { g.collapsed = !g.collapsed; changed(); } },
    { label: 'Move up', enabled: i > 0, click: () => move(-1) },
    { label: 'Move down', enabled: i < groups.length - 1, click: () => move(1) },
    { type: 'separator' },
    {
      label: 'Delete group',
      click: () => {
        accounts.forEach((a) => { if (a.groupId === id) a.groupId = null; });
        groups = groups.filter((x) => x.id !== id);
        changed();
      },
    },
  ]);
});

ipcMain.handle('set-proxy', async (_e, id, data) => {
  const a = acct(id);
  if (!a) return { ok: false, message: 'Account not found.' };
  if (!data || data.type === 'none') {
    a.proxy = null;
    await applyProxy(id, { reload: true });
    changed();
    return { ok: true, message: 'Proxy turned off. The account is reloading.' };
  }
  const type = PROXY_TYPES.includes(data.type) ? data.type : 'http';
  const host = String(data.host || '').trim();
  const port = parseInt(data.port, 10);
  const username = String(data.username || '').trim().slice(0, 128);
  if (!/^[A-Za-z0-9._\-\[\]:]{1,253}$/.test(host) || !(port >= 1 && port <= 65535)) {
    return { ok: false, message: 'Enter a valid host and a port from 1 to 65535.' };
  }
  if ((type === 'socks4' || type === 'socks5') && username) {
    return { ok: false, message: "SOCKS proxies can't use a username and password here. Use an HTTP proxy, or a VPN app." };
  }
  let passwordEnc = a.proxy ? a.proxy.passwordEnc : '';
  if (data.clearPassword) passwordEnc = '';
  if (data.password) {
    const enc = encryptPw(String(data.password).slice(0, 256));
    if (!enc) return { ok: false, message: "This computer can't store a password securely, so it wasn't saved." };
    passwordEnc = enc;
  }
  if (!username) passwordEnc = '';
  a.proxy = { type, host, port, username, passwordEnc };
  await applyProxy(id, { reload: true });
  changed();
  return { ok: true, message: 'Proxy saved. The account is reloading.' };
});

ipcMain.handle('test-proxy', async (_e, id) => {
  const wc = views.get(id)?.webContents;
  if (!wc) return { ok: false, message: 'Account not found.' };
  const t0 = Date.now();
  try {
    const r = await wc.session.fetch('https://discord.com/api/v9/gateway', { signal: AbortSignal.timeout(10000) });
    const how = acct(id)?.proxy ? 'through the proxy' : 'directly (no proxy set)';
    return r.ok
      ? { ok: true, message: `Reached Discord ${how} in ${Date.now() - t0} ms.` }
      : { ok: false, message: `Discord answered with status ${r.status}.` };
  } catch (e) {
    return { ok: false, message: `Couldn't connect: ${String((e && e.message) || e).slice(0, 120)}` };
  }
});

ipcMain.handle('pick-icon', async (_e, id) => {
  const a = acct(id);
  if (!a) return 'error';
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWin || win, {
    title: 'Choose an icon image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }],
  });
  if (canceled || !filePaths[0]) return 'cancel';
  let img = nativeImage.createFromPath(filePaths[0]);
  if (img.isEmpty()) return 'error';
  const { width, height } = img.getSize();
  const s = Math.min(width, height);
  img = img
    .crop({ x: Math.floor((width - s) / 2), y: Math.floor((height - s) / 2), width: s, height: s })
    .resize({ width: 64, height: 64, quality: 'best' });
  a.icon = { type: 'image', value: img.toDataURL() };
  changed();
  return 'ok';
});

ipcMain.on('menu', (_e, id) => {
  const a = acct(id);
  if (!a) return;
  const p = popouts.get(id);
  showMenu([
    { label: 'Rename', click: () => sidebar.webContents.send('start-rename', id) },
    { label: 'Account settings…', click: () => openSettings('account', id) },
    {
      label: 'Mute notifications',
      type: 'checkbox',
      checked: a.muteNotifications,
      click: () => updateAccount(id, { muteNotifications: !a.muteNotifications }),
    },
    {
      label: 'Move to group',
      submenu: [
        { label: 'No group', type: 'radio', checked: !a.groupId, click: () => setGroup(id, null) },
        ...groups.map((g) => ({ label: g.name, type: 'radio', checked: a.groupId === g.id, click: () => setGroup(id, g.id) })),
        { type: 'separator' },
        {
          label: 'New group…',
          click: () => (settings.compact || settings.collapsed
            ? createGroup('', id)
            : sidebar.webContents.send('start-new-group', id)),
        },
      ],
    },
    ...(splitId === id
      ? [{ label: 'Close split view', click: closeSplit }]
      : (id !== activeId && !p ? [{ label: 'Show beside current account', click: () => openSplit(id) }] : [])),
    { type: 'separator' },
    ...(p
      ? [
        { label: 'Show window', click: () => focusWindow(p.win) },
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: p.onTop,
          click: () => { p.onTop = !p.onTop; p.win.setAlwaysOnTop(p.onTop, 'floating'); pushState(); },
        },
        { label: 'Dock back into main window', click: () => p.win.close() },
      ]
      : [{ label: 'Pop out into its own window', click: () => popOut(id) }]),
    { label: 'Reload', click: () => views.get(id)?.webContents.reload() },
    { type: 'separator' },
    { label: 'Remove…', click: () => removeAccount(id) },
  ]);
});

// ---------- app lifecycle ----------
if (process.platform === 'win32') app.setAppUserModelId('com.local.multidiscord');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (!shuttingDown) focusWindow(win); });
  app.on('before-quit', () => { quitting = true; });

  app.whenReady().then(() => {
    loadStore();

    win = new BaseWindow({
      ...initialBounds(),
      minWidth: 900,
      minHeight: 600,
      title: 'Multi Discord',
      backgroundColor: themeBg(),
      icon: ICON_PATH,
      titleBarStyle: 'hidden',
      titleBarOverlay: overlayFor(),
    });

    const plainView = () => new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    titlebar = plainView();
    titlebar.webContents.on('will-navigate', (e) => e.preventDefault());
    win.contentView.addChildView(titlebar);
    titlebar.webContents.loadFile(path.join(__dirname, 'titlebar.html'));

    sidebar = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    sidebar.webContents.on('will-navigate', (e) => e.preventDefault());
    win.contentView.addChildView(sidebar);
    sidebar.webContents.loadFile(path.join(__dirname, 'sidebar.html'));

    notifView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    notifView.webContents.on('will-navigate', (e) => e.preventDefault());
    notifView.webContents.loadFile(path.join(__dirname, 'notifications.html'));
    notifView.setVisible(false);

    divider = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    divider.webContents.on('will-navigate', (e) => e.preventDefault());
    divider.webContents.loadFile(path.join(__dirname, 'divider.html'));
    divider.setVisible(false);

    accounts.forEach(createView);
    win.contentView.addChildView(divider);
    win.contentView.addChildView(notifView);

    overlayView = plainView();
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.on('will-navigate', (e) => e.preventDefault());
    overlayView.webContents.loadFile(path.join(__dirname, 'overlay.html'));
    overlayView.setVisible(false);
    win.contentView.addChildView(overlayView);
    [titlebar, sidebar, divider, notifView].forEach((v) => hookShortcuts(v.webContents));
    if (windowState && windowState.maximized) win.maximize();

    win.on('resize', () => { layout(); scheduleWindowState(); });
    win.on('move', scheduleWindowState);
    win.on('maximize', scheduleWindowState);
    win.on('unmaximize', scheduleWindowState);
    win.on('close', (e) => { if (!shuttingDown) { e.preventDefault(); gracefulShutdown(); } });
    setInterval(flushAll, 15000);
    win.on('enter-full-screen', layout);
    win.on('leave-full-screen', layout);
    win.on('closed', () => {
      win = null;
      quitting = true;
      for (const p of popouts.values()) { p.docked = true; if (!p.win.isDestroyed()) p.win.destroy(); }
      if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy();
      app.quit();
    });

    applyWindowSettings();
    activate(activeId);
    setupUpdater();
    if (settings.autoUpdate && settings.updateUrl) setTimeout(checkForUpdates, 8000);
  });

  app.on('window-all-closed', () => app.quit());
}
