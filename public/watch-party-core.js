// This module does not touch a video element or send requests. Corrections are
// local playback adjustments, never commands to publish back to the room.
const PHASES = new Set(['waiting','paused','scheduled','playing','buffering','disconnected','ended']);
const ROOM_ID = /^[A-Za-z0-9_-]{16}$/;
const IMDB_ID = /^tt\d{5,12}$/;
const DAY_SECONDS = 86400;
const MAX_EPOCH = 8.64e15;

function invalid() { throw new Error('The watch party state is invalid.'); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value, maximum, minimum = 0) { return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum; }
function integer(value, minimum, maximum) { return Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function label(value, maximum) { return typeof value === 'string' && value.trim() && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null; }
function epoch(value) { return bounded(value,MAX_EPOCH,1); }
function clamp(value, minimum, maximum) { return Math.min(maximum,Math.max(minimum,value)); }

export function normalizePartyIdentity(raw) {
  if (!record(raw) || raw.kind !== 'torrent' || typeof raw.hash !== 'string' || !/^[a-fA-F0-9]{40}$/.test(raw.hash) || !integer(raw.size,1,Number.MAX_SAFE_INTEGER) || typeof raw.path !== 'string' || raw.path.length > 2048 || /[\x00-\x1f\x7f]/.test(raw.path)) invalid();
  const path = raw.path.replace(/\\/g,'/').replace(/^(?:\.\/)+/,'');
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) invalid();
  return {kind:'torrent',hash:raw.hash.toLowerCase(),path,size:raw.size};
}

export function normalizePartyMedia(raw) {
  if (!record(raw) || !record(raw.target) || !['movie','series'].includes(raw.target.type) || typeof raw.target.id !== 'string' || !IMDB_ID.test(raw.target.id) || !bounded(raw.duration,DAY_SECONDS,Number.MIN_VALUE)) invalid();
  const identity = normalizePartyIdentity(raw.identity), title = label(raw.title,300), fileTitle = label(raw.fileTitle,700);
  if (!title || !fileTitle) invalid();
  const target = {type:raw.target.type,id:raw.target.id};
  if (target.type === 'series') {
    if (!integer(raw.target.season,0,999) || !integer(raw.target.episode,1,9999)) invalid();
    target.season = raw.target.season; target.episode = raw.target.episode;
  } else if (raw.target.season !== undefined || raw.target.episode !== undefined) invalid();
  return {identity,target,title,fileTitle,duration:raw.duration};
}

function normalizeState(raw, duration = DAY_SECONDS) {
  if (!record(raw) || !PHASES.has(raw.phase) || typeof raw.playing !== 'boolean' || typeof raw.wantsPlay !== 'boolean' || !bounded(raw.position,duration) || !epoch(raw.at) || raw.rate !== 1 || typeof raw.reason !== 'string' || raw.reason.length > 300 || /[\x00-\x1f\x7f]/.test(raw.reason)) invalid();
  if (raw.playing !== ['scheduled','playing'].includes(raw.phase) || (raw.playing && !raw.wantsPlay)) invalid();
  return {phase:raw.phase,playing:raw.playing,position:raw.position,at:raw.at,rate:1,wantsPlay:raw.wantsPlay,reason:raw.reason};
}

function normalizeMember(raw, duration) {
  if (!record(raw) || typeof raw.present !== 'boolean' || typeof raw.ready !== 'boolean' || typeof raw.buffering !== 'boolean' || (raw.position !== null && !bounded(raw.position,duration))) invalid();
  return {present:raw.present,ready:raw.ready,buffering:raw.buffering,position:raw.position};
}

export function normalizePartySnapshot(raw) {
  const room = raw?.room;
  if (!record(raw) || !epoch(raw.serverTime) || !record(room) || typeof room.id !== 'string' || !ROOM_ID.test(room.id) || !['host','guest'].includes(room.role) || !integer(room.revision,1,Number.MAX_SAFE_INTEGER) || !epoch(room.expiresAt) || !record(room.members)) invalid();
  const media = normalizePartyMedia(room.media), state = normalizeState(room.state,media.duration);
  const host = normalizeMember(room.members.host,media.duration), guest = room.members.guest === null ? null : normalizeMember(room.members.guest,media.duration);
  return {serverTime:raw.serverTime,room:{id:room.id,role:room.role,revision:room.revision,expiresAt:room.expiresAt,media,state,members:{host,guest}}};
}

function sameAnchor(a, b) {
  return ['playing','position','at','rate','wantsPlay','reason'].every(key => a[key] === b[key]) && (a.phase === b.phase || (a.phase === 'playing' && b.phase === 'scheduled'));
}

// Equal-revision polls may advance scheduled -> playing as the clock passes at,
// but must never replace a timeline anchor or switch the selected media.
export function partyUpdateIsNewer(nextRaw, previousRaw = null) {
  let next, previous;
  try { next = normalizePartySnapshot(nextRaw); if (previousRaw !== null) previous = normalizePartySnapshot(previousRaw); }
  catch { return false; }
  if (!previous) return true;
  if (next.room.id !== previous.room.id || next.room.role !== previous.room.role || next.serverTime < previous.serverTime || next.room.revision < previous.room.revision) return false;
  if (next.room.revision > previous.room.revision) return true;
  if (next.serverTime === previous.serverTime) return false;
  return JSON.stringify(next.room.media) === JSON.stringify(previous.room.media) && sameAnchor(next.room.state,previous.room.state);
}

// Sample timestamps are performance.now() values, not Date.now(). Keeping the
// epoch offset against a monotonic clock avoids jumps when the device clock is
// corrected. The median of the quickest recent round trips limits jitter.
export function createPartyClock({now = () => performance.now(), maxSamples = 16, maxRttMs = 10000, staleAfterMs = 30000} = {}) {
  if (typeof now !== 'function' || !integer(maxSamples,1,64) || !bounded(maxRttMs,60000,1) || !bounded(staleAfterMs,300000,1000)) invalid();
  let samples = [], offset = null, lastReceived = null;
  function clear() { samples = []; offset = null; lastReceived = null; }
  function currentStats(at = now()) {
    if (!bounded(at,Number.MAX_SAFE_INTEGER)) return {ready:false,offsetMs:null,rttMs:null,uncertaintyMs:null,samples:0,ageMs:null};
    const ageMs = lastReceived === null ? null : at - lastReceived;
    const selected = samples.filter(sample => at >= sample.receivedAt && at - sample.receivedAt <= staleAfterMs);
    if (!selected.length || ageMs < 0 || ageMs > staleAfterMs || offset === null) return {ready:false,offsetMs:null,rttMs:null,uncertaintyMs:null,samples:0,ageMs};
    const minimum = Math.min(...selected.map(sample => sample.rtt));
    const quick = selected.filter(sample => sample.rtt <= minimum + Math.max(20,minimum * 0.5));
    const offsets = quick.map(sample => sample.offset).sort((a,b) => a-b), middle = Math.floor(offsets.length / 2);
    const selectedOffset = offsets.length % 2 ? offsets[middle] : (offsets[middle-1] + offsets[middle]) / 2;
    const uncertaintyMs = Math.max(...quick.map(sample => Math.abs(sample.offset-selectedOffset) + sample.rtt / 2));
    return {ready:true,offsetMs:selectedOffset,rttMs:minimum,uncertaintyMs,samples:quick.length,ageMs};
  }
  return {
    sample({sentAt,receivedAt = now(),serverTime} = {}) {
      if (!bounded(sentAt,Number.MAX_SAFE_INTEGER) || !bounded(receivedAt,Number.MAX_SAFE_INTEGER) || !epoch(serverTime) || receivedAt < sentAt || receivedAt - sentAt > maxRttMs || (lastReceived !== null && receivedAt < lastReceived)) return false;
      const rtt = receivedAt - sentAt;
      samples.push({receivedAt,rtt,offset:serverTime - (sentAt + receivedAt) / 2});
      samples = samples.filter(sample => receivedAt-sample.receivedAt <= staleAfterMs).slice(-maxSamples);
      lastReceived = receivedAt; offset = samples[samples.length-1].offset;
      return true;
    },
    now(at = now()) { const stats = currentStats(at); return stats.ready ? at + stats.offsetMs : null; },
    stats:currentStats,
    reset:clear
  };
}

export function partyTargetTime(stateRaw, serverNow, {duration = DAY_SECONDS} = {}) {
  if (!epoch(serverNow) || !bounded(duration,DAY_SECONDS,Number.MIN_VALUE)) invalid();
  // Snapshot validation already bounds the anchor to the room's duration. This
  // duration can instead be the local decoder's slightly shorter measurement.
  const state = normalizeState(stateRaw);
  return clamp(state.position + (state.playing ? Math.max(0,serverNow-state.at) / 1000 : 0),0,duration);
}

// shouldPlay describes only this client's next action. The authoritative room
// state is unchanged by an autoplay block, buffering, or a local seek in flight.
// The adapter must await play() and explicitly report its ready/buffering state.
export function partyDriftCorrection({state:stateRaw,serverNow,currentTime,duration = DAY_SECONDS,ready = true,buffering = false,autoplayBlocked = false,seeking = false} = {}) {
  if (!bounded(currentTime,DAY_SECONDS) || typeof ready !== 'boolean' || typeof buffering !== 'boolean' || typeof autoplayBlocked !== 'boolean' || typeof seeking !== 'boolean') invalid();
  const state = normalizeState(stateRaw), target = partyTargetTime(state,serverNow,{duration});
  const drift = target-currentTime, timeToStartMs = state.playing ? Math.max(0,state.at-serverNow) : 0;
  const result = {target,drift,timeToStartMs,shouldPlay:false,seekTo:null,playbackRate:1,reason:'paused'};
  if (!ready) return {...result,reason:'loading'};
  if (autoplayBlocked) return {...result,reason:'autoplay-blocked'};
  if (buffering) return {...result,reason:'buffering'};
  if (seeking) return {...result,reason:'seeking'};
  const shouldPlay = state.playing && timeToStartMs === 0 && target < duration;
  if (!shouldPlay) return {...result,seekTo:Math.abs(drift) > 0.12 ? target : null,reason:timeToStartMs > 0 ? 'scheduled' : target >= duration ? 'ended' : state.phase};
  if (Math.abs(drift) > 0.7) return {...result,shouldPlay:true,seekTo:target,reason:'seek'};
  if (Math.abs(drift) > 0.12) {
    const change = Math.sign(drift) * clamp(Math.abs(drift) / 5,0.03,0.05);
    return {...result,shouldPlay:true,playbackRate:1+change,reason:'rate'};
  }
  return {...result,shouldPlay:true,reason:'in-sync'};
}
