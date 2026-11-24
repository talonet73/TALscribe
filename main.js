'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { download, findFile, extractZip, isWin } = require('./lib/util');
const hardware = require('./lib/hardware');
const models = require('./lib/models');
const ollama = require('./lib/ollama');
const { Job } = require('./lib/transcribe');
const formats = require('./lib/formats');

const APP_VERSION = require('./package.json').version;
const CUDA_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

app.setName('TALscribe');
if (isWin) app.setAppUserModelId('com.tal.talscribe');

// ---------- paths, log, settings ----------
const userDir = app.getPath('userData'); // %APPDATA%\TALscribe
const dataDir = process.env.TALSCRIBE_DATA ||
  (isWin ? path.join(process.env.LOCALAPPDATA || userDir, 'TALscribe') : path.join(os.homedir(), '.local', 'share', 'TALscribe'));
const modelsDir = path.join(dataDir, 'models');
const historyDir = path.join(dataDir, 'history');
const toolsDir = path.join(dataDir, 'tools');
const cudaDir = path.join(dataDir, 'engine-cuda');
for (const d of [userDir, dataDir, modelsDir, historyDir, toolsDir]) fs.mkdirSync(d, { recursive: true });

const logFile = path.join(userDir, 'talscribe-log.txt');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch {}
}
try { if (fs.statSync(logFile).size > 2e6) fs.unlinkSync(logFile); } catch {}
log('=== avvio TALscribe', APP_VERSION, process.platform, process.versions.electron);
process.on('uncaughtException', (e) => { log('ERRORE', e.stack || String(e)); });

const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : (process.env.TALSCRIBE_BIN || path.join(__dirname, 'bin'));
const exe = (n) => (isWin ? n + '.exe' : n);

const settingsFile = path.join(dataDir, 'settings.json');
let settings = { language: 'auto', mode: 'speech', quality: 'balanced', modelId: null, useGpu: true, ollamaModel: null, onboarded: false };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}
const saveSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 1));

let hwCache = null;

function bins() {
  const local = (n) => { const p = path.join(binDir, exe(n)); return fs.existsSync(p) ? p : null; };
  // yt-dlp lives in the data folder so it can update itself
  let ytdlp = path.join(toolsDir, exe('yt-dlp'));
  if (!fs.existsSync(ytdlp)) {
    const b = local('yt-dlp');
    if (b) { try { fs.copyFileSync(b, ytdlp); } catch { ytdlp = b; } } else ytdlp = 'yt-dlp';
  }
  const whisperCpu = findFile(path.join(binDir, 'whisper'), exe('whisper-cli')) || exe('whisper-cli');
  const whisperGpu = settings.useGpu ? findFile(cudaDir, exe('whisper-cli')) : null;
  return { ffmpeg: local('ffmpeg') || 'ffmpeg', ytdlp, whisperCpu, whisperGpu };
}

// ---------- window ----------
let win;
function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', isWin ? 'icon.ico' : 'logo-256.png'));
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    backgroundColor: '#000000', icon, show: false,
    title: 'TALscribe',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#b3b3b3', height: 38 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, d) => log('renderer gone', d));
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

app.whenReady().then(() => {
  createWindow();
  log('finestra creata, percorso app:', app.getAppPath());
}).catch((e) => {
  log('avvio fallito', e.stack);
  dialog.showErrorBox('TALscribe', 'Avvio non riuscito: ' + e.message + '\nRegistro: ' + logFile);
});
app.on('window-all-closed', () => app.quit());

// ---------- IPC: app ----------
ipcMain.handle('app:info', () => (log('interfaccia collegata'), {
  version: APP_VERSION, dataDir, logFile, platform: process.platform, settings,
  binsOk: { ffmpeg: fs.existsSync(path.join(binDir, exe('ffmpeg'))), ytdlp: true, whisper: !!findFile(path.join(binDir, 'whisper'), exe('whisper-cli')) },
}));
ipcMain.handle('app:setSettings', (_e, s) => { settings = { ...settings, ...s }; saveSettings(); return settings; });
ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.handle('app:openPath', (_e, which) => shell.openPath(which === 'models' ? modelsDir : which === 'log' ? logFile : dataDir));
ipcMain.handle('app:pickFile', async (e) => {
  const opts = {
    title: 'Scegli un file audio o video', properties: ['openFile'],
    defaultPath: app.getPath('music'),
    filters: [{ name: 'Audio e video', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'amr', 'webm', 'mp4', 'mkv', 'mov', 'avi', 'm4v', '3gp'] }, { name: 'Tutti i file', extensions: ['*'] }],
  };
  const parent = BrowserWindow.fromWebContents(e.sender) || win;
  log('sfoglia: apro la finestra di scelta file');
  try {
    let r;
    try { r = await dialog.showOpenDialog(parent, opts); }
    catch (err) { log('sfoglia: finestra legata non riuscita, riprovo', err.message); r = await dialog.showOpenDialog(opts); }
    log('sfoglia:', r.canceled ? 'annullato' : r.filePaths[0]);
    return r.canceled ? null : r.filePaths[0];
  } catch (err) {
    log('sfoglia: errore', err.stack || err.message);
    throw new Error('Non riesco ad aprire la finestra di scelta file: ' + err.message);
  }
});

// ---------- IPC: hardware & models ----------
ipcMain.handle('hw:scan', async (_e, force) => {
  if (!hwCache || force) { hwCache = await hardware.scan(dataDir); log('hw', hwCache); }
  return { hw: hwCache, rec: models.recommend(hwCache), llm: ollama.recommendLLM(hwCache) };
});

function modelState() {
  const inst = models.installed(modelsDir);
  if (settings.modelId && !inst.includes(settings.modelId)) settings.modelId = inst[0] || null;
  if (!settings.modelId && inst.length) settings.modelId = inst[inst.length - 1];
  return {
    catalog: models.MODELS, installed: inst, active: settings.modelId,
    cuda: { installed: !!findFile(cudaDir, exe('whisper-cli')), enabled: settings.useGpu, supported: isWin },
  };
}
ipcMain.handle('models:state', () => modelState());

const downloads = new Map();
ipcMain.handle('models:download', async (_e, id) => {
  const m = models.byId(id);
  if (!m) throw new Error('Modello sconosciuto');
  const ctl = new AbortController();
  downloads.set(id, ctl);
  const dest = path.join(modelsDir, models.fileOf(id));
  try {
    await download(models.urlOf(id), dest, { signal: ctl.signal, onProgress: (p) => send('models:progress', { id, ...p }) });
    if (!models.isValidModel(dest)) { fs.unlinkSync(dest); throw new Error('Il file scaricato non è un modello valido'); }
    settings.modelId = id; saveSettings();
    log('modello scaricato', id);
    return modelState();
  } catch (e) {
    log('download modello fallito', id, e.message);
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(e.code || e.message)) throw new Error('Non riesco a raggiungere huggingface.co: controlla la connessione e riprova.');
    throw e;
  } finally { downloads.delete(id); }
});
ipcMain.handle('models:cancel', (_e, id) => { const c = downloads.get(id); if (c) c.abort(); });
ipcMain.handle('models:delete', (_e, id) => {
  try { fs.unlinkSync(path.join(modelsDir, models.fileOf(id))); } catch {}
  if (settings.modelId === id) settings.modelId = null;
  const st = modelState(); saveSettings(); return st;
});
ipcMain.handle('models:select', (_e, id) => { settings.modelId = id; saveSettings(); return modelState(); });

ipcMain.handle('engine:installCuda', async () => {
  const ctl = new AbortController();
  downloads.set('cuda', ctl);
  const zip = path.join(dataDir, 'cuda-pack.zip');
  try {
    await download(CUDA_URL, zip, { signal: ctl.signal, onProgress: (p) => send('models:progress', { id: 'cuda', ...p }) });
    send('models:progress', { id: 'cuda', pct: 100, extracting: true });
    fs.rmSync(cudaDir, { recursive: true, force: true });
    await extractZip(zip, cudaDir);
    fs.unlinkSync(zip);
    settings.useGpu = true; saveSettings();
    return modelState();
  } finally { downloads.delete('cuda'); }
});
ipcMain.handle('engine:removeCuda', () => { fs.rmSync(cudaDir, { recursive: true, force: true }); return modelState(); });

// ---------- IPC: transcription ----------
let current = null;
ipcMain.handle('job:start', async (_e, opts) => {
  if (current) throw new Error('C’è già una trascrizione in corso');
  if (!opts.modelId || !models.installed(modelsDir).includes(opts.modelId)) throw new Error('Scarica prima un modello dalla sezione Motore AI');
  const hw = hwCache || (hwCache = await hardware.scan(dataDir));
  const threads = Math.max(2, Math.min(16, hw.cpu.physical || 4));
  const job = new Job(opts, { dataDir, bins: bins(), threads, pathEnv: [binDir, path.join(binDir, 'whisper'), toolsDir, process.env.PATH || ''].join(path.delimiter) });
  current = job;
  log('job start', { id: job.id, ...opts, threads, bins: job.env.bins });
  job.on('progress', (p) => send('job:progress', p));
  job.on('segment', (s) => send('job:segment', s));
  job.on('meta', (m) => send('job:meta', { id: m.id, title: m.title }));
  job.on('notice', (n) => { log('notice', n); send('job:notice', n); });
  job.run().then((meta) => {
    log('job done', job.id, meta.segments.length + ' segmenti');
    send('job:done', decorate(meta));
  }).catch((e) => {
    log('job error', job.id, e.message, e.tail || '');
    let msg = e.message;
    if (opts.source === 'youtube' && /yt-dlp/.test(msg)) msg = 'Download da YouTube non riuscito. Controlla il link, oppure aggiorna il downloader da Impostazioni.';
    send('job:error', { id: job.id, message: msg, cancelled: job.cancelled, detail: (e.tail || '').slice(-1500) });
    if (job.cancelled) fs.rmSync(job.dir, { recursive: true, force: true });
  }).finally(() => { current = null; });
  return { id: job.id };
});
ipcMain.handle('job:cancel', () => { if (current) current.cancel(); });

function decorate(meta) {
  let audioUrl = null;
  const abs = meta.audio ? path.join(dataDir, meta.audio) : meta.originalPath;
  if (abs && fs.existsSync(abs)) audioUrl = require('url').pathToFileURL(abs).toString();
  return { ...meta, audioUrl };
}
function readMeta(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('id non valido');
  return JSON.parse(fs.readFileSync(path.join(historyDir, id, 'meta.json'), 'utf8'));
}

ipcMain.handle('history:list', () => {
  const out = [];
  for (const id of fs.readdirSync(historyDir)) {
    try {
      const m = readMeta(id);
      out.push({ id, title: m.title, createdAt: m.createdAt, mode: m.mode, source: m.source, duration: m.duration, model: m.model, preview: (m.segments || []).slice(0, 3).map((s) => s.text).join(' ').slice(0, 140) });
    } catch {}
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
});
ipcMain.handle('history:get', (_e, id) => decorate(readMeta(id)));
ipcMain.handle('history:delete', (_e, id) => { if (/^[\w-]+$/.test(id)) fs.rmSync(path.join(historyDir, id), { recursive: true, force: true }); return true; });
ipcMain.handle('history:saveRefined', (_e, { id, task, text, model }) => {
  const m = readMeta(id);
  m.refined = { ...(m.refined || {}), [task]: { text, model, at: new Date().toISOString() } };
  fs.writeFileSync(path.join(historyDir, id, 'meta.json'), JSON.stringify(m, null, 1));
  return true;
});
ipcMain.handle('history:rename', (_e, { id, title }) => {
  const m = readMeta(id); m.title = String(title).slice(0, 200);
  fs.writeFileSync(path.join(historyDir, id, 'meta.json'), JSON.stringify(m, null, 1));
  return true;
});

ipcMain.handle('export:build', (_e, { id, format, withTimes }) => {
  const m = readMeta(id);
  const s = m.segments || [];
  switch (format) {
    case 'srt': return formats.toSrt(s);
    case 'vtt': return formats.toVtt(s);
    case 'lrc': return formats.toLrc(s, m.title);
    default: return formats.toText(s, m.mode, withTimes);
  }
});
ipcMain.handle('export:save', async (_e, { name, ext, content }) => {
  const safe = String(name || 'trascrizione').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'trascrizione';
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${safe}.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, (ext === 'txt' ? '﻿' : '') + content, 'utf8');
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

// ---------- IPC: yt-dlp update ----------
ipcMain.handle('ytdlp:update', async () => {
  if (!isWin) return { ok: false, message: 'Aggiornamento automatico disponibile solo su Windows' };
  const dest = path.join(toolsDir, 'yt-dlp.exe');
  await download(YTDLP_URL, dest + '.new', { onProgress: (p) => send('models:progress', { id: 'ytdlp', ...p }) });
  fs.renameSync(dest + '.new', dest);
  return { ok: true, message: 'Downloader YouTube aggiornato all’ultima versione' };
});

// ---------- IPC: Ollama ----------
let llmCtl = null;
ipcMain.handle('ollama:status', () => ollama.status());
ipcMain.handle('ollama:pull', async (_e, name) => {
  llmCtl = new AbortController();
  try { await ollama.pull(name, (p) => send('ollama:progress', { name, ...p }), llmCtl.signal); settings.ollamaModel = name; saveSettings(); return ollama.status(); }
  finally { llmCtl = null; }
});
ipcMain.handle('ollama:refine', async (_e, { id, model, task }) => {
  const m = readMeta(id);
  const text = formats.toText(m.segments || [], m.mode);
  llmCtl = new AbortController();
  let full = '';
  try {
    await ollama.refine({ model, task, text, language: m.detectedLanguage }, (c) => { full += c; send('ollama:chunk', { id, task, chunk: c }); }, llmCtl.signal);
    m.refined = { ...(m.refined || {}), [task]: { text: full, model, at: new Date().toISOString() } };
    fs.writeFileSync(path.join(historyDir, id, 'meta.json'), JSON.stringify(m, null, 1));
    settings.ollamaModel = model; saveSettings();
    return full;
  } finally { llmCtl = null; }
});
ipcMain.handle('ollama:cancel', () => { if (llmCtl) llmCtl.abort(); });
