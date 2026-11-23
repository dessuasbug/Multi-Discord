const { contextBridge, ipcRenderer } = require('electron');
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onStartRename: (cb) => ipcRenderer.on('start-rename', (_e, id) => cb(id)),
  switchTo: (id) => send('switch', id),
  add: (name) => send('add', name),
  menu: (id) => send('menu', id),
  reorder: (fromId, toId, after) => send('reorder', fromId, toId, after),
  dragEnd: (id) => send('drag-end', id),
  updateAccount: (id, patch) => send('update-account', id, patch),
  updateSettings: (patch) => send('update-settings', patch),
  pickIcon: (id) => ipcRenderer.invoke('pick-icon', id),
  openSettings: (tab, id) => send('open-settings', tab, id),
  toggleNotifs: () => send('toggle-notifs'),
  closeNotifs: () => send('close-notifs'),
  notifClick: (id) => send('notif-click', id),
  notifReadAll: () => send('notif-read-all'),
  notifClear: () => send('notif-clear'),
  popToggleTop: () => send('pop-toggle-top'),
  popDock: () => send('pop-dock'),
  checkUpdates: () => send('check-updates'),
});
