import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from './torbox.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;

export class MediaTickets {
  constructor(now = Date.now, { ttlMs = 4 * 60 * 60 * 1000, max = 100 } = {}) {
    Object.assign(this, { now, ttlMs, max });
    this.rows = new Map();
  }
  create(sessionId, videoId, upstreamUrl) {
    this.prune();
    if (this.rows.size >= this.max) throw new AppError('MEDIA_TICKET_LIMIT', 'Too many playback sessions are open. Close another player and try again.', 429);
    const token = randomBytes(32).toString('base64url');
    const row = { id: digest(token), sessionId, videoId, upstreamUrl, expires: this.now() + this.ttlMs };
    this.rows.set(row.id, row);
    return token;
  }
  readAny(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const row = this.rows.get(digest(token));
    if (!row || row.expires <= this.now()) {
      if (row && row.expires <= this.now()) this.rows.delete(row.id);
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
  return value.trim();
}

const copyHeaders = (upstream, response) => {
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
};

async function openUpstream(fetchFn, url, method, range, controller) {
  const headers = {};
  if (range) headers.Range = range;
  let upstream;
  try {
    upstream = await fetchFn(url, { method, headers, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new AppError('MEDIA_INTERRUPTED', 'The media connection closed.', 499);
    if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new AppError('MEDIA_TIMEOUT', 'TorBox took too long to start the media stream.', 504);
    throw new AppError('MEDIA_CONNECTION_ERROR', 'The server could not reach the TorBox media server.', 502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel().catch(() => {});
    throw new AppError('MEDIA_REDIRECT_BLOCKED', 'TorBox returned an unexpected media redirect.', 502);
  }
  return upstream;
}

export async function relayMedia({ request, response, ticket, provider, fetchFn = fetch }) {
  const method = request.method;
  if (!['GET', 'HEAD'].includes(method)) throw new AppError('METHOD_NOT_ALLOWED', 'This media request method is not allowed.', 405);
  const range = validatedRange(request.headers.range);

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', abort);
    let upstream;
    try {
      upstream = await openUpstream(fetchFn, ticket.upstreamUrl, method, range, controller);
      if (attempt === 0 && [400, 401, 403].includes(upstream.status)) {
        await upstream.body?.cancel().catch(() => {});
        const fresh = await provider.resolveForRelay(ticket.videoId);
        ticket.upstreamUrl = fresh.upstreamUrl;
        continue;
      }
      if (![200, 206, 416].includes(upstream.status)) {
        await upstream.body?.cancel().catch(() => {});
        throw new AppError('MEDIA_UPSTREAM_ERROR', 'TorBox could not serve this media request.', 502);
      }

      copyHeaders(upstream, response);
      response.statusCode = upstream.status;
      if (method === 'HEAD' || upstream.status === 416 || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        response.end();
        return;
      }
      await pipeline(Readable.fromWeb(upstream.body), response);
      return;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (!response.headersSent) throw new AppError('MEDIA_CONNECTION_ERROR', 'The media stream was interrupted before it started.', 502);
      throw error;
    } finally {
      response.off('close', abort);
    }
  }
  throw new AppError('MEDIA_LINK_EXPIRED', 'TorBox could not renew this playback link.', 502);
}
