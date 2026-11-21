'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const { clean } = require('./formats');
const { fileOf } = require('./models');

const PLAYABLE = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.webm', '.flac', '.mp4', '.m4v', '.mov'];

function hms(str) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(str);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

/**
 * One transcription job: (YouTube download) -> ffmpeg 16 kHz mono WAV -> whisper-cli -> cleaned segments.
 * All paths handed to the external tools are relative to dataDir so that a non-ASCII Windows user name
 * never reaches whisper-cli.
 */
class Job extends EventEmitter {
  constructor(opts, env) {
    super();
    this.opts = opts; // { source, path, url, mode, language, modelId, prompt, quality }
    this.env = env;   // { dataDir, bins: { ffmpeg, ytdlp, whisperCpu, whisperGpu }, threads, pathEnv }
    this.id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
    this.rel = path.join('history', this.id);
    this.dir = path.join(env.dataDir, this.rel);
    this.child = null;
    this.cancelled = false;
    this.meta = { id: this.id, createdAt: new Date().toISOString(), mode: opts.mode, language: opts.language, model: opts.modelId, source: opts.source };
  }

  progress(stage, pct, extra = {}) { this.emit('progress', { id: this.id, stage, pct: Math.max(0, Math.min(100, pct)), ...extra }); }

  spawnTool(cmd, args, onLine) {
    return new Promise((resolve, reject) => {
      if (this.cancelled) return reject(new Error('Annullato'));
      const env = { ...process.env, PATH: this.env.pathEnv, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
      const ch = spawn(cmd, args, { cwd: this.env.dataDir, windowsHide: true, env });
      this.child = ch;
      let tail = '';
      const feed = (buf, stream) => {
        const s = buf.toString('utf8');
        tail = (tail + s).slice(-4000);
        s.split(/\r\n|\r|\n/).forEach((l) => l && onLine && onLine(l, stream));
      };
      ch.stdout.on('data', (b) => feed(b, 'out'));
      ch.stderr.on('data', (b) => feed(b, 'err'));
      ch.on('error', (e) => reject(new Error(`Impossibile avviare ${path.basename(cmd)}: ${e.message}`)));
      ch.on('close', (code) => {
        this.child = null;
        if (this.cancelled) return reject(new Error('Annullato'));
        if (code === 0) resolve(tail);
        else { const err = new Error(`${path.basename(cmd)} terminato con errore (${code})`); err.tail = tail; reject(err); }
      });
    });
  }

  cancel() {
    this.cancelled = true;
    if (this.child) { try { this.child.kill(); } catch {} }
  }

  async youtube() {
    this.progress('download', 0, { label: 'Download da YouTube' });
    const args = [this.opts.url, '--no-playlist', '-f', 'bestaudio/best', '--no-mtime', '--newline', '--encoding', 'utf-8',
      '--no-simulate', '--print', 'before_dl:TITLE:%(title)s', '--print', 'before_dl:DUR:%(duration)s',
      '-o', path.join(this.rel, 'source.%(ext)s')];
    await this.spawnTool(this.env.bins.ytdlp, args, (l) => {
      if (l.startsWith('TITLE:')) { this.meta.title = l.slice(6).trim(); this.emit('meta', this.meta); }
      else if (l.startsWith('DUR:')) this.meta.duration = parseFloat(l.slice(4)) || 0;
      const m = /\[download\]\s+([\d.]+)%/.exec(l);
      if (m) this.progress('download', parseFloat(m[1]), { label: 'Download da YouTube' });
    });
    const f = fs.readdirSync(this.dir).find((n) => n.startsWith('source.') && !n.endsWith('.part'));
    if (!f) throw new Error('Il download da YouTube non ha prodotto un file audio.');
    return path.join(this.rel, f);
  }

  async convert(srcArg) {
    this.progress('convert', 0, { label: 'Preparazione audio' });
    let dur = this.meta.duration || 0;
    await this.spawnTool(this.env.bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', srcArg, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', path.join(this.rel, 'audio.wav')], (l) => {
      if (!dur && /Duration:/.test(l)) { dur = hms(l.split('Duration:')[1]); this.meta.duration = dur; }
      const t = /time=(\d+:\d+:\d+\.\d+)/.exec(l);
      if (t && dur) this.progress('convert', (hms(t[1]) / dur) * 100, { label: 'Preparazione audio' });
    });
  }

  whisperArgs() {
    const o = this.opts;
    const a = ['-m', path.join('models', fileOf(o.modelId)), '-f', path.join(this.rel, 'audio.wav'),
      '-of', path.join(this.rel, 'out'), '-oj', '-pp', '-t', String(this.env.threads), '-l', o.language || 'auto'];
    if (o.quality === 'fast') a.push('-bs', '1', '-bo', '1');
    if (o.mode === 'song') a.push('-mc', '0', '-sns');
    const prompt = (o.prompt || '').trim();
    if (prompt) a.push('--prompt', prompt.slice(0, 600));
    return a;
  }

  async whisper(bin, isGpu) {
    const label = isGpu ? 'Trascrizione (GPU)' : 'Trascrizione (CPU)';
    this.progress('transcribe', 0, { label });
    const args = this.whisperArgs();
    if (!isGpu) args.push('-ng');
    await this.spawnTool(bin, args, (l, stream) => {
      const p = /progress\s*=\s*(\d+)%/.exec(l);
      if (p) return this.progress('transcribe', parseInt(p[1], 10), { label });
      const seg = /^\[(\d+:\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+)\]\s*(.*)$/.exec(l);
      if (seg && stream === 'out') {
        const end = hms(seg[2]);
        this.emit('segment', { id: this.id, start: hms(seg[1]) * 1000, end: end * 1000, text: seg[3].trim() });
        if (this.meta.duration) this.progress('transcribe', (end / this.meta.duration) * 100, { label });
      }
    });
  }

  async run() {
    fs.mkdirSync(this.dir, { recursive: true });
    const o = this.opts;
    let srcArg;
    if (o.source === 'youtube') {
      srcArg = await this.youtube();
      this.meta.audio = srcArg;
      this.meta.url = o.url;
    } else {
      srcArg = o.path;
      this.meta.title = path.basename(o.path).replace(/\.[^.]+$/, '');
      this.meta.originalPath = o.path;
      this.emit('meta', this.meta);
    }
    await this.convert(srcArg);

    // playback copy when the browser engine cannot play the original
    if (o.source !== 'youtube' && !PLAYABLE.includes(path.extname(o.path).toLowerCase())) {
      try {
        await this.spawnTool(this.env.bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', path.join(this.rel, 'audio.wav'), '-c:a', 'libmp3lame', '-b:a', '64k', path.join(this.rel, 'play.mp3')]);
        this.meta.audio = path.join(this.rel, 'play.mp3');
      } catch {}
    }

    const { whisperGpu, whisperCpu } = this.env.bins;
    if (whisperGpu) {
      try { await this.whisper(whisperGpu, true); this.meta.device = 'GPU'; }
      catch (e) {
        if (this.cancelled) throw e;
        this.emit('notice', 'La GPU non ha funzionato, riprovo con la CPU…');
        await this.whisper(whisperCpu, false); this.meta.device = 'CPU';
      }
    } else { await this.whisper(whisperCpu, false); this.meta.device = 'CPU'; }

    const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'out.json')).toString('utf8'));
    const segs = (raw.transcription || []).map((s) => ({ start: s.offsets.from, end: s.offsets.to, text: s.text }));
    this.meta.detectedLanguage = raw.result && raw.result.language;
    this.meta.segments = clean(segs, o.mode);
    this.meta.prompt = o.prompt || '';
    try { fs.unlinkSync(path.join(this.dir, 'audio.wav')); } catch {}
    try { fs.unlinkSync(path.join(this.dir, 'out.json')); } catch {}
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 1));
    this.progress('done', 100, { label: 'Fatto' });
    return this.meta;
  }
}

module.exports = { Job };
