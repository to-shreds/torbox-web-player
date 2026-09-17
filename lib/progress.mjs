import { randomUUID } from 'node:crypto';
export const VIEWERS = Object.freeze([{ id: 'viewer-1', name: 'Viewer 1' }, { id: 'viewer-2', name: 'Viewer 2' }]);
export function validViewer(id) { return VIEWERS.some(row => row.id === id); }
// A replaceable store interface, deliberately NOT durable until Postgres is connected.
export class ProgressStore {
  constructor() { this.rows = new Map(); this.leases = new Map(); this.intents = new Map(); }
  beginIntent(viewer) { const id = randomUUID(); this.intents.set(viewer, id); return id; }
  isCurrent(viewer, intent) { return this.intents.get(viewer) === intent; }
  start(viewer, videoId, { reset = false, sessionId } = {}) {
    const key = `${viewer}/${videoId}`;
    if (this.rows.size >= 5000 && !this.rows.has(key)) throw new Error('PROGRESS_CAPACITY');
    // A viewer has one current playback. Different viewers never share this lease.
    const lease = { id: randomUUID(), videoId, sessionId, seq: 0 };
    this.leases.set(viewer, lease);
    if (reset) this.rows.delete(key);
    return { leaseId: lease.id, progress: this.read(viewer, videoId) };
  }
  read(viewer, videoId) { return this.rows.get(`${viewer}/${videoId}`) || { position: 0, duration: 0 }; }
  write(viewer, { videoId, leaseId, seq, position, duration }, sessionId) {
    const lease = this.leases.get(viewer);
    if (!lease || lease.id !== leaseId || lease.videoId !== videoId || lease.sessionId !== sessionId || !Number.isSafeInteger(seq) || seq <= lease.seq) return false;
    if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0 || duration > 7 * 86400 || position > duration + 2) return false;
    const key = `${viewer}/${videoId}`, old = this.read(viewer, videoId);
    // Loading/pause-at-zero must not erase a resume point. Start over is a distinct action.
    if (position < 1 && old.position >= 1) return false;
    lease.seq = seq;
    this.rows.set(key, { position: Math.min(position, duration), duration, updatedAt: new Date().toISOString() });
    return true;
  }
}
