'use strict';
const fs = require('fs');
const path = require('path');

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

// quality / speed are 1..5 scores used by the UI bars
const MODELS = [
  { id: 'tiny', name: 'Tiny', sizeMB: 75, quality: 1, speed: 5, note: 'Prove veloci, poco preciso' },
  { id: 'base', name: 'Base', sizeMB: 142, quality: 2, speed: 5, note: 'Leggero, va bene per il parlato chiaro' },
  { id: 'small-q5_1', name: 'Small Lite', sizeMB: 182, quality: 2.5, speed: 4, note: 'Small compresso, ottimo per PC modesti' },
  { id: 'small', name: 'Small', sizeMB: 466, quality: 3, speed: 4, note: 'Buon equilibrio sul parlato' },
  { id: 'medium-q5_0', name: 'Medium Lite', sizeMB: 515, quality: 3.5, speed: 3, note: 'Più preciso, ancora leggero' },
  { id: 'large-v3-turbo-q5_0', name: 'Large v3 Turbo Lite', sizeMB: 548, quality: 4.2, speed: 3, note: 'Qualità large, peso contenuto' },
  { id: 'large-v3-turbo', name: 'Large v3 Turbo', sizeMB: 1550, quality: 4.5, speed: 3, note: 'Il migliore rapporto con una GPU NVIDIA' },
  { id: 'large-v3-q5_0', name: 'Large v3 Lite', sizeMB: 1031, quality: 4.6, speed: 2, note: 'Massima qualità compressa' },
  { id: 'large-v3', name: 'Large v3', sizeMB: 2950, quality: 5, speed: 1, note: 'Il top per testi cantati difficili' },
];

const byId = (id) => MODELS.find((m) => m.id === id);
const fileOf = (id) => `ggml-${id}.bin`;
const urlOf = (id) => HF + fileOf(id) + '?download=true';

function installed(modelsDir) {
  return MODELS.filter((m) => {
    const p = path.join(modelsDir, fileOf(m.id));
    // downloads land in .part and are renamed only when complete
    try { return fs.statSync(p).size > 100 * 1024; } catch { return false; }
  }).map((m) => m.id);
}

function isValidModel(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b.readUInt32LE(0) === 0x67676d6c; // 'ggml'
  } catch { return false; }
}

/**
 * Picks three models (fast / recommended / best) from the scanned hardware.
 */
function recommend(hw) {
  const ram = hw.ramGB || 4;
  const cores = hw.cpu.physical || 2;
  const score = hw.cpuScore || 0;
  const nv = hw.nvidia;
  const vram = nv ? nv.vramMB / 1024 : 0;
  let pick, device = 'cpu';
  const reasons = [];

  if (nv && vram >= 5.5) {
    device = 'cuda';
    pick = { fast: 'small', recommended: 'large-v3-turbo', best: 'large-v3' };
    reasons.push(`GPU ${nv.name} con ${vram.toFixed(0)} GB di VRAM: i modelli large girano interamente sulla scheda video.`);
  } else if (nv && vram >= 3.5) {
    device = 'cuda';
    pick = { fast: 'base', recommended: 'large-v3-turbo-q5_0', best: 'large-v3-q5_0' };
    reasons.push(`GPU ${nv.name} con ${vram.toFixed(0)} GB di VRAM: meglio le versioni compresse dei modelli large.`);
  } else if (nv && vram >= 1.8) {
    device = 'cuda';
    pick = { fast: 'base', recommended: 'small', best: 'medium-q5_0' };
    reasons.push(`GPU ${nv.name} con poca VRAM (${vram.toFixed(1)} GB): modelli medi.`);
  } else if (cores >= 8 && ram >= 12) {
    pick = { fast: 'small-q5_1', recommended: 'large-v3-turbo-q5_0', best: 'large-v3-q5_0' };
    reasons.push(`Nessuna GPU NVIDIA, ma la CPU ha ${cores} core e ci sono ${ram} GB di RAM: il Turbo compresso è il miglior compromesso.`);
  } else if (cores >= 4 && ram >= 8) {
    pick = { fast: 'base', recommended: score > 60 ? 'medium-q5_0' : 'small', best: 'large-v3-turbo-q5_0' };
    reasons.push(`CPU con ${cores} core e ${ram} GB di RAM: modello medio per non aspettare troppo.`);
  } else {
    pick = { fast: 'tiny', recommended: 'base', best: 'small-q5_1' };
    reasons.push(`PC leggero (${cores} core, ${ram} GB di RAM): modelli piccoli per restare reattivo.`);
  }
  if (nv && device === 'cuda') reasons.push('Per usare la GPU serve il pacchetto CUDA (circa 460 MB, si scarica una volta dalla sezione Motore AI).');
  else if (hw.gpus && hw.gpus.length) reasons.push(`La GPU ${hw.gpus[0].name} non è NVIDIA: TALscribe usa la CPU.`);
  reasons.push('Per i testi cantati conviene il modello più grande che il PC regge: la musica di sottofondo confonde i modelli piccoli.');
  if (hw.diskFreeGB != null && hw.diskFreeGB < 4) reasons.push(`Attenzione: solo ${hw.diskFreeGB} GB liberi sul disco.`);
  return { ...pick, device, reasons };
}

module.exports = { MODELS, byId, fileOf, urlOf, installed, isValidModel, recommend };
