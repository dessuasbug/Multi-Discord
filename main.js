const {
  app, BaseWindow, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell, dialog, nativeImage, screen,
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
  hideMenuBar: false, dnd: false, updateUrl: '', autoUpdate: true,
};

let win = null;
let sidebar = null;
let notifView = null;
let settingsWin = null;
let notifOpen = false;
let quitting = false;
let accounts = [];
let activeId = null;
let notifications = [];
let settings = { ...DEFAULT_SETTINGS };
let updater = { status: 'idle', message: '' };
const views = new Map();      // account id -> WebContentsView
const badges = new Map();     // account id -> { mentions, unread }
const cssKeys = new Map();
const popouts = new Map();    // account id -> { win, bar, onTop, docked, layout }
const notifRate = new Map();

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
  };
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
  } catch {
    accounts = [];
  }
  if (!THEMES[settings.theme]) settings.theme = DEFAULT_SETTINGS.theme;
  if (!HEX.test(settings.accent)) settings.accent = THEMES[settings.theme].accent;
  settings.updateUrl = cleanUrl(settings.updateUrl);
  if (!accounts.length) accounts = [normalizeAccount({ id: crypto.randomUUID(), name: 'Account 1' })];
  if (!accounts.some((a) => a.id === activeId)) activeId = accounts[0].id;
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
  fs.writeFileSync(storePath(), JSON.stringify({ accounts, activeId, settings }, null, 2));
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

function getState() {
  const t = THEMES[settings.theme];
  const live = notifications.filter((n) => acct(n.accountId));
  return {
    activeId,
    settings,
    updater: { ...updater, version: app.getVersion(), packaged: app.isPackaged },
    notifOpen,
    notifications: live.slice(0, 100),
    unreadNotifs: live.filter((n) => !n.read).length,
    theme: { id: settings.theme, scheme: t.scheme, vars: { ...t.vars, '--accent': settings.accent } },
    themes: Object.entries(THEMES).map(([id, th]) => ({ id, label: th.label, scheme: th.scheme, accent: th.accent, vars: th.vars })),
    accounts: accounts.map((a) => ({
      ...a,
      popped: popouts.has(a.id),
      onTop: !!popouts.get(a.id)?.onTop,
      mentions: badges.get(a.id)?.mentions || 0,
      unread: !!badges.get(a.id)?.unread,
    })),
  };
}

function pushState() {
  const s = getState();
  const targets = [sidebar, settingsWin, notifView, ...[...popouts.values()].map((p) => p.bar)];
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
    try { w.setMenuBarVisibility(!settings.hideMenuBar); } catch { /* not supported */ }
  }
  layout();
  for (const p of popouts.values()) p.layout();
  setTimeout(() => { layout(); for (const p of popouts.values()) p.layout(); }, 80);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.setBackgroundColor(bg);
}

// ---------- layout ----------
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const sw = sidebarWidth();
  sidebar.setBounds({ x: 0, y: 0, width: sw, height });
  for (const [id, v] of views) {
    if (!popouts.has(id)) v.setBounds({ x: sw, y: 0, width: Math.max(0, width - sw), height });
  }
  notifView.setBounds({ x: sw, y: 0, width: Math.min(NOTIF_WIDTH, Math.max(0, width - sw)), height });
}

const firstDocked = (exceptId) => accounts.find((a) => !popouts.has(a.id) && a.id !== exceptId);

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

  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(a.id, view);
  view.webContents.setAudioMuted(a.muteAudio);
  view.webContents.loadURL(DISCORD_URL);
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
  activeId = id;
  for (const [vid, v] of views) {
    if (!popouts.has(vid)) v.setVisible(vid === id);
  }
  layout();
  views.get(id).webContents.focus();
  changed();
}

async function removeAccount(id) {
  const a = acct(id);
  if (!a) return;
  if (accounts.length === 1) {
    dialog.showMessageBox(win, {
      type: 'info',
      message: 'You need at least one account slot.',
      detail: 'Add another account first, then remove this one.',
    });
    return;
  }
  const { response } = await dialog.showMessageBox(win, {
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
  if (activeId === id) activate(firstDocked().id);
  else changed();
}

// ---------- pop-out windows ----------
function popOut(id, at) {
  if (popouts.has(id) || !views.has(id) || !win) return;
  if (!firstDocked(id)) {
    dialog.showMessageBox(win, {
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
  try { pw.setMenuBarVisibility(!settings.hideMenuBar); } catch { /* ignore */ }
  p.layout();
  setTimeout(p.layout, 80);

  if (activeId === id) {
    const next = firstDocked(id);
    activeId = next.id;
    for (const [vid, v] of views) if (!popouts.has(vid)) v.setVisible(vid === activeId);
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
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Multi Discord ${i.version} is ready`,
      detail: 'Restart to finish updating. It will also install the next time you close the app.',
    });
    if (response === 0) { quitting = true; autoUpdater.quitAndInstall(); }
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

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'Accounts',
      submenu: [
        ...accounts.slice(0, 9).map((a, i) => ({
          label: a.name,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => activate(a.id),
        })),
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
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.1) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.1) },
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
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
  Menu.buildFromTemplate([
    { label: 'Rename', click: () => sidebar.webContents.send('start-rename', id) },
    { label: 'Account settings…', click: () => openSettings('account', id) },
    {
      label: 'Mute notifications',
      type: 'checkbox',
      checked: a.muteNotifications,
      click: () => updateAccount(id, { muteNotifications: !a.muteNotifications }),
    },
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
  ]).popup({ window: win });
});

// ---------- app lifecycle ----------
if (process.platform === 'win32') app.setAppUserModelId('com.local.multidiscord');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusWindow(win));
  app.on('before-quit', () => { quitting = true; });

  app.whenReady().then(() => {
    loadStore();

    win = new BaseWindow({
      width: 1300,
      height: 850,
      minWidth: 900,
      minHeight: 600,
      title: 'Multi Discord',
      backgroundColor: themeBg(),
      icon: ICON_PATH,
    });

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

    accounts.forEach(createView);
    win.contentView.addChildView(notifView);

    win.on('resize', layout);
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
