'use strict';

const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');
function ts(ms, sep = ',') {
  const h = ms / 3600000, m = (ms % 3600000) / 60000, s = (ms % 60000) / 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}
function lrcTs(ms) {
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `[${pad(m)}:${s.toFixed(2).padStart(5, '0')}]`;
}
function short(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}:${pad(s)}`;
}

const NON_LYRIC = /^[\s\-–—.*♪♫🎵🎶()\[\]]*(musica|music|applausi|applause|instrumental|strumentale|risate|laughter|silenzio|silence|sottotitoli|subtitles)?[\s\-–—.*♪♫🎵🎶()\[\]!]*$/i;

/** Cleans whisper segments. Song mode removes "[Musica]" style tags and runaway repetitions. */
function clean(segments, mode) {
  let out = segments
    .map((s) => ({ start: s.start, end: s.end, text: String(s.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((s) => s.text);
  if (mode === 'song') {
    out = out
      .map((s) => ({ ...s, text: s.text.replace(/[♪♫🎵🎶]/g, '').replace(/^\s*[\[(](musica|music|instrumental)[\])]\s*/i, '').trim() }))
      .filter((s) => s.text && !NON_LYRIC.test(s.text));
  } else {
    out = out.filter((s) => !/^[\[(].*[\])]$/.test(s.text));
  }
  // drop hallucinated loops: same text more than 3 times in a row
  const res = [];
  let run = 0;
  for (const s of out) {
    const prev = res[res.length - 1];
    if (prev && prev.text.toLowerCase() === s.text.toLowerCase()) {
      run++;
      if (run >= 3) { prev.end = s.end; continue; }
    } else run = 0;
    res.push(s);
  }
  return res;
}

/** Plain text. Song: one line per segment, blank line on long pauses (verse breaks). Speech: paragraphs. */
function toText(segments, mode, withTimes = false) {
  if (withTimes) return segments.map((s) => `[${short(s.start)}] ${s.text}`).join('\n');
  if (mode === 'song') {
    const lines = [];
    segments.forEach((s, i) => {
      if (i && s.start - segments[i - 1].end > 2500) lines.push('');
      lines.push(s.text.charAt(0).toUpperCase() + s.text.slice(1));
    });
    return lines.join('\n');
  }
  const paras = [];
  let cur = [];
  segments.forEach((s, i) => {
    if (i && (s.start - segments[i - 1].end > 1800 || cur.join(' ').length > 650) && /[.!?…]$/.test(segments[i - 1].text)) {
      paras.push(cur.join(' '));
      cur = [];
    }
    cur.push(s.text);
  });
  if (cur.length) paras.push(cur.join(' '));
  return paras.join('\n\n');
}

const toSrt = (seg) => seg.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n');
const toVtt = (seg) => 'WEBVTT\n\n' + seg.map((s) => `${ts(s.start, '.')} --> ${ts(s.end, '.')}\n${s.text}\n`).join('\n');
const toLrc = (seg, title) => (title ? `[ti:${title}]\n[re:TALscribe]\n` : '[re:TALscribe]\n') + seg.map((s) => `${lrcTs(s.start)}${s.text}`).join('\n');

module.exports = { clean, toText, toSrt, toVtt, toLrc, short };
