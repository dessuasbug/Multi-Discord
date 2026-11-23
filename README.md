# Multi Discord

One window, as many Discord accounts as you like. Each account runs the official
Discord web app in its own isolated session (separate cookies and storage), so
logins never mix and survive restarts. No tokens, no API calls, no self-botting.

## Run from source
1. Install Node.js (LTS) from https://nodejs.org
2. In this folder:  npm install
3. Start it:        npm start

## Make the Windows installer
Double-click **Build-Installer.bat**. It installs what it needs and puts
`Multi-Discord-Setup-<version>.exe` in the `dist` folder. (Or run `npm run dist`.)
If it complains about a "symbolic link", turn on Developer Mode in Windows
(Settings > Privacy and security > For developers) and run it again.

## Auto-update
Installed copies check an update address you set in Settings > Updates. The address is a
web folder that contains `latest.yml` and the installer. Easiest setup with GitHub:
1. Make a public GitHub repository and upload this project to it.
2. Push a version tag (for example `v1.2.1`) or run the **Release** workflow by hand.
   GitHub builds the installer and publishes it as a release. (Bump `version` in
   package.json first. Updates only happen when the version number goes up.)
3. In the app, open Settings > Updates and paste:
   `https://github.com/YOUR-NAME/YOUR-REPO/releases/latest/download`

Anyone with the installer can then update by clicking "Check for updates", and the app
checks by itself on startup.

## Using it
- Add account: button at the bottom of the sidebar, type a name, press Enter.
- Switch: click an account, or Ctrl+1 to Ctrl+9 (Cmd on Mac).
- Rename: pencil icon on hover, double-click, or right-click > Rename.
- Reorder: drag an account up or down the list.
- Groups: the folder button at the top of the sidebar makes a group. Click a group to collapse it
  (its mention count stays visible). Drag accounts onto a group, or onto the empty area to ungroup.
  Right-click an account > Move to group, or right-click a group to rename, move or delete it.
- Split view: Ctrl+click an account (or right-click > Show beside current account) to show two
  accounts side by side. Drag the divider to resize, double-click it for equal widths,
  right-click it to swap sides or close split view.
- Proxy: Settings > Accounts > Proxy or VPN. Per account, HTTP/HTTPS/SOCKS. Passwords are
  encrypted by Windows. Calls may not work through a proxy.
- The window remembers its size, position and maximized state.
- Pop out: drag an account out of the window, or right-click > Pop out. The pop-out has
  an Always on top button and a Dock back button.
- Collapse the sidebar: the arrow at the top of the sidebar, or Ctrl+B.
- Notification center: bell button or Ctrl+Shift+N. Click a notification to jump to its account.
- Do Not Disturb: moon button or Ctrl+Shift+D.
- Settings: gear button or Ctrl+, (themes, colors, icons, mute, zoom, custom CSS, updates).
