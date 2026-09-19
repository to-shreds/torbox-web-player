import { pbkdf2, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(pbkdf2);
export const ITERATIONS = 600000;
const pattern = /^pbkdf2-sha256\$600000\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export const validHash = value => typeof value === 'string' && pattern.test(value);
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256');
  return `pbkdf2-sha256$${ITERATIONS}$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || !validHash(encoded)) return false;
  const [, salt, expected] = pattern.exec(encoded);
  const actual = await derive(password, Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256');
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export const token = () => randomBytes(32).toString('base64url');
export const tokenDigest = text => createHash('sha256').update(text).digest('hex');
const digest = tokenDigest;
export class Sessions {
  constructor(now = Date.now) { this.now = now; this.rows = new Map(); }
  create() {
    this.prune();
    if (this.rows.size >= 100) return null;
    const id = token();
    const row = { id: digest(id), csrf: token(), expires: this.now() + 30 * 86400000, ownerUntil: 0 };
    this.rows.set(row.id, row);
    return { id, row };
  }
  read(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const row = this.rows.get(digest(id));
    if (!row || row.expires <= this.now()) { if (row) this.rows.delete(row.id); return null; }
    return row;
  }
  revoke(id) { this.rows.delete(id); }
  revokeAll() { this.rows.clear(); }
  prune() { for (const [id, row] of this.rows) if (row.expires <= this.now()) this.rows.delete(id); }
}

// Temporary guest links are intentionally process-local. A Render restart invalidates them.
export class GuestInvites {
  constructor(now = Date.now) { this.now = now; this.rows = new Map(); }
  create({ ownerId, scope, ttlMs = 6 * 3600000 } = {}) {
    this.prune();
    if (typeof ownerId !== 'string' || !scope || !['movie', 'series'].includes(scope.type) || !/^tt[0-9]{5,12}$/.test(scope.id || '')) return null;
    if (!Number.isFinite(ttlMs) || ttlMs < 15 * 60000 || ttlMs > 24 * 3600000 || this.rows.size >= 200) return null;
    const raw = token(), id = digest(raw);
    const row = { id, ownerId, scope: { ...scope }, expires: this.now() + ttlMs };
    this.rows.set(id, row);
    return { token: raw, row };
  }
  read(raw) {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const id = digest(raw), row = this.rows.get(id);
    if (!row || row.expires <= this.now()) { if (row) this.rows.delete(id); return null; }
    return row;
  }
  revoke(raw) { if (typeof raw === 'string') this.rows.delete(/^[a-f0-9]{64}$/.test(raw) ? raw : digest(raw)); }
  revokeOwner(ownerId) { for (const [id, row] of this.rows) if (row.ownerId === ownerId) this.rows.delete(id); }
  prune() { for (const [id, row] of this.rows) if (row.expires <= this.now()) this.rows.delete(id); }
}

// In-memory limits are intentionally process-local in this integration checkpoint.
export class Limiter {
  constructor(limit, windowMs, now = Date.now) { Object.assign(this, { limit, windowMs, now }); this.rows = new Map(); }
  allow(key) {
    const time = this.now();
    for (const [id, row] of this.rows) if (time >= row.until) this.rows.delete(id);
    let row = this.rows.get(key);
    if (!row) {
      if (this.rows.size >= 5000) return false;
      row = { count: 0, until: time + this.windowMs }; this.rows.set(key, row);
    }
    row.count++;
    return row.count <= this.limit;
  }
}
