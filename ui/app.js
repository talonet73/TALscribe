'use strict';
/* global tal */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const fmtMB = (mb) => (mb >= 1000 ? (mb / 1024).toFixed(1).replace('.', ',') + ' GB' : mb + ' MB');
const LANGS = { it: 'Italiano', en: 'Inglese', es: 'Spagnolo', fr: 'Francese', de: 'Tedesco', pt: 'Portoghese', nl: 'Olandese', ro: 'Rumeno', pl: 'Polacco', ru: 'Russo', uk: 'Ucraino', ar: 'Arabo', tr: 'Turco', ja: 'Giapponese', ko: 'Coreano', zh: 'Cinese' };

const S = {
  info: null, hw: null, rec: null, llm: null, models: null,
  source: null, // { type:'file', path, name } | { type:'youtube', url }
  job: null, item: null, view: 'lines', ollama: null, dl: {},
};

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind;
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), kind === 'err' ? 6000 : 3200);
}

function hashHue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function coverStyle(title, mode) {
  const h = hashHue(title || 'x');
  return { bg: `linear-gradient(135deg, hsl(${h} 75% 52%), hsl(${(h + 50) % 360} 70% 24%))`, icon: mode === 'song' ? '🎵' : '🎙️' };
}

// ---------------- navigation ----------------
function show(page) {
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page || (page === 'result' && n.dataset.page === 'library' && S.item && !S.fromTranscribe) || (page === 'result' && S.fromTranscribe && n.dataset.page === 'transcribe')));
  $('#main').scrollTop = 0;
  if (page === 'library') renderLibrary();
  if (page === 'engine') renderEngine();
}
$$('.nav-item').forEach((n) => n.addEventListener('click', () => show(n.dataset.page)));
$('#sideModel').addEventListener('click', () => show('engine'));

// ---------------- options ----------------
function setPills(id, v) { $$(`#${id} .pill`).forEach((p) => p.classList.toggle('active', p.dataset.v === v)); }
function bindPills(id, key) {
  $$(`#${id} .pill`).forEach((p) => p.addEventListener('click', () => {
    setPills(id, p.dataset.v); S.info.settings[key] = p.dataset.v; tal.setSettings({ [key]: p.dataset.v });
  }));
}
bindPills('modePills', 'mode');
bindPills('qualityPills', 'quality');
$('#langSel').addEventListener('change', (e) => tal.setSettings({ language: e.target.value }));
$('#modelSel').addEventListener('change', async (e) => { S.models = await tal.selectModel(e.target.value); renderModels(); });

// ---------------- sources ----------------
function setSource(src) {
  S.source = src;
  $('#dropZone').classList.toggle('selected', src && src.type === 'file');
  $('#ytCard').classList.toggle('selected', src && src.type === 'youtube');
  if (src && src.type === 'file') {
    $('#fileLabel').innerHTML = `<b style="color:#fff">${esc(src.name)}</b><br><span class="muted">Pronto da trascrivere</span>`;
    $('#ytUrl').value = '';
  } else {
    $('#fileLabel').innerHTML = 'Trascina qui un audio o un video<br><span class="muted">mp3 · wav · m4a · flac · ogg · mp4 · mkv…</span>';
  }
  updateGo();
}
const dz = $('#dropZone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const p = tal.pathForFile(f);
  if (p) setSource({ type: 'file', path: p, name: f.name });
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('#browseBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const p = await tal.pickFile();
  if (p) setSource({ type: 'file', path: p, name: p.split(/[\\/]/).pop() });
});
const YT = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S+/i;
function onUrl() {
  const v = $('#ytUrl').value.trim();
  if (v && YT.test(v)) setSource({ type: 'youtube', url: v });
  else if (S.source && S.source.type === 'youtube') setSource(null);
  else updateGo();
}
$('#ytUrl').addEventListener('input', onUrl);
$('#pasteBtn').addEventListener('click', async () => {
  try { $('#ytUrl').value = (await navigator.clipboard.readText()).trim(); onUrl(); } catch { toast('Non riesco a leggere gli appunti', 'err'); }
});

function updateGo() {
  const hasModel = S.models && S.models.installed.length;
  const ok = S.source && hasModel && !S.job;
  $('#goBtn').disabled = !ok;
  const yt = $('#ytUrl').value.trim();
  $('#goSub').textContent = S.job ? 'Trascrizione in corso…' : !hasModel ? 'Prima scarica un modello AI' :
    S.source ? (S.source.type === 'file' ? S.source.name : 'Video YouTube pronto') :
    yt ? 'Il link non sembra di YouTube' : 'Scegli un file o incolla un link';
  $('#noModelBanner').classList.toggle('hidden', !!hasModel || !S.models);
}

// ---------------- transcription ----------------
$('#goBtn').addEventListener('click', startJob);
async function startJob() {
  if (!S.source) return;
  const st = S.info.settings;
  const opts = {
    source: S.source.type, path: S.source.path, url: S.source.url,
    mode: st.mode, language: $('#langSel').value, quality: st.quality,
    modelId: $('#modelSel').value, prompt: $('#promptIn').value,
  };
  try {
    const { id } = await tal.start(opts);
    S.job = { id, title: S.source.name || 'YouTube', mode: opts.mode };
    $('#live').classList.remove('hidden');
    $('#liveText').innerHTML = '';
    $('#liveTitle').textContent = S.job.title;
    $('#liveStage').textContent = 'Avvio…';
    setBar('busy', { title: S.job.title, sub: 'Avvio…', pct: 0 });
    updateGo();
  } catch (e) { toast(cleanErr(e), 'err'); }
}
const cleanErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

tal.onMeta((m) => { if (S.job && m.title) { S.job.title = m.title; $('#liveTitle').textContent = m.title; $('#barTitle').textContent = m.title; } });
tal.onProgress((p) => {
  if (!S.job) return;
  const label = `${p.label || ''} · ${Math.round(p.pct)}%`;
  $('#liveStage').textContent = label;
  setBar('busy', { sub: p.label, pct: p.pct });
});
tal.onSegment((s) => {
  const box = $('#liveText');
  const el = document.createElement('p');
  el.innerHTML = `<span>${fmtT(s.start / 1000)}</span>${esc(s.text)}`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
});
tal.onNotice((n) => toast(n));
tal.onDone((meta) => {
  S.job = null;
  $('#live').classList.add('hidden');
  setSource(null);
  updateGo();
  toast('Trascrizione completata ✓', 'ok');
  refreshRecent();
  S.fromTranscribe = true;
  openResult(meta);
});
tal.onError((e) => {
  S.job = null;
  $('#live').classList.add('hidden');
  setBar('idle');
  updateGo();
  if (!e.cancelled) toast(e.message, 'err');
  else toast('Trascrizione annullata');
});
$('#cancelBtn').addEventListener('click', () => tal.cancel());

// ---------------- bottom bar / player ----------------
const audio = $('#audio');
let barMode = 'idle';
function setBar(mode, o = {}) {
  barMode = mode;
  const bar = $('#bar');
  bar.classList.toggle('busy', mode === 'busy');
  $('#barCover').classList.toggle('busy', mode === 'busy');
  $('#cancelBtn').classList.toggle('hidden', mode !== 'busy');
  ['#barPlay', '#back10', '#fwd10'].forEach((s) => { $(s).disabled = mode !== 'player'; });
  if (o.title !== undefined) $('#barTitle').textContent = o.title;
  if (o.sub !== undefined) $('#barSub').textContent = o.sub;
  if (mode === 'busy') {
    $('#fill').style.width = (o.pct || 0) + '%';
    $('#barPct').textContent = o.pct != null ? Math.round(o.pct) + '%' : '';
    $('#tCur').textContent = ''; $('#tTot').textContent = '';
  } else if (mode === 'idle') {
    $('#barTitle').textContent = 'Pronto'; $('#barSub').textContent = 'Nessuna trascrizione in corso';
    $('#fill').style.width = '0'; $('#barPct').textContent = ''; $('#tCur').textContent = '0:00'; $('#tTot').textContent = '0:00';
    $('#barCover').style.background = '';
  } else {
    $('#barPct').textContent = '';
  }
}
function playIcon(playing) {
  const d = playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7L8 5Z';
  $('#barPlay svg').innerHTML = `<path d="${d}"/>`;
  $('#playBtn svg').innerHTML = `<path d="${d}"/>`;
}
function togglePlay() { if (!audio.src) return toast('Audio non disponibile per questa trascrizione'); audio.paused ? audio.play() : audio.pause(); }
$('#barPlay').addEventListener('click', togglePlay);
$('#playBtn').addEventListener('click', togglePlay);
$('#back10').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
$('#fwd10').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
audio.addEventListener('play', () => playIcon(true));
audio.addEventListener('pause', () => playIcon(false));
audio.addEventListener('loadedmetadata', () => { if (barMode === 'player') $('#tTot').textContent = fmtT(audio.duration); });
audio.addEventListener('timeupdate', () => {
  if (barMode !== 'player') return;
  const d = audio.duration || 0;
  $('#tCur').textContent = fmtT(audio.currentTime);
  const pct = d ? (audio.currentTime / d) * 100 : 0;
  $('#fill').style.width = pct + '%'; $('#knob').style.left = pct + '%';
  syncLines(audio.currentTime * 1000);
});
$('#track').addEventListener('click', (e) => {
  if (barMode !== 'player' || !audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && barMode === 'player' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); togglePlay(); }
});

// ---------------- result view ----------------
async function openResult(meta) {
  S.item = meta;
  const cs = coverStyle(meta.title, meta.mode);
  $('#resultCover').style.background = cs.bg; $('#resultCover').textContent = cs.icon;
  $('#resultHero').style.setProperty('--hero', `hsl(${hashHue(meta.title || 'x')} 60% 45%)`);
  $('#resultKind').textContent = (meta.mode === 'song' ? 'Testo cantato' : 'Parlato') + (meta.source === 'youtube' ? ' · YouTube' : ' · File');
  $('#resultTitle').textContent = meta.title || 'Senza titolo';
  const chips = [];
  if (meta.duration) chips.push(fmtT(meta.duration));
  chips.push((meta.segments || []).length + ' righe');
  const lang = meta.detectedLanguage || meta.language;
  if (lang && lang !== 'auto') chips.push(LANGS[lang] || lang.toUpperCase());
  const m = S.models && S.models.catalog.find((x) => x.id === meta.model);
  chips.push(m ? m.name : meta.model);
  if (meta.device) chips.push(meta.device);
  chips.push(new Date(meta.createdAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }));
  $('#resultChips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  renderLines();
  $('#plainText').textContent = await tal.buildExport({ id: meta.id, format: 'txt' });
  renderAI();
  setView('lines');
  audio.pause();
  if (meta.audioUrl) { audio.src = meta.audioUrl; } else { audio.removeAttribute('src'); audio.load(); }
  setBar('player', { title: meta.title, sub: meta.audioUrl ? 'Clicca una riga per saltare in quel punto' : 'Audio originale non trovato' });
  $('#barCover').style.background = cs.bg;
  $('#fill').style.width = '0'; $('#tCur').textContent = '0:00'; $('#tTot').textContent = meta.duration ? fmtT(meta.duration) : '0:00';
  playIcon(false);
  show('result');
}

function renderLines() {
  const segs = S.item.segments || [];
  const box = $('#lines');
  box.className = 'lines ' + (S.item.mode === 'song' ? 'song' : 'speech');
  if (!segs.length) { box.innerHTML = '<div class="empty">Nessun testo riconosciuto. Prova un modello più grande o controlla la lingua.</div>'; return; }
  box.innerHTML = segs.map((s, i) => {
    const gap = i && s.start - segs[i - 1].end > 2500 ? ' gap' : '';
    return `<div class="line${gap}" data-i="${i}" data-s="${s.start}"><span class="t">${fmtT(s.start / 1000)}</span><span>${esc(s.text)}</span></div>`;
  }).join('');
}
$('#lines').addEventListener('click', (e) => {
  const l = e.target.closest('.line');
  if (!l || !audio.src) return;
  audio.currentTime = (+l.dataset.s) / 1000 + 0.01;
  audio.play();
});
let lastNow = -1;
function syncLines(ms) {
  const segs = (S.item && S.item.segments) || [];
  let idx = -1;
  for (let i = 0; i < segs.length; i++) { if (segs[i].start <= ms) idx = i; else break; }
  if (idx === lastNow) return;
  lastNow = idx;
  $$('#lines .line').forEach((el, i) => { el.classList.toggle('now', i === idx); el.classList.toggle('past', i < idx); });
  const cur = $(`#lines .line[data-i="${idx}"]`);
  if (cur && S.view === 'lines') cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

$('#resultTitle').addEventListener('blur', async () => {
  const t = $('#resultTitle').textContent.trim();
  if (S.item && t && t !== S.item.title) { S.item.title = t; await tal.renameItem({ id: S.item.id, title: t }); refreshRecent(); $('#barTitle').textContent = t; }
});
$('#resultTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

function setView(v) {
  S.view = v;
  $$('#viewTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.v === v));
  ['lines', 'plain', 'ai', 'summary'].forEach((k) => $('#view-' + k).classList.toggle('hidden', k !== v));
}
$$('#viewTabs .tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.v)));

$('#copyBtn').addEventListener('click', async () => {
  let txt;
  if (S.view === 'ai') txt = (S.item.refined && S.item.refined[S.item.mode === 'song' ? 'song' : 'speech'] || {}).text;
  else if (S.view === 'summary') txt = (S.item.refined && S.item.refined.summary || {}).text;
  else txt = await tal.buildExport({ id: S.item.id, format: 'txt', withTimes: S.view === 'lines' });
  if (!txt) return toast('Niente da copiare in questa scheda');
  await navigator.clipboard.writeText(txt);
  toast('Copiato negli appunti ✓', 'ok');
});
$('#exportBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#exportMenu').classList.toggle('hidden'); });
document.addEventListener('click', () => $('#exportMenu').classList.add('hidden'));
$$('#exportMenu button').forEach((b) => b.addEventListener('click', async () => {
  const f = b.dataset.f;
  const ext = f === 'txt-t' ? 'txt' : f;
  const content = await tal.buildExport({ id: S.item.id, format: ext, withTimes: f === 'txt-t' });
  const p = await tal.saveExport({ name: S.item.title, ext, content });
  if (p) toast('Salvato ✓', 'ok');
}));

// ---------------- AI (Ollama) ----------------
async function renderAI() {
  S.ollama = await tal.ollamaStatus();
  const task = S.item.mode === 'song' ? 'song' : 'speech';
  fillAIBox($('#aiBox'), task);
  fillAIBox($('#sumBox'), 'summary');
}
function fillAIBox(box, task) {
  const done = S.item.refined && S.item.refined[task];
  const o = S.ollama;
  const title = task === 'summary' ? 'Riassunto automatico' : task === 'song' ? 'Impagina il testo della canzone' : 'Sistema punteggiatura e paragrafi';
  const desc = task === 'summary' ? 'Un titolo e i punti chiave della trascrizione.' :
    task === 'song' ? 'Strofe, ritornello e punteggiatura, senza cambiare le parole.' : 'Stesse parole, ma scorrevoli da leggere.';
  if (!o.running) {
    box.innerHTML = `<div class="ai-cta"><h3>✨ ${title}</h3><div class="muted">${desc} Serve <b>Ollama</b>, gratuito e locale: installalo, avvialo e torna qui.</div>
      <div class="ai-row"><button class="btn btn-white" data-act="get">Scarica Ollama</button><button class="btn btn-ghost" data-act="retry">Ho installato, ricontrolla</button></div></div>`;
  } else if (!o.models.length) {
    const rec = S.llm ? S.llm.name : 'qwen2.5:3b';
    box.innerHTML = `<div class="ai-cta"><h3>✨ ${title}</h3><div class="muted">Ollama è attivo ma non ha modelli. Per il tuo PC consiglio <b>${esc(rec)}</b>.</div>
      <div class="ai-row"><button class="btn btn-green" data-act="pull" data-m="${esc(rec)}">Scarica ${esc(rec)}</button><span class="muted" data-pull></span></div></div>`;
  } else {
    const pref = S.info.settings.ollamaModel && o.models.find((m) => m.name === S.info.settings.ollamaModel) ? S.info.settings.ollamaModel : o.models[0].name;
    box.innerHTML = `${done ? '' : `<div class="ai-cta"><h3>✨ ${title}</h3><div class="muted">${desc}</div></div>`}
      <div class="ai-row" style="margin:16px 0">
        <select data-model>${o.models.map((m) => `<option ${m.name === pref ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        <button class="btn btn-green" data-act="run">${done ? 'Rifai' : 'Avvia'}</button>
        <button class="btn btn-ghost hidden" data-act="stop">Ferma</button>
      </div>
      <pre class="ai-text" data-out>${done ? esc(done.text) : ''}</pre>`;
  }
  box.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'get') tal.openExternal('https://ollama.com/download');
    if (act === 'retry') renderAI();
    if (act === 'pull') {
      b.disabled = true;
      const lbl = box.querySelector('[data-pull]');
      const off = tal.onOllamaProgress((p) => { lbl.textContent = (p.status || '') + (p.pct != null ? ' ' + Math.round(p.pct) + '%' : ''); });
      try { await tal.ollamaPull(b.dataset.m); toast('Modello pronto ✓', 'ok'); renderAI(); } catch (er) { toast(cleanErr(er), 'err'); b.disabled = false; } finally { off(); }
    }
    if (act === 'stop') tal.ollamaCancel();
    if (act === 'run') {
      const out = box.querySelector('[data-out]');
      const model = box.querySelector('[data-model]').value;
      out.textContent = ''; out.classList.add('streaming');
      b.disabled = true; box.querySelector('[data-act=stop]').classList.remove('hidden');
      const off = tal.onOllamaChunk((c) => { if (c.id === S.item.id && c.task === task) out.textContent += c.chunk; });
      try {
        const full = await tal.ollamaRefine({ id: S.item.id, model, task });
        S.item.refined = { ...(S.item.refined || {}), [task]: { text: full, model } };
        S.info.settings.ollamaModel = model;
      } catch (er) { if (!/abort/i.test(String(er))) toast(cleanErr(er), 'err'); }
      finally { off(); out.classList.remove('streaming'); b.disabled = false; b.textContent = 'Rifai'; box.querySelector('[data-act=stop]').classList.add('hidden'); }
    }
  };
}

// ---------------- library ----------------
let libCache = [];
async function renderLibrary() {
  libCache = await tal.history();
  drawLibrary();
}
function drawLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase();
  const items = libCache.filter((i) => !q || (i.title + ' ' + i.preview).toLowerCase().includes(q));
  $('#libCount').textContent = libCache.length ? `${libCache.length} trascrizion${libCache.length === 1 ? 'e' : 'i'}` : '';
  $('#libEmpty').classList.toggle('hidden', libCache.length > 0);
  $('#libGrid').innerHTML = items.map((i) => {
    const cs = coverStyle(i.title, i.mode);
    return `<div class="tile" data-id="${esc(i.id)}">
      <button class="del" data-del="${esc(i.id)}" title="Elimina"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z"/></svg></button>
      <div class="cover" style="background:${cs.bg}">${cs.icon}</div>
      <div class="tt">${esc(i.title)}</div>
      <div class="ts">${i.duration ? fmtT(i.duration) + ' · ' : ''}${esc(i.preview || '—')}</div></div>`;
  }).join('');
}
$('#libSearch').addEventListener('input', drawLibrary);
$('#libGrid').addEventListener('click', async (e) => {
  const d = e.target.closest('[data-del]');
  if (d) {
    e.stopPropagation();
    if (!confirm('Eliminare questa trascrizione?')) return;
    await tal.deleteItem(d.dataset.del);
    if (S.item && S.item.id === d.dataset.del) { S.item = null; audio.pause(); setBar('idle'); }
    renderLibrary(); refreshRecent();
    return;
  }
  const t = e.target.closest('.tile');
  if (t) { S.fromTranscribe = false; openResult(await tal.getItem(t.dataset.id)); }
});
async function refreshRecent() {
  const list = (await tal.history()).slice(0, 8);
  $('#recentList').innerHTML = list.map((i) => {
    const cs = coverStyle(i.title, i.mode);
    return `<div class="recent" data-id="${esc(i.id)}"><div class="mini" style="background:${cs.bg}">${cs.icon}</div><div><div class="rt">${esc(i.title)}</div><div class="rs">${i.mode === 'song' ? 'Cantato' : 'Parlato'}${i.duration ? ' · ' + fmtT(i.duration) : ''}</div></div></div>`;
  }).join('') || '<div class="muted" style="font-size:13px;padding:6px">Le ultime trascrizioni appariranno qui.</div>';
}
$('#recentList').addEventListener('click', async (e) => {
  const r = e.target.closest('.recent');
  if (r) { S.fromTranscribe = false; openResult(await tal.getItem(r.dataset.id)); }
});

// ---------------- models & engine ----------------
function renderModels() {
  const m = S.models;
  const sel = $('#modelSel');
  sel.innerHTML = m.installed.length ? m.installed.map((id) => {
    const c = m.catalog.find((x) => x.id === id);
    return `<option value="${id}" ${id === m.active ? 'selected' : ''}>${esc(c.name)} · ${fmtMB(c.sizeMB)}</option>`;
  }).join('') : '<option value="">Nessun modello</option>';
  const act = m.catalog.find((x) => x.id === m.active);
  $('#sideModelName').textContent = act ? act.name : 'Nessun modello';
  updateGo();
}
function dots(v) {
  return '<div class="dots">' + [1, 2, 3, 4, 5].map((i) => `<i class="${v >= i ? 'on' : v >= i - 0.5 ? 'half' : ''}"></i>`).join('') + '</div>';
}
function modelBtn(id) {
  const m = S.models;
  if (S.dl[id] != null) return `<div style="flex:1"><div class="prog"><i style="width:${S.dl[id]}%"></i></div></div><button class="btn btn-ghost sm" data-cancel="${id}">Stop</button>`;
  if (m.active === id) return '<span class="on-badge">● In uso</span>';
  if (m.installed.includes(id)) return `<button class="btn btn-ghost sm" data-use="${id}">Usa</button><button class="btn btn-ghost sm" data-del="${id}" title="Elimina">✕</button>`;
  return `<button class="btn btn-green sm" data-dl="${id}">Scarica</button>`;
}
async function renderEngine() {
  if (!S.hw) return;
  const hw = S.hw, rec = S.rec;
  const gpu = hw.nvidia ? `${hw.nvidia.name}` : hw.gpus[0] ? hw.gpus[0].name : 'Nessuna rilevata';
  const gpuS = hw.nvidia ? `${(hw.nvidia.vramMB / 1024).toFixed(0)} GB VRAM · CUDA` : hw.gpus[0] ? 'Non NVIDIA: si usa la CPU' : '';
  const score = Math.min(100, Math.round((hw.cpuScore / 160) * 100));
  $('#hwCard').innerHTML = `
    <div class="hw-item"><div class="k">Processore</div><div class="v">${esc(hw.cpu.name)}</div><div class="s">${hw.cpu.physical} core · ${hw.cpu.logical} thread</div></div>
    <div class="hw-item"><div class="k">Memoria</div><div class="v">${hw.ramGB} GB</div><div class="s">${hw.freeRamGB} GB liberi ora</div></div>
    <div class="hw-item"><div class="k">Scheda video</div><div class="v">${esc(gpu)}</div><div class="s">${esc(gpuS)}</div></div>
    <div class="hw-item"><div class="k">Disco</div><div class="v">${hw.diskFreeGB != null ? hw.diskFreeGB + ' GB' : '—'}</div><div class="s">liberi per i modelli</div></div>
    <div class="hw-item"><div class="k">Potenza CPU</div><div class="v">${score}/100</div><div class="meter"><i style="width:${score}%"></i></div></div>
    <div class="hw-actions"><button class="btn btn-ghost sm" id="rescan">Rianalizza</button></div>`;
  $('#rescan').onclick = async () => { $('#hwCard').innerHTML = '<div class="loading-dots">Analizzo il PC<span>.</span><span>.</span><span>.</span></div>'; await scanHw(true); renderEngine(); };

  const cards = [['fast', '⚡ Veloce', ''], ['recommended', '★ Consigliato', 'star'], ['best', '💎 Massima qualità', '']];
  $('#recGrid').innerHTML = cards.map(([k, label, cls]) => {
    const c = S.models.catalog.find((x) => x.id === rec[k]);
    return `<div class="rec ${cls}">${cls ? '<span class="badge">Scelto per te</span>' : ''}
      <div class="rk">${label}</div><div class="rn">${esc(c.name)}</div><div class="rnote">${esc(c.note)}</div>
      <div class="bars"><span>Qualità</span>${dots(c.quality)}<span>Velocità</span>${dots(rec.device === 'cuda' && S.models.cuda.installed ? Math.min(5, c.speed + 1.5) : c.speed)}<span>Peso</span><b style="color:#fff">${fmtMB(c.sizeMB)}</b></div>
      <div class="ai-row" style="justify-content:flex-start">${modelBtn(c.id)}</div></div>`;
  }).join('');
  $('#reasons').innerHTML = rec.reasons.map((r) => `<li>${esc(r)}</li>`).join('');

  const gc = $('#gpuCard');
  if (hw.nvidia && S.models.cuda.supported) {
    gc.classList.remove('hidden');
    const c = S.models.cuda;
    gc.innerHTML = `<div class="gi">⚡</div><div class="gt"><b>Accelerazione GPU NVIDIA</b><div class="muted">${c.installed ? 'Pacchetto CUDA installato: le trascrizioni girano sulla scheda video (fino a 10 volte più veloci).' : 'Scarica il motore CUDA (circa 460 MB, una volta sola) per usare la tua ' + esc(hw.nvidia.name) + '.'}</div></div>
      ${S.dl.cuda != null ? `<div style="width:220px"><div class="prog"><i style="width:${S.dl.cuda}%"></i></div><div class="muted" style="font-size:12px;margin-top:4px">${S.dl.cudaX ? 'Estrazione…' : Math.round(S.dl.cuda) + '%'}</div></div>` :
        c.installed ? '<span class="on-badge">● Attivo</span>' : '<button class="btn btn-green" id="cudaBtn">Installa CUDA</button>'}`;
    const cb = $('#cudaBtn');
    if (cb) cb.onclick = async () => { S.dl.cuda = 0; renderEngine(); try { S.models = await tal.installCuda(); toast('GPU pronta ✓', 'ok'); } catch (e) { toast(cleanErr(e), 'err'); } delete S.dl.cuda; delete S.dl.cudaX; renderEngine(); };
  } else gc.classList.add('hidden');

  $('#modelTable').innerHTML = `<div class="trow head"><div>Modello</div><div>Peso</div><div>Qualità</div><div>Velocità</div><div></div></div>` +
    S.models.catalog.map((c) => `<div class="trow"><div class="nm">${esc(c.name)}${c.id === rec.recommended ? ' <span class="tag" style="background:#1ed76033;color:#1ed760">consigliato</span>' : ''}<small>${esc(c.note)}</small></div>
      <div>${fmtMB(c.sizeMB)}</div><div>${dots(c.quality)}</div><div>${dots(c.speed)}</div><div class="act">${modelBtn(c.id)}</div></div>`).join('');
  renderOllamaCard();
}
$('#engineContent').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-dl],[data-use],[data-del],[data-cancel]');
  if (!t) return;
  if (t.dataset.dl) downloadModel(t.dataset.dl);
  if (t.dataset.use) { S.models = await tal.selectModel(t.dataset.use); renderModels(); renderEngine(); }
  if (t.dataset.del) { if (confirm('Eliminare il modello dal disco?')) { S.models = await tal.deleteModel(t.dataset.del); renderModels(); renderEngine(); } }
  if (t.dataset.cancel) tal.cancelDownload(t.dataset.cancel);
});
async function downloadModel(id) {
  S.dl[id] = 0; renderEngine();
  try { S.models = await tal.downloadModel(id); toast('Modello pronto ✓', 'ok'); }
  catch (e) { if (!/Annullato/.test(String(e))) toast(cleanErr(e), 'err'); }
  delete S.dl[id];
  renderModels(); renderEngine();
  return S.models.installed.includes(id);
}
tal.onDownload((p) => {
  if (p.id === 'ytdlp') return;
  S.dl[p.id] = p.pct;
  if (p.extracting) S.dl.cudaX = true;
  // update progress bars in place without re-rendering everything
  const bars = $$(`[data-cancel="${p.id}"]`).map((b) => b.previousElementSibling && b.previousElementSibling.querySelector('i'));
  bars.forEach((i) => { if (i) i.style.width = p.pct + '%'; });
  if (p.id === 'cuda' && $('#page-engine').classList.contains('active')) renderEngine();
  if (S.obDl === p.id) {
    $('#obFill').style.width = p.pct + '%';
    $('#obProgLbl').textContent = `${Math.round(p.pct)}% · ${(p.done / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)} MB`;
  }
});

async function renderOllamaCard() {
  const o = S.ollama = await tal.ollamaStatus();
  const llm = S.llm;
  const has = o.running && o.models.some((m) => m.name === llm.name || m.name === llm.name + ':latest');
  $('#ollamaCard').innerHTML = `<div class="gi">🦙</div>
    <div class="gt"><b><span class="status-dot ${o.running ? 'ok' : ''}"></span>${o.running ? 'Ollama attivo' + (o.version ? ' · v' + esc(o.version) : '') : 'Ollama non rilevato'}</b>
    <div class="muted">Whisper trascrive; un modello linguistico locale poi impagina strofe e ritornelli, sistema la punteggiatura o fa un riassunto.
    ${o.running ? `<br>Modello consigliato: <b style="color:#fff">${esc(llm.name)}</b> (${String(llm.sizeGB).replace('.', ',')} GB). ${esc(llm.why)}${o.models.length ? '<br>Installati: ' + o.models.map((m) => esc(m.name)).join(', ') : ''}` : '<br>È gratuito: installalo, lascialo aperto e TALscribe lo trova da solo.'}</div></div>
    ${!o.running ? '<button class="btn btn-white" id="olGet">Scarica Ollama</button><button class="btn btn-ghost" id="olRe">Ricontrolla</button>' :
      has ? '<span class="on-badge">● Pronto</span>' : `<button class="btn btn-green" id="olPull">Scarica ${esc(llm.name)}</button><span class="muted" id="olLbl"></span>`}`;
  const g = $('#olGet'); if (g) g.onclick = () => tal.openExternal('https://ollama.com/download');
  const r = $('#olRe'); if (r) r.onclick = renderOllamaCard;
  const p = $('#olPull');
  if (p) p.onclick = async () => {
    p.disabled = true;
    const off = tal.onOllamaProgress((x) => { $('#olLbl').textContent = (x.status || '') + (x.pct != null ? ' ' + Math.round(x.pct) + '%' : ''); });
    try { await tal.ollamaPull(llm.name); toast('Modello Ollama pronto ✓', 'ok'); } catch (e) { toast(cleanErr(e), 'err'); }
    off(); renderOllamaCard();
  };
}

async function scanHw(force) {
  const r = await tal.scan(force);
  S.hw = r.hw; S.rec = r.rec; S.llm = r.llm;
  const hw = r.hw;
  $('#sideHw').textContent = `${hw.cpu.physical} core · ${hw.ramGB} GB RAM${hw.nvidia ? ' · ' + hw.nvidia.name.replace(/NVIDIA |GeForce /g, '') : ''}`;
  return r;
}

// ---------------- onboarding ----------------
async function onboarding() {
  $('#onboard').classList.remove('hidden');
  $('#ob1').classList.remove('hidden'); $('#ob2').classList.add('hidden');
  const lines = $('#scanLines'); lines.innerHTML = '';
  const add = (k, v) => { const d = document.createElement('div'); d.innerHTML = `✓ ${esc(k)} <b>${esc(v)}</b>`; lines.appendChild(d); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = scanHw(false);
  await wait(600);
  const { hw, rec } = await p;
  add('Processore', `${hw.cpu.physical} core`); await wait(350);
  add('Memoria', `${hw.ramGB} GB`); await wait(350);
  add('Scheda video', hw.nvidia ? hw.nvidia.name : hw.gpus[0] ? hw.gpus[0].name : 'integrata'); await wait(350);
  add('Benchmark CPU', `${Math.min(100, Math.round((hw.cpuScore / 160) * 100))}/100`); await wait(700);

  $('#ob1').classList.add('hidden'); $('#ob2').classList.remove('hidden');
  $('#obHw').innerHTML = [hw.cpu.name, hw.ramGB + ' GB RAM', hw.nvidia ? hw.nvidia.name : 'CPU only', hw.diskFreeGB != null ? hw.diskFreeGB + ' GB liberi' : ''].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  let pick = rec.recommended;
  const opts = [['fast', '⚡', 'Veloce'], ['recommended', '★', 'Consigliato'], ['best', '💎', 'Massima qualità']];
  const draw = () => {
    $('#obRec').innerHTML = opts.map(([k, em, lab]) => {
      const c = S.models.catalog.find((x) => x.id === rec[k]);
      return `<div class="ob-opt ${c.id === pick ? 'sel' : ''}" data-id="${c.id}"><span class="em">${em}</span><div class="on"><b>${lab}: ${esc(c.name)}</b><span>${esc(c.note)}</span></div><span class="sz">${fmtMB(c.sizeMB)}</span></div>`;
    }).join('') + `<div class="muted" style="font-size:13px;margin-top:6px">${esc(rec.reasons[0])}</div>`;
  };
  draw();
  $('#obRec').onclick = (e) => { const o = e.target.closest('.ob-opt'); if (o && !S.obDl) { pick = o.dataset.id; draw(); } };
  $('#obSkip').onclick = () => { $('#onboard').classList.add('hidden'); tal.setSettings({ onboarded: true }); };
  $('#obGo').onclick = async () => {
    $('#obGo').disabled = true; $('#obSkip').disabled = true;
    $('#obProg').classList.remove('hidden');
    S.obDl = pick;
    const ok = await downloadModel(pick);
    S.obDl = null;
    $('#obGo').disabled = false; $('#obSkip').disabled = false;
    if (ok) {
      tal.setSettings({ onboarded: true });
      $('#onboard').classList.add('hidden');
      toast('Tutto pronto! Trascina un file o incolla un link 🎧', 'ok');
    } else { $('#obProg').classList.add('hidden'); }
  };
}
$('#openOnboarding').addEventListener('click', onboarding);

// ---------------- settings page ----------------
$$('[data-open]').forEach((b) => b.addEventListener('click', () => tal.openPath(b.dataset.open)));
$('#ytUpdBtn').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Aggiorno…';
  try { const r = await tal.updateYtdlp(); toast(r.message, r.ok ? 'ok' : ''); } catch (er) { toast(cleanErr(er), 'err'); }
  e.target.disabled = false; e.target.textContent = 'Aggiorna';
});
$('#gpuToggle').addEventListener('change', async (e) => { await tal.setSettings({ useGpu: e.target.checked }); S.models = await tal.models(); });

// ---------------- boot ----------------
(async function boot() {
  S.info = await tal.info();
  const st = S.info.settings;
  setPills('modePills', st.mode); setPills('qualityPills', st.quality);
  $('#langSel').value = st.language || 'auto';
  $('#dataDirLbl').textContent = S.info.dataDir;
  $('#verLbl').textContent = 'v' + S.info.version;
  $('#gpuToggle').checked = st.useGpu !== false;
  S.models = await tal.models();
  renderModels();
  setBar('idle');
  refreshRecent();
  if (!S.models.installed.length) onboarding();
  else scanHw(false);
})();
