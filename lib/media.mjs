import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './torbox.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;
const FILE_TYPES = Object.freeze({
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mov: 'video/quicktime',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg'
});

export class MediaTickets {
  constructor(now = Date.now, { ttlMs = 4 * 60 * 60 * 1000, max = 1024, perSession = 8 } = {}) {
    Object.assign(this, { now, ttlMs, max, perSession });
    this.rows = new Map();
  }
  create(sessionId, videoId, upstreamUrl, file = {}) {
    this.prune();
    const previous = [...this.rows.values()].filter(row => row.sessionId === sessionId);
    while (previous.length >= this.perSession) this.rows.delete(previous.shift().id);
    if (this.rows.size >= this.max) throw new AppError('MEDIA_TICKET_LIMIT', 'Too many playback sessions are open. Close another player and try again.', 429);
    const token = randomBytes(32).toString('base64url');
    const row = {
      id: digest(token),
      sessionId,
      videoId,
      upstreamUrl,
      fileTitle: typeof file?.title === 'string' ? file.title.slice(0, 700) : '',
      expires: this.now() + this.ttlMs,
      startReported: false
    };
    this.rows.set(row.id, row);
    return token;
  }
  readAny(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const row = this.rows.get(digest(token));
    if (!row || row.expires <= this.now()) {
      if (row) this.rows.delete(row.id);
      return null;
    }
    return row;
  }
  read(token, sessionId) {
    const row = this.readAny(token);
    return row && row.sessionId === sessionId ? row : null;
  }
  revokeSession(sessionId) { for (const [id, row] of this.rows) if (row.sessionId === sessionId) this.rows.delete(id); }
  revokeAll() { this.rows.clear(); }
  prune() { for (const [id, row] of this.rows) if (row.expires <= this.now()) this.rows.delete(id); }
}

export function validatedRange(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 100 || !RANGE.test(value.trim())) throw new AppError('BAD_RANGE', 'This media range request is not supported.', 416);
  const range = value.trim(), [start, end] = range.slice(6).split('-');
  if ((start && !Number.isSafeInteger(Number(start))) || (end && !Number.isSafeInteger(Number(end))) ||
      (!start && Number(end) <= 0) || (start && end && Number(end) < Number(start))) {
    throw new AppError('BAD_RANGE', 'This media range request is not supported.', 416);
  }
  return range;
}

export function fallbackMediaType(title) {
  const extension = /\.([a-z0-9]{2,6})$/i.exec(title || '')?.[1]?.toLowerCase();
  return FILE_TYPES[extension] || '';
}
