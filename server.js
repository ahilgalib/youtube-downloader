// YouTube Downloader — for educational purposes only.
// Small Express server that wraps yt-dlp + ffmpeg.
const express = require('express');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const ffmpegPath = require('ffmpeg-static');

const PORT = process.env.PORT || 3000;
const BIN_DIR = path.join(__dirname, 'bin');
const JOBS_DIR = path.join(__dirname, 'downloads');
const IS_WIN = process.platform === 'win32';
const YTDLP = process.env.YTDLP_PATH || path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' +
  (IS_WIN ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux');

fs.mkdirSync(BIN_DIR, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

// ---------- yt-dlp bootstrap ----------
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'yt-downloader' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && redirects < 10) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureYtdlp() {
  if (fs.existsSync(YTDLP)) {
    // keep it fresh — YouTube changes often
    spawn(YTDLP, ['-U'], { stdio: 'ignore' }).on('error', () => {});
    return;
  }
  console.log('Downloading yt-dlp …');
  await download(YTDLP_URL, YTDLP);
  if (!IS_WIN) fs.chmodSync(YTDLP, 0o755);
  console.log('yt-dlp ready.');
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(cleanErr(err)))));
  });
}

const cleanErr = s =>
  (s.split('\n').filter(l => l.startsWith('ERROR')).pop() || s.trim().split('\n').pop() || 'Unknown error')
    .replace(/^ERROR:\s*/, '').slice(0, 300);

const isYouTube = u => /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(u || '');

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Video info + available qualities
app.post('/api/info', async (req, res) => {
  const { url } = req.body || {};
  if (!isYouTube(url)) return res.status(400).json({ error: 'Please paste a valid YouTube link.' });
  try {
    const j = JSON.parse(await run(['-J', '--no-playlist', '--no-warnings', url]));
    const formats = j.formats || [];

    const heights = {};
    for (const f of formats) {
      if (!f.height || f.vcodec === 'none') continue;
      const h = heights[f.height] || (heights[f.height] = { height: f.height, fps: 0, size: 0, codecs: new Set() });
      h.fps = Math.max(h.fps, f.fps || 0);
      h.size = Math.max(h.size, f.filesize || f.filesize_approx || 0);
      h.codecs.add((f.vcodec || '').split('.')[0]);
    }
    const bestAudio = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none')
      .reduce((a, f) => Math.max(a, f.filesize || f.filesize_approx || 0), 0);

    res.json({
      id: j.id,
      title: j.title,
      channel: j.channel || j.uploader,
      duration: j.duration,
      views: j.view_count,
      thumbnail: j.thumbnail,
      chapters: (j.chapters || []).length,
      qualities: Object.values(heights)
        .sort((a, b) => b.height - a.height)
        .map(h => ({ height: h.height, fps: Math.round(h.fps), size: h.size ? h.size + bestAudio : 0, codecs: [...h.codecs] })),
      audioSize: bestAudio,
      subtitles: Object.keys(j.subtitles || {}).filter(l => l !== 'live_chat'),
      autoSubtitles: Object.keys(j.automatic_captions || {}).filter(l => !l.includes('-')).slice(0, 60),
      formats: formats
        .filter(f => f.format_id && f.ext !== 'mhtml')
        .map(f => ({
          id: f.format_id, ext: f.ext, res: f.resolution, fps: f.fps,
          vcodec: f.vcodec, acodec: f.acodec, tbr: f.tbr, size: f.filesize || f.filesize_approx || 0, note: f.format_note,
        })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- jobs ----------
const jobs = new Map();

function buildArgs(o, dir) {
  const a = ['--no-playlist', '--newline', '--no-colors', '--ffmpeg-location', ffmpegPath,
    '--progress-template', 'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s'];

  const tpl = (o.filename || '%(title)s').replace(/[\\/]/g, '_').slice(0, 120);
  a.push('-o', path.join(dir, tpl + '.%(ext)s'), '--windows-filenames');

  if (o.mode === 'audio') {
    a.push('-f', o.formatId || 'ba/b', '-x');
    if (o.audioFormat && o.audioFormat !== 'best') a.push('--audio-format', o.audioFormat);
    if (o.audioQuality) a.push('--audio-quality', o.audioQuality);
  } else {
    const sort = [];
    if (o.height && o.height !== 'best') sort.push('res:' + parseInt(o.height, 10));
    if (o.fps) sort.push('fps:' + parseInt(o.fps, 10));
    if (o.vcodec && o.vcodec !== 'any') sort.push('vcodec:' + o.vcodec);
    if (o.container === 'mp4') sort.push('acodec:m4a');
    a.push('-f', o.formatId || 'bv*+ba/b');
    if (sort.length && !o.formatId) a.push('-S', sort.join(','));
    if (o.container && o.container !== 'auto') a.push('--merge-output-format', o.container);
    if (o.subs) {
      a.push('--embed-subs', '--sub-langs', o.subs);
      if (o.autoSubs) a.push('--write-auto-subs'); else a.push('--write-subs');
    }
    if (o.chapters) a.push('--embed-chapters');
  }

  if (o.start || o.end) {
    a.push('--download-sections', `*${o.start || '0'}-${o.end || 'inf'}`, '--force-keyframes-at-cuts');
  }
  if (o.thumbnail) a.push('--embed-thumbnail');
  if (o.metadata) a.push('--embed-metadata');
  if (Array.isArray(o.sponsorblock) && o.sponsorblock.length) {
    const ok = ['sponsor', 'intro', 'outro', 'selfpromo', 'preview', 'filler', 'interaction', 'music_offtopic'];
    const cats = o.sponsorblock.filter(c => ok.includes(c));
    if (cats.length) a.push('--sponsorblock-remove', cats.join(','));
  }
  if (o.rateLimit && /^\d+(\.\d+)?[KMG]?$/i.test(o.rateLimit)) a.push('-r', o.rateLimit);
  a.push(o.url);
  return a;
}

const TIME_RE = /^(\d{1,2}:)?(\d{1,2}:)?\d{1,5}(\.\d+)?$/;

app.post('/api/download', (req, res) => {
  const o = req.body || {};
  if (!isYouTube(o.url)) return res.status(400).json({ error: 'Invalid YouTube link.' });
  if ((o.start && !TIME_RE.test(o.start)) || (o.end && !TIME_RE.test(o.end)))
    return res.status(400).json({ error: 'Trim time must look like 1:30 or 90.' });
  if (o.formatId && !/^[\w+\-/\[\]<>=.*]+$/.test(o.formatId))
    return res.status(400).json({ error: 'Invalid format ID.' });
  if (o.subs && !/^[\w\-.,*]+$/.test(o.subs)) return res.status(400).json({ error: 'Invalid subtitle language.' });
  if (o.audioQuality && !/^\d{1,3}K?$/i.test(o.audioQuality)) return res.status(400).json({ error: 'Invalid audio quality.' });

  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(JOBS_DIR, id);
  fs.mkdirSync(dir);
  const job = { id, dir, status: 'starting', stage: 'Starting', percent: 0, speed: '', eta: '', streams: 0, created: Date.now() };
  jobs.set(id, job);

  const p = spawn(YTDLP, buildArgs(o, dir), { windowsHide: true });
  let errBuf = '';
  const onLine = line => {
    if (line.startsWith('PROG|')) {
      const [, pct, speed, eta] = line.split('|');
      job.status = 'downloading';
      job.percent = parseFloat(pct) || 0;
      job.speed = (speed || '').trim();
      job.eta = (eta || '').trim();
    } else if (line.includes('[download] Destination:')) {
      job.streams++;
      job.stage = job.streams > 1 ? `Downloading stream ${job.streams}` : 'Downloading';
    } else if (line.startsWith('[Merger]')) { job.stage = 'Merging'; job.status = 'processing'; }
    else if (line.startsWith('[ExtractAudio]')) { job.stage = 'Converting audio'; job.status = 'processing'; }
    else if (line.startsWith('[SponsorBlock]') || line.startsWith('[ModifyChapters]')) { job.stage = 'Removing segments'; job.status = 'processing'; }
    else if (line.startsWith('[EmbedThumbnail]') || line.startsWith('[Metadata]') || line.startsWith('[EmbedSubtitle]')) { job.stage = 'Finishing'; job.status = 'processing'; }
  };
  let buf = '';
  p.stdout.on('data', d => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    lines.forEach(onLine);
  });
  p.stderr.on('data', d => (errBuf += d));
  p.on('error', e => Object.assign(job, { status: 'error', error: e.message }));
  p.on('close', code => {
    const files = fs.readdirSync(dir)
      .filter(f => !/\.(part|ytdl|temp|webp|jpg|png|vtt|srt)$/i.test(f))
      .map(f => ({ f, s: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => b.s - a.s);
    if (code === 0 && files.length) {
      Object.assign(job, { status: 'done', stage: 'Ready', percent: 100, file: files[0].f, size: files[0].s });
    } else {
      Object.assign(job, { status: 'error', error: cleanErr(errBuf) || 'Download failed.' });
    }
  });
  job.proc = p;
  res.json({ id });
});

app.get('/api/progress/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  const { proc, dir, ...pub } = j;
  res.json(pub);
});

app.get('/api/file/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done') return res.status(404).send('Not ready.');
  res.download(path.join(j.dir, j.file), j.file);
});

app.delete('/api/job/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (j) { try { j.proc && j.proc.kill(); } catch {} removeJob(j); }
  res.json({ ok: true });
});

function removeJob(j) {
  jobs.delete(j.id);
  setTimeout(() => fs.rm(j.dir, { recursive: true, force: true }, () => {}), 1000);
}

// clean up jobs older than 1 hour
setInterval(() => {
  for (const j of jobs.values()) if (Date.now() - j.created > 3600e3) removeJob(j);
}, 600e3);

ensureYtdlp()
  .then(() => app.listen(PORT, () => console.log(`\n  YouTube Downloader → http://localhost:${PORT}\n`)))
  .catch(e => { console.error('Could not get yt-dlp:', e.message); process.exit(1); });
