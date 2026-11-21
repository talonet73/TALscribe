'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');

const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Download with redirects, progress and abort. Writes to dest.part then renames. */
function download(url, dest, { onProgress, signal, redirects = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const part = dest + '.part';
    let finished = false;
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'TALscribe/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Troppi reindirizzamenti'));
        const next = new URL(res.headers.location, url).toString();
        return download(next, dest, { onProgress, signal, redirects: redirects - 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download non riuscito (HTTP ${res.statusCode})`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      let last = 0;
      const out = fs.createWriteStream(part);
      res.on('data', (chunk) => {
        done += chunk.length;
        const now = Date.now();
        if (onProgress && (now - last > 150 || done === total)) {
          last = now;
          onProgress({ done, total, pct: total ? (done / total) * 100 : 0 });
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          if (finished) return;
          finished = true;
          if (total && done < total) return reject(new Error('Download incompleto'));
          fs.renameSync(part, dest);
          resolve({ bytes: done });
        });
      });
      res.on('error', (e) => { out.destroy(); reject(e); });
    });
    req.on('error', reject);
    if (signal) {
      signal.addEventListener('abort', () => {
        finished = true;
        req.destroy(new Error('Annullato'));
        setTimeout(() => { try { fs.unlinkSync(part); } catch {} }, 300);
        reject(new Error('Annullato'));
      });
    }
  });
}

function findFile(dir, name, depth = 4) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const r = findFile(path.join(dir, e.name), name, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

/** Extract a .zip using tools that ship with Windows 10/11 (tar), falling back to PowerShell. */
async function extractZip(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (isWin) {
    let r = await run('tar.exe', ['-xf', zip, '-C', destDir], { timeout: 600000 });
    if (r.ok) return;
    r = await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`], { timeout: 900000 });
    if (!r.ok) throw new Error('Estrazione non riuscita: ' + r.stderr.slice(0, 300));
  } else {
    const r = await run('unzip', ['-o', zip, '-d', destDir], { timeout: 600000 });
    if (!r.ok) throw new Error('Estrazione non riuscita');
  }
}

function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB';
  return Math.round(n / 1024 ** 2) + ' MB';
}

module.exports = { run, download, findFile, extractZip, fmtBytes, isWin, spawn };
