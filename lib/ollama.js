'use strict';
// Optional post-processing with a local LLM through Ollama (https://ollama.com).
// Ollama does not transcribe audio: Whisper does that. The LLM polishes the text afterwards.

const BASE = 'http://127.0.0.1:11434';

async function status() {
  try {
    const ctl = AbortSignal.timeout(1500);
    const r = await fetch(BASE + '/api/tags', { signal: ctl });
    const j = await r.json();
    let version = '';
    try { version = (await (await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(1500) })).json()).version; } catch {}
    return { running: true, version, models: (j.models || []).map((m) => ({ name: m.name, size: m.size })) };
  } catch {
    return { running: false, models: [] };
  }
}

function recommendLLM(hw) {
  const vram = hw.nvidia ? hw.nvidia.vramMB / 1024 : 0;
  const ram = hw.ramGB || 4;
  if (vram >= 7 || ram >= 24) return { name: 'qwen2.5:7b', sizeGB: 4.7, why: 'Hai risorse sufficienti per un modello 7B: italiano più naturale e punteggiatura accurata.' };
  if (vram >= 3.5 || ram >= 12) return { name: 'qwen2.5:3b', sizeGB: 1.9, why: 'Modello 3B: buon italiano, veloce anche senza GPU potente.' };
  return { name: 'qwen2.5:1.5b', sizeGB: 1.0, why: 'Modello leggero per non rallentare il PC.' };
}

async function* ndjson(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { yield JSON.parse(line); } catch {} }
    }
  }
  if (buf.trim()) { try { yield JSON.parse(buf); } catch {} }
}

async function pull(name, onProgress, signal) {
  const res = await fetch(BASE + '/api/pull', { method: 'POST', body: JSON.stringify({ name, stream: true }), signal });
  if (!res.ok) throw new Error('Ollama: download del modello non riuscito');
  for await (const j of ndjson(res)) {
    if (j.error) throw new Error('Ollama: ' + j.error);
    onProgress({ status: j.status, pct: j.total ? (j.completed / j.total) * 100 : null });
  }
}

const TASKS = {
  song: (lang) => `Sei un editor di testi musicali. Ti do la trascrizione automatica di una canzone${lang ? ` (lingua: ${lang})` : ''}.
Riscrivila come testo di canzone ben impaginato:
- un verso per riga, strofe separate da una riga vuota;
- se riconosci il ritornello, segnalo con [Ritornello] (e le strofe con [Strofa 1], [Strofa 2]…);
- correggi solo errori evidenti di riconoscimento e la punteggiatura, NON inventare parole e non tradurre;
- rispondi solo con il testo, senza commenti.`,
  speech: (lang) => `Sei un correttore di bozze. Ti do la trascrizione automatica di un parlato${lang ? ` (lingua: ${lang})` : ''}.
Restituisci lo stesso testo con punteggiatura, maiuscole e paragrafi corretti. Correggi solo gli errori evidenti di riconoscimento,
non riassumere, non tradurre, non aggiungere nulla. Rispondi solo con il testo.`,
  summary: (lang) => `Riassumi in modo chiaro la seguente trascrizione, nella sua stessa lingua${lang ? ` (${lang})` : ''}.
Dai: un titolo, 3-6 punti chiave in elenco puntato, e una frase finale. Rispondi solo con il riassunto.`,
};

function chunks(text, max = 3500) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const p of text.split(/\n{2,}/)) {
    if ((cur + '\n\n' + p).length > max && cur) { out.push(cur); cur = p; } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

async function refine({ model, task, text, language }, onChunk, signal) {
  const sys = (TASKS[task] || TASKS.speech)(language);
  const parts = task === 'summary' ? [text.slice(0, 24000)] : chunks(text);
  for (let i = 0; i < parts.length; i++) {
    const res = await fetch(BASE + '/api/generate', {
      method: 'POST', signal,
      body: JSON.stringify({ model, system: sys, prompt: parts[i], stream: true, options: { temperature: 0.2, num_ctx: 8192 } }),
    });
    if (!res.ok) throw new Error('Ollama ha risposto con un errore (' + res.status + ')');
    for await (const j of ndjson(res)) {
      if (j.error) throw new Error('Ollama: ' + j.error);
      if (j.response) onChunk(j.response);
    }
    if (i < parts.length - 1) onChunk('\n\n');
  }
}

module.exports = { status, recommendLLM, pull, refine };
