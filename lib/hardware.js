'use strict';
const os = require('os');
const fs = require('fs');
const { run, isWin } = require('./util');

/** ~0.4 s single-thread floating-point benchmark. Returns MFLOPS. */
function cpuBench() {
  const n = 96;
  const a = new Float64Array(n * n), b = new Float64Array(n * n), c = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) { a[i] = Math.random(); b[i] = Math.random(); }
  const t0 = process.hrtime.bigint();
  let iters = 0;
  while (Number(process.hrtime.bigint() - t0) < 4e8) {
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const aik = a[i * n + k];
      for (let j = 0; j < n; j++) c[i * n + j] += aik * b[k * n + j];
    }
    iters++;
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  return Math.round((iters * 2 * n * n * n) / secs / 1e6);
}

async function nvidia() {
  const r = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.free,driver_version', '--format=csv,noheader,nounits'], { timeout: 8000 });
  if (!r.ok || !r.stdout.trim()) return [];
  return r.stdout.trim().split(/\r?\n/).map((l) => {
    const [name, total, free, driver] = l.split(',').map((s) => s.trim());
    return { name, vramMB: parseInt(total, 10) || 0, freeMB: parseInt(free, 10) || 0, driver, vendor: 'NVIDIA' };
  });
}

async function windowsInfo() {
  const ps = "$c=Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed;" +
    "$g=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion;" +
    "[pscustomobject]@{cpu=@($c);gpu=@($g)} | ConvertTo-Json -Depth 4 -Compress";
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 20000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

async function scan(dataDir) {
  const cpus = os.cpus();
  const info = {
    os: `${os.type()} ${os.release()}`,
    cpu: { name: (cpus[0] && cpus[0].model || 'CPU').replace(/\s+/g, ' ').trim(), logical: cpus.length, physical: null, mhz: cpus[0] ? cpus[0].speed : 0 },
    ramGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    freeRamGB: +(os.freemem() / 1024 ** 3).toFixed(1),
    gpus: [],
    nvidia: null,
    diskFreeGB: null,
    benchMflops: 0,
  };

  const [nv, win] = await Promise.all([nvidia(), isWin ? windowsInfo() : Promise.resolve(null)]);
  if (win) {
    const c = (win.cpu || [])[0];
    if (c) {
      info.cpu.name = String(c.Name || info.cpu.name).trim();
      info.cpu.physical = (win.cpu || []).reduce((s, x) => s + (x.NumberOfCores || 0), 0) || null;
      info.cpu.mhz = c.MaxClockSpeed || info.cpu.mhz;
    }
    for (const g of win.gpu || []) {
      if (!g || !g.Name || /basic display|remote|virtual|parsec|meta/i.test(g.Name)) continue;
      info.gpus.push({ name: g.Name, vramMB: g.AdapterRAM ? Math.round(g.AdapterRAM / 1024 ** 2) : 0, vendor: /nvidia/i.test(g.Name) ? 'NVIDIA' : /amd|radeon/i.test(g.Name) ? 'AMD' : /intel/i.test(g.Name) ? 'Intel' : '' });
    }
  }
  if (nv.length) {
    info.nvidia = nv.sort((a, b) => b.vramMB - a.vramMB)[0];
    info.gpus = info.gpus.filter((g) => g.vendor !== 'NVIDIA');
    info.gpus.unshift(...nv);
  }
  if (!info.cpu.physical) info.cpu.physical = Math.max(1, Math.round(info.cpu.logical / (info.cpu.logical >= 4 ? 2 : 1)));

  try {
    const st = await fs.promises.statfs(dataDir);
    info.diskFreeGB = +((st.bavail * st.bsize) / 1024 ** 3).toFixed(1);
  } catch {}

  info.benchMflops = cpuBench();
  // rough multi-core score: single-thread MFLOPS x physical cores
  info.cpuScore = Math.round((info.benchMflops * info.cpu.physical) / 100);
  return info;
}

module.exports = { scan };
