import { createHash, randomBytes } from 'node:crypto';
import { AppError, normalizeItem, mediaIdentityForFile } from './torbox.mjs';
import { targetOf } from '../public/source-client.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ROOM = /^[A-Za-z0-9_-]{16}$/;
const fail = (code, message, status = 400) => { throw new AppError(code, message, status); };
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
const durationOk = value => Number.isFinite(value) && value > 0 && value <= 86400;
const positionOk = (value, duration) => Number.isFinite(value) && value >= 0 && value <= duration;
export const samePartyMedia = (one, two) => !!one && !!two && one.kind === 'torrent' && two.kind === 'torrent' && one.hash === two.hash && one.path === two.path && one.size === two.size;

// Rooms contain only control metadata. Provider keys and media links never enter this store.
export class WatchParties {
  constructor(now = Date.now, { ttlMs = 6 * 3600000, presenceMs = 10000, startDelayMs = 2000, proofTtlMs = 30 * 60000, maxRooms = 100, maxProofs = 500 } = {}) {
    Object.assign(this, { now, ttlMs, presenceMs, startDelayMs, proofTtlMs, maxRooms, maxProofs });
    this.rooms = new Map(); this.invites = new Map(); this.proofs = new Map();
  }
  issuePlayback(sessionId, file, identity) {
    this.prune();
    // A new playback always invalidates the earlier playback's authority, even for the same file.
    this.proofs.delete(sessionId);
    // The host connection authorizes the shared file. Replacing that playback ends
    // its room, rather than leaving a guest authorized for an abandoned video.
    for (const room of this.rooms.values()) if (room.host.sessionId === sessionId) this.remove(room);
    for (const room of this.rooms.values()) for (const member of [room.host, room.guest]) if (member?.sessionId === sessionId) {
      member.proof = ''; member.ready = false; member.blocked = true;
      this.pause(room, 'Playback changed. Waiting for both players.'); room.revision++;
    }
    if (!identity || !file?.id) return null;
    if (this.proofs.size >= this.maxProofs) fail('WATCH_PARTY_CAPACITY', 'Too many temporary playback records are open. Try again later.', 429);
    const proof = randomBytes(32).toString('base64url');
    this.proofs.set(sessionId, { proof: digest(proof), identity: { ...identity }, file: { id: file.id, title: text(file.title, 700) }, expires: this.now() + this.proofTtlMs });
    return proof;
  }
  proof(sessionId, raw, identity = null, member = null) {
    if (!TOKEN.test(raw || '')) fail('WATCH_PARTY_PLAYBACK_REQUIRED', 'Open this party’s exact video before marking it ready.', 409);
    const hashed = digest(raw), row = this.proofs.get(sessionId);
    // Once bound, a long movie may keep using the same proof past its initial creation window.
    const bound = member?.proof === hashed && row?.proof === hashed;
    if (!row || row.proof !== hashed || (!bound && row.expires <= this.now())) fail('WATCH_PARTY_PLAYBACK_REQUIRED', 'This playback changed or expired. Open the party video again.', 409);
    if (identity && !samePartyMedia(row.identity, identity)) fail('WATCH_PARTY_MEDIA_MISMATCH', 'This is a different video file or version. Load the party’s exact version.', 409);
    return row;
  }
  member(sessionId) { return { sessionId, lastSeen: this.now(), ready: false, buffering: false, blocked: false, position: null, duration: null, proof: '', commandSeq: 0, preparing: null, prepareState: { uncertain: false } }; }
  create(sessionId, data) {
    this.prune();
    const playback = this.proof(sessionId, data.playbackProof);
    let target; try { target = targetOf(data.target); } catch { fail('WATCH_PARTY_TARGET_REQUIRED', 'Start a movie or episode before creating a watch party.'); }
    if (!durationOk(data.duration) || !positionOk(data.position, data.duration)) fail('WATCH_PARTY_BAD_POSITION', 'Wait until the video is ready before creating a party.');
    this.detachSession(sessionId);
    if (this.rooms.size >= this.maxRooms) fail('WATCH_PARTY_CAPACITY', 'Too many watch parties are open. Try again later.', 429);
    const id = randomBytes(12).toString('base64url'), token = randomBytes(32).toString('base64url'), now = this.now();
    const room = { id, invite: digest(token), expires: now + this.ttlMs, revision: 1, allowAccountKeyInPlayback: data.allowAccountKeyInPlayback === true,
      media: { identity: { ...playback.identity }, target, title: text(data.title, 300) || playback.file.title, fileTitle: playback.file.title, duration: data.duration },
      host: this.member(sessionId), guest: null,
      state: { playing: false, position: data.position, at: now, rate: 1, wantsPlay: false, reason: 'Waiting for a second viewer.' } };
    room.host.proof = playback.proof; room.host.position = data.position; room.host.duration = data.duration;
    this.rooms.set(id, room); this.invites.set(room.invite, id);
    return { ...this.snapshot(room, sessionId), joinToken: token };
  }
  join(sessionId, raw) {
    const room = this.invited(raw);
    if (room.host.sessionId === sessionId) return this.snapshot(room, sessionId);
    if (room.guest && room.guest.sessionId !== sessionId) {
      if (this.present(room.guest)) fail('WATCH_PARTY_FULL', 'This two-person watch party already has two viewers.', 409);
      // A lost join response must not reserve the second seat for the room's lifetime.
      // Replacing an absent guest ends the prior membership and holds the timeline.
      room.guest = null; room.state.wantsPlay = false;
      this.pause(room, 'The disconnected viewer was replaced. Playback is paused.'); room.revision++;
    }
    if (!room.guest) {
      this.detachSession(sessionId);
      room.guest = this.member(sessionId); room.revision++;
      this.pause(room, 'Loading the same video for the second viewer.');
    } else room.guest.lastSeen = this.now();
    return this.snapshot(room, sessionId);
  }
  invited(raw) {
    this.prune();
    const id = TOKEN.test(raw || '') ? this.invites.get(digest(raw)) : null, room = id ? this.rooms.get(id) : null;
    if (!room) fail('WATCH_PARTY_NOT_FOUND', 'This watch party ended or its link expired.', 404);
    return room;
  }
  get(id, sessionId) {
    this.prune();
    const room = ROOM.test(id || '') ? this.rooms.get(id) : null;
    if (!room || (room.host.sessionId !== sessionId && room.guest?.sessionId !== sessionId)) fail('WATCH_PARTY_NOT_FOUND', 'This watch party ended or is no longer available.', 404);
    return { room, member: room.host.sessionId === sessionId ? room.host : room.guest };
  }
  target(room, now = this.now()) {
    return Math.min(room.media.duration, room.state.position + (room.state.playing ? Math.max(0, now - room.state.at) / 1000 : 0));
  }
  pause(room, reason) {
    const position = this.target(room), changed = room.state.playing || room.state.reason !== reason;
    if (changed) { room.state = { ...room.state, playing: false, position, at: this.now(), reason }; room.revision++; }
  }
  present(member) { return !!member && this.now() - member.lastSeen <= this.presenceMs; }
  reconcile(room) {
    if (room.state.playing && this.target(room) >= room.media.duration) {
      room.state = { playing: false, position: room.media.duration, at: this.now(), rate: 1, wantsPlay: false, reason: 'Finished.' }; room.revision++; return;
    }
    const members = [room.host, room.guest];
    if (members.some(member => !this.present(member))) { this.pause(room, room.guest ? 'A viewer disconnected. Playback is paused.' : 'Waiting for a second viewer.'); return; }
    if (members.some(member => member.buffering || member.blocked || !member.ready)) { this.pause(room, members.some(member => member.buffering) ? 'A viewer is buffering. Playback is paused.' : 'Waiting for both players to be ready.'); return; }
    if (room.state.wantsPlay && !room.state.playing) {
      // Both clients must seek to the paused anchor before the coordinated countdown begins.
      if (members.some(member => !Number.isFinite(member.position) || Math.abs(member.position - room.state.position) > .75)) return;
      room.state = { ...room.state, playing: true, at: this.now() + this.startDelayMs, reason: 'Starting together.' }; room.revision++;
    }
  }
  sync(sessionId, data) {
    const { room, member } = this.get(data.roomId, sessionId);
    if (![data.ready, data.buffering, data.blocked].every(value => typeof value === 'boolean') || !durationOk(data.duration) || !positionOk(data.position, room.media.duration)) fail('WATCH_PARTY_BAD_STATUS', 'The player’s synchronization status could not be read.');
    if (Math.abs(data.duration - room.media.duration) > 1) {
      member.ready = false; member.blocked = true; this.pause(room, 'The players reported different video durations.');
      fail('WATCH_PARTY_DURATION_MISMATCH', 'The players reported different video durations. Reopen the exact party video.', 409);
    }
    if (data.playbackProof) {
      const playback = this.proof(sessionId, data.playbackProof, room.media.identity, member); member.proof = playback.proof;
    }
    const latest = this.proofs.get(sessionId);
    if ((!member.proof || latest?.proof !== member.proof || !samePartyMedia(latest.identity, room.media.identity)) && data.ready) {
      member.ready = false; member.blocked = true; this.pause(room, 'Waiting for the party’s exact video.');
      fail('WATCH_PARTY_PLAYBACK_REQUIRED', 'Load the party’s exact video to synchronize playback.', 409);
    }
    const changed = member.ready !== data.ready || member.buffering !== data.buffering || member.blocked !== data.blocked || !this.present(member);
    member.lastSeen = this.now(); member.ready = data.ready; member.buffering = data.buffering; member.blocked = data.blocked; member.position = data.position; member.duration = data.duration;
    if (changed) room.revision++;
    if (data.command !== undefined) {
      const command = data.command;
      if (!member.proof || latest?.proof !== member.proof || !samePartyMedia(latest.identity, room.media.identity)) fail('WATCH_PARTY_PLAYBACK_REQUIRED', 'Load the party’s exact video before controlling playback.', 409);
      if (!command || !Number.isSafeInteger(command.seq) || command.seq < 1 || !['play', 'pause', 'seek'].includes(command.type) || !positionOk(command.position, room.media.duration)) fail('WATCH_PARTY_BAD_COMMAND', 'This playback control could not be synchronized.');
      if (command.seq > member.commandSeq) {
        member.commandSeq = command.seq;
        const position = command.position;
        const wantsPlay = command.type === 'play' ? true : command.type === 'pause' ? false : room.state.wantsPlay;
        room.state = { playing: false, position, at: this.now(), rate: 1, wantsPlay, reason: command.type === 'pause' ? 'Paused by a viewer.' : 'Synchronizing both players.' };
        room.revision++;
      }
    }
    this.reconcile(room);
    return this.snapshot(room, sessionId);
  }
  async prepare(sessionId, id, load) {
    const { room, member } = this.get(id, sessionId);
    member.lastSeen = this.now(); member.ready = false;
    this.pause(room, 'Loading the party’s exact video.');
    if (!member.preparing) member.preparing = Promise.resolve().then(() => load(room.media.identity, member.prepareState)).finally(() => { member.preparing = null; });
    const file = await member.preparing;
    const current = this.get(id, sessionId);
    if (current.room !== room || current.member !== member) fail('WATCH_PARTY_NOT_FOUND', 'This watch party ended while the video was loading.', 404);
    return { ...this.snapshot(room, sessionId), file, playbackContext: { title: room.media.title, current: { ...room.media.target }, sourceInfo: { hash: room.media.identity.hash, filename: room.media.identity.path }, queue: [], forceStartOver: true, partyPosition: room.state.position } };
  }
  snapshot(room, sessionId) {
    const now = this.now(), memberView = member => member ? { present: this.present(member), ready: member.ready, buffering: member.buffering, position: member.position } : null;
    const phase = room.state.playing ? now < room.state.at ? 'scheduled' : 'playing' : room.state.position >= room.media.duration && !room.state.wantsPlay ? 'ended' : !room.guest ? 'waiting' : [room.host, room.guest].some(member => !this.present(member)) ? 'disconnected' : [room.host, room.guest].some(member => member.buffering) ? 'buffering' : 'paused';
    const state = { ...room.state, phase };
    return { serverTime: now, room: { id: room.id, role: room.host.sessionId === sessionId ? 'host' : 'guest', revision: room.revision, expiresAt: room.expires, media: structuredClone(room.media), state, members: { host: memberView(room.host), guest: memberView(room.guest) } } };
  }
  leave(sessionId, id) {
    const { room } = this.get(id, sessionId);
    if (room.host.sessionId === sessionId) this.remove(room);
    else { room.guest = null; room.state.wantsPlay = false; this.pause(room, 'The other viewer left. Waiting for a second viewer.'); room.revision++; }
    return { ok: true, serverTime: this.now() };
  }
  remove(room) { this.rooms.delete(room.id); this.invites.delete(room.invite); }
  detachSession(sessionId) {
    for (const room of this.rooms.values()) {
      if (room.host.sessionId === sessionId) this.remove(room);
      else if (room.guest?.sessionId === sessionId) { room.guest = null; room.state.wantsPlay = false; this.pause(room, 'The other viewer left.'); room.revision++; }
    }
  }
  revokeSession(sessionId) { this.detachSession(sessionId); this.proofs.delete(sessionId); }
  clear() { this.rooms.clear(); this.invites.clear(); this.proofs.clear(); }
  prune() {
    for (const room of this.rooms.values()) if (room.expires <= this.now()) this.remove(room);
    // Keep bound proofs for long-running rooms; unbound expired proofs can be discarded.
    for (const [id, proof] of this.proofs) if (proof.expires <= this.now() && ![...this.rooms.values()].some(room => room.host.sessionId === id || room.guest?.sessionId === id)) this.proofs.delete(id);
  }
}

// A hosted party already has an exact selected file in the host account. Guests
// may only reopen that file; a missing item must never create a new torrent.
export async function prepareHostedPartyFile(identity, videoId, provider) {
  const resolved = await provider.resolveFile(videoId);
  if (!samePartyMedia(resolved.mediaIdentity, identity)) fail('WATCH_PARTY_MEDIA_MISMATCH', 'The host’s selected file changed. Ask them to create a new watch party.', 409);
  return resolved.file;
}

export async function prepareExactPartyFile(identity, gateway, state = {}) {
  let item = await gateway.find(identity.hash);
  if (!item) {
    if (state.uncertain) fail('WATCH_PARTY_PREPARE_UNCERTAIN', 'TorBox has not confirmed the earlier preparation. Check again later; no duplicate request was sent.', 409);
    const cached = await gateway.cached([identity.hash]);
    if (!cached[identity.hash]) fail('WATCH_PARTY_NOT_CACHED', 'The party’s exact video is no longer cached in TorBox. Choose another version together.', 409);
    let id;
    try { id = await gateway.create(identity.hash, true); }
    catch (error) { if (error?.code === 'CREATE_UNCERTAIN') state.uncertain = true; throw error; }
    item = await gateway.item(id);
  }
  if (item.download_finished !== true || item.download_present !== true) fail('WATCH_PARTY_PREPARING', 'TorBox is still preparing the party’s exact video. Check again in a moment.', 409);
  const matches = (Array.isArray(item.files) ? item.files.slice(0, 2000) : []).filter(file => samePartyMedia(mediaIdentityForFile('torrents', item, file), identity));
  if (matches.length !== 1) fail('WATCH_PARTY_MEDIA_MISMATCH', 'TorBox could not match the party’s exact file and byte size. No other version was selected.', 409);
  const file = normalizeItem('torrents', item).find(row => row.id === `torrents:${item.id}:${matches[0].id}`);
  if (!file) fail('WATCH_PARTY_MEDIA_MISMATCH', 'The exact party file is not a playable video.', 409);
  return file;
}
