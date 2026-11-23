// Runs inside each Discord page before its own scripts. It wraps the web
// Notification API so notifications can be muted per account (or by Do Not
// Disturb), logged in the notification center, and clicked to jump to the account.
const { webFrame, ipcRenderer } = require('electron');

const PATCH = `(() => {
  if (window.__mdPatched) return;
  window.__mdPatched = true;
  window.__mdMuted = false;
  const N = window.Notification;
  const post = (m) => { try { window.postMessage(Object.assign({ __md: true }, m), '*'); } catch (e) {} };
  const P = function (title, options) {
    post({ type: 'notify', title: String(title == null ? '' : title), body: String((options && options.body) || '') });
    if (window.__mdMuted) return { close() {}, addEventListener() {}, removeEventListener() {} };
    const n = new N(title, options);
    n.addEventListener('click', () => post({ type: 'click' }));
    return n;
  };
  P.prototype = N.prototype;
  Object.defineProperty(P, 'permission', { get: () => N.permission });
  P.requestPermission = (...a) => N.requestPermission(...a);
  window.Notification = P;
})();`;

try { webFrame.executeJavaScript(PATCH); } catch (e) { /* ignore */ }

window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.__md !== true) return;
  if (d.type === 'notify') {
    ipcRenderer.send('md-notify', { title: String(d.title).slice(0, 200), body: String(d.body).slice(0, 500) });
  } else if (d.type === 'click') {
    ipcRenderer.send('md-notify-click');
  }
});

ipcRenderer.on('md-muted', (_e, muted) => {
  try { webFrame.executeJavaScript(`window.__mdMuted = ${muted ? 'true' : 'false'};`); } catch (e) { /* ignore */ }
});
