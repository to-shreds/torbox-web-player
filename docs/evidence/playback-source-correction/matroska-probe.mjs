// Reproducible synthetic-only native HTML media decoding experiment.
// Run from repo root: CHROME_EXECUTABLE=/tmp/chromium node docs/evidence/playback-source-correction/matroska-probe.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, '../../..');
const scratch = process.env.CODEC_PROBE_DIR || '/tmp/torbox-codec-probe';
await mkdir(scratch, { recursive: true });
const fixture = join(root, 'test/fixtures/fixture.mp4');
function command(args) {
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
const commands = [
  ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', fixture, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-t', '12', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '96k', '-movflags', '+faststart', join(scratch, 'h264-aac.mp4')],
  ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', join(scratch, 'h264-aac.mp4'), '-map', '0', '-c', 'copy', join(scratch, 'h264-aac.mkv')],
  ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', fixture, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-t', '12', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'libopus', '-ac', '2', '-b:a', '96k', join(scratch, 'h264-opus.mkv')],
];
for (const args of commands) command(args);
const files = {};
for (const filename of ['h264-aac.mp4', 'h264-aac.mkv', 'h264-opus.mkv']) {
  const path = join(scratch, filename), bytes = await readFile(path);
  files[filename] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ffprobe: JSON.parse(command(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', path])) };
}
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><title>Synthetic codec probe</title><video id="video" controls width="320" height="180"></video>'); return; }
  const filename = url.pathname.slice(1);
  if (!files[filename]) { res.writeHead(404); res.end(); return; }
  const size = files[filename].size, mime = url.searchParams.get('mime') || 'application/octet-stream';
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  requests.push({ filename, mime, range: req.headers.range || null });
  res.writeHead(range ? 206 : 200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  createReadStream(join(scratch, filename), { start, end }).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.CHROME_EXECUTABLE || '/tmp/chromium';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], ignoreDefaultArgs: ['--mute-audio'] });
const cases = [
  { filename: 'h264-aac.mp4', mime: 'video/mp4' },
  { filename: 'h264-aac.mkv', mime: 'video/x-matroska' },
  { filename: 'h264-opus.mkv', mime: 'video/x-matroska' },
  { filename: 'h264-aac.mkv', mime: 'video/matroska' },
  { filename: 'h264-aac.mkv', mime: 'application/octet-stream' },
];
const results = [];
let capabilities;
try {
  for (const item of cases) {
    const context = await browser.newContext(), page = await context.newPage();
    const cdp = await context.newCDPSession(page), media = { properties: [], errors: [], events: [] };
    await cdp.send('Media.enable');
    cdp.on('Media.playerPropertiesChanged', event => media.properties.push(...event.properties));
    cdp.on('Media.playerErrorsRaised', event => media.errors.push(...event.errors));
    cdp.on('Media.playerEventsAdded', event => media.events.push(...event.events));
    await page.goto(origin);
    capabilities ||= await page.evaluate(() => {
      const video = document.querySelector('video');
      const types = ['video/mp4', 'video/mp4; codecs="avc1.64000a, mp4a.40.2"', 'video/x-matroska', 'video/matroska', 'video/x-matroska; codecs="avc1.64000a, mp4a.40.2"', 'video/x-matroska; codecs="avc1.64000a, opus"', 'video/webm', 'video/webm; codecs="avc1.64000a, mp4a.40.2"'];
      return { userAgent: navigator.userAgent, platform: navigator.platform, canPlayType: Object.fromEntries(types.map(type => [type, video.canPlayType(type)])), mediaSourceIsTypeSupported: Object.fromEntries(types.map(type => [type, MediaSource.isTypeSupported(type)])) };
    });
    const result = await page.evaluate(async ({ filename, mime }) => {
      const video = document.querySelector('video'), events = [], errors = [];
      let audioPeak = 0, signalSamples = 0, renderedFrames = 0, lastFrameMediaTime = null;
      const audioContext = new AudioContext(), analyser = audioContext.createAnalyser(), source = audioContext.createMediaElementSource(video);
      source.connect(analyser); analyser.connect(audioContext.destination); await audioContext.resume();
      const signal = new Float32Array(analyser.fftSize);
      const sample = setInterval(() => { analyser.getFloatTimeDomainData(signal); const peak = signal.reduce((best, value) => Math.max(best, Math.abs(value)), 0); audioPeak = Math.max(audioPeak, peak); if (peak > 0.0001) signalSamples++; }, 20);
      if (video.requestVideoFrameCallback) {
        const frame = (_, metadata) => { renderedFrames++; lastFrameMediaTime = metadata.mediaTime; video.requestVideoFrameCallback(frame); };
        video.requestVideoFrameCallback(frame);
      }
      for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'seeking', 'seeked', 'error']) video.addEventListener(event, () => { events.push({ event, currentTime: video.currentTime, readyState: video.readyState }); if (video.error) errors.push({ code: video.error.code, message: video.error.message }); });
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const until = async (predicate, ms) => { const deadline = performance.now() + ms; while (!predicate() && performance.now() < deadline) { if (video.error) return false; await delay(30); } return predicate(); };
      let playError = null;
      video.src = `/${filename}?mime=${encodeURIComponent(mime)}`;
      video.play().catch(error => { playError = { name: error.name, message: error.message }; });
      const initialPlayback = await until(() => video.currentTime > 1.05 && renderedFrames > 0 && signalSamples > 0, 6000);
      const initial = { currentTime: video.currentTime, duration: video.duration, readyState: video.readyState, renderedFrames, audioPeak, signalSamples, decodedVideoFrames: video.webkitDecodedFrameCount, decodedAudioBytes: video.webkitAudioDecodedByteCount, lastFrameMediaTime };
      let seek = null;
      if (initialPlayback) {
        video.pause(); video.currentTime = 6;
        const settled = await until(() => !video.seeking && Math.abs(video.currentTime - 6) < 0.15, 4000);
        await video.play().catch(error => { playError = { name: error.name, message: error.message }; });
        const advanced = await until(() => video.currentTime > 6.4 && lastFrameMediaTime >= 5.9, 4000);
        seek = { settled, advanced, currentTime: video.currentTime, renderedFrames, lastFrameMediaTime, audioPeak, signalSamples };
      }
      video.pause(); clearInterval(sample); await audioContext.close();
      return { initialPlayback, initial, seek, playError, errors, events };
    }, item);
    results.push({ ...item, ...result, mediaDiagnostics: media });
    console.log(JSON.stringify({ filename: item.filename, mime: item.mime, initialPlayback: result.initialPlayback, renderedFrames: result.initial.renderedFrames, audioPeak: result.initial.audioPeak, seek: result.seek, playError: result.playError, errors: result.errors }));
    await context.close();
  }
  const report = {
    experiment: 'Native Chromium HTMLVideoElement synthetic Matroska container and audio decode probe',
    sourceCommit: command(['git', '-C', root, 'rev-parse', 'HEAD']),
    browserVersion: await browser.version(),
    executablePath,
    capabilities,
    commands,
    files,
    results,
    requests,
    officialReference: 'https://www.chromium.org/audio-video/',
    limitations: ['Desktop Linux Chromium 141.0.7390.0 only; no physical Android/Chrome, device hardware decoder, or audio output listening verification.', 'Original repository fixture is synthetic H264 video only. A generated 440 Hz sine track supplies test AAC/Opus audio; no real episode or TorBox credentials are used.', 'Audio analyser nonzero PCM, decoded frames, advancing time, and successful seek exercise actual playback. canPlayType and MediaSource checks are recorded separately and do not decide actual native playback.', 'Small synthetic clips do not establish support for every Matroska file, codec profile, subtitle track, media size, range server, or CDN MIME header.'],
  };
  await writeFile(join(evidence, 'matroska-probe.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
