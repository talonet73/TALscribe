// Test harness: loads the app, runs a script in the renderer, saves screenshots.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
require(process.env.APP_MAIN);
const steps = JSON.parse(fs.readFileSync(process.env.STEPS, 'utf8'));
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('console-message', (e) => console.log('[renderer]', e.message || ''));
  for (const s of steps) {
    if (s.js) { try { const r = await win.webContents.executeJavaScript(s.js); if (r !== undefined) console.log('js>', JSON.stringify(r).slice(0, 2000)); } catch (e) { console.log('js err', e.message); } }
    await new Promise((r) => setTimeout(r, s.wait || 800));
    if (s.shot) { const img = await win.webContents.capturePage(); fs.writeFileSync(s.shot, img.toPNG()); console.log('shot', s.shot); }
  }
  app.exit(0);
});
