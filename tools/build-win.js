// Builds the portable Windows folder dist/TALscribe and zips it.
// Inputs (downloaded beforehand into ../../dl): electron-win.zip, whisper-bin-x64.zip, ffmpeg-win32-x64, yt-dlp.exe, deno.zip, vcrt dlls
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const asar = require('@electron/asar');
const ResEdit = require('resedit');

const ROOT = path.join(__dirname, '..');
const DL = path.join(ROOT, 'dl');
const OUT = path.join(ROOT, 'dist', 'TALscribe');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const sh = (c) => execSync(c, { stdio: 'inherit' });
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };

(async () => {
  fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1. Electron runtime
  sh(`unzip -q -o "${path.join(DL, 'electron-win.zip')}" -d "${OUT}"`);
  fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'TALscribe.exe'));
  fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

  // 2. App code -> app.asar
  const stage = path.join(ROOT, 'dist', 'app-stage');
  for (const f of ['main.js', 'preload.js', 'package.json']) cp(path.join(ROOT, f), path.join(stage, f));
  for (const d of ['lib', 'ui', 'assets']) fs.cpSync(path.join(ROOT, d), path.join(stage, d), { recursive: true });
  fs.rmSync(path.join(stage, 'assets', 'logo-1024.png'), { force: true });
  await asar.createPackage(stage, path.join(OUT, 'resources', 'app.asar'));
  fs.rmSync(stage, { recursive: true, force: true });

  // 3. Bundled tools
  const bin = path.join(OUT, 'resources', 'bin');
  const wtmp = path.join(ROOT, 'dist', 'wtmp');
  sh(`unzip -q -o "${path.join(DL, 'whisper-bin-x64.zip')}" -d "${wtmp}"`);
  const rel = path.join(wtmp, 'Release');
  for (const f of fs.readdirSync(rel)) {
    if (f === 'whisper-cli.exe' || f === 'whisper.dll' || /^ggml.*\.dll$/.test(f)) cp(path.join(rel, f), path.join(bin, 'whisper', f));
  }
  fs.rmSync(wtmp, { recursive: true, force: true });
  const vc = path.join(DL, 'vcrt', 'x', 'msvc_runtime-14.51.36231.data', 'data', 'Scripts');
  for (const f of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']) cp(path.join(vc, f), path.join(bin, 'whisper', f));
  cp(path.join(DL, 'ffmpeg-win32-x64'), path.join(bin, 'ffmpeg.exe'));
  cp(path.join(DL, 'yt-dlp.exe'), path.join(bin, 'yt-dlp.exe'));
  cp(path.join(DL, 'denobin', 'deno.exe'), path.join(bin, 'deno.exe'));

  // 4. Icon + version info on the exe
  const exePath = path.join(OUT, 'TALscribe.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = VERSION.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'TALscribe', ProductName: 'TALscribe', CompanyName: 'TAL', InternalName: 'TALscribe',
    OriginalFilename: 'TALscribe.exe', LegalCopyright: 'TAL', FileVersion: VERSION, ProductVersion: VERSION,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));

  // 5. Readme
  fs.writeFileSync(path.join(OUT, 'LEGGIMI.txt'), fs.readFileSync(path.join(ROOT, 'tools', 'LEGGIMI.txt'), 'utf8').replace(/\n/g, '\r\n'));

  // 6. Zip
  const zip = path.join(ROOT, 'dist', `TALscribe-${VERSION}-win-x64.zip`);
  sh(`cd "${path.join(ROOT, 'dist')}" && zip -q -r -9 "${zip}" TALscribe`);
  console.log('OK', zip, (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB');
})().catch((e) => { console.error(e); process.exit(1); });
