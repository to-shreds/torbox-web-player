import { loadPublicSources } from './source-client.js';
const $ = id => document.getElementById(id);
const GB = 1024 ** 3;
const element = (tag, text = '', className = '') => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
const button = (label, fn, primary = false) => { const b = element('button', label, primary ? 'primary' : ''); b.type = 'button'; b.addEventListener('click', fn); return b; };
const image = (url, label, className) => { const i = element('img', '', className); i.alt = label; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = url; i.addEventListener('error', () => { i.hidden = true; }); return i; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const resolutionOf = s => String(s?.resolution || s?.quality || '').toLowerCase();
export function sourceMatchesResolution(source, resolution = 'auto') {
  if (!resolution || resolution === 'auto') return true;
  const value = resolutionOf(source);
  if (resolution === '2160p') return value.includes('2160') || value.includes('4k');
  return value.includes(resolution.replace('p', ''));
}
export const filterSourcesByResolution = (list, resolution = 'auto') => list.filter(s => sourceMatchesResolution(s, resolution));
export function recommendSource(list, type = 'movie', resolution = 'auto') {
  const visible = filterSourcesByResolution(list, resolution);
  if (!visible.length) return null;
  const safeCached = visible.filter(s => s.cached === true && !s.audioRisk);
  const browserSafe = visible.filter(s => s.browserFriendly && !s.audioRisk);
  const cached = visible.filter(s => s.cached === true);
  const pool = safeCached.length ? safeCached : browserSafe.length ? browserSafe : cached.length ? cached : visible;
  const limit = type === 'series' ? 1 * GB : 3 * GB;
  const rank = s => {
    const r = resolutionOf(s);
    const sizeScore = s.size == null ? 15 : s.size <= limit ? 110 : -Math.min(140, (s.size / limit - 1) * 90);
    const seedScore = Number.isSafeInteger(s.seeders) ? Math.min(35, Math.log2(s.seeders + 1) * 5) : 0;
    return (s.score || 0) + (s.cached === true ? 260 : 0) + (s.browserFriendly ? 100 : 0) - (s.audioRisk ? 180 : 0) + (r.includes('720') ? 135 : r.includes('1080') ? 55 : 0) + sizeScore + seedScore;
  };
  return [...pool].sort((a, b) => rank(b) - rank(a) || (a.size ?? Infinity) - (b.size ?? Infinity))[0];
}
export const preferredSource = list => recommendSource(list, 'movie', 'auto');
export function episodeQueue(meta, target, now = Date.now()) {
  if (!meta || target?.type !== 'series' || !Array.isArray(meta.episodes)) return [];
  const released = meta.episodes.filter(e => !e.released || Date.parse(e.released) <= now).sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = released.findIndex(e => e.season === target.season && e.episode === target.episode);
  if (index < 0) return [];
  return released.slice(index + 1).map(e => ({ type: 'series', id: meta.id, season: e.season, episode: e.episode, name: e.name || `Episode ${e.episode}` }));
}
const formatBytes = value => Number.isFinite(value) && value > 0 ? (value >= GB ? `${(value / GB).toFixed(value >= 10 * GB ? 1 : 2)} GB` : `${Math.max(1, Math.round(value / 1024 ** 2))} MB`) : '—';
const qualityText = s => [s.resolution || s.quality, s.releaseQuality, s.videoCodec, ...(s.audioCodecs || []).slice(0, 2), s.container].filter(Boolean).join(' · ') || 'Unknown';
const feedNames = { popular: 'Popular', featured: 'Featured', new: 'New' };

export function createDiscoveryUI({ api, play, loadLibrary }) {
  let view = 'discover', active = false, catalogGeneration = 0, titleGeneration = 0, sourceGeneration = 0, preparationGeneration = 0;
  let catalogAbort, titleAbort, sourceAbort, searchTimer, pollTimer, metas = [], nextSkip = null, currentMeta;

  function cancelSource() { ++preparationGeneration; ++sourceGeneration; sourceAbort?.abort(); clearTimeout(pollTimer); }
  function cancelTitle() { ++titleGeneration; titleAbort?.abort(); cancelSource(); }
  function message(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
  function displayTab(next) {
    view = next; $('discover-panel').hidden = next !== 'discover'; $('library-panel').hidden = next !== 'library';
    $('discover-tab').setAttribute('aria-selected', String(next === 'discover')); $('library-tab').setAttribute('aria-selected', String(next === 'library'));
    $('page-title').textContent = next === 'discover' ? 'Discover' : 'My files';
    $('search').placeholder = next === 'discover' ? 'Search movies and shows' : 'Search TorBox files';
  }
  async function openLibrary() { displayTab('library'); ++catalogGeneration; catalogAbort?.abort(); await loadLibrary(); }
  async function openDiscover() { displayTab('discover'); await browse(); }

  async function browse(more = false) {
    if (!active || view !== 'discover') return;
    const offset = more ? nextSkip : 0; if (offset === null) return;
    const generation = ++catalogGeneration; catalogAbort?.abort(); catalogAbort = new AbortController();
    $('catalog-more').disabled = true; $('catalog-retry').hidden = true;
    if (!more) { metas = []; nextSkip = null; $('catalog-grid').replaceChildren(); $('catalog-more').hidden = true; }
    const query = $('search').value.trim();
    message('catalog-message', query ? 'Searching…' : 'Loading browse…');
    try {
      const params = new URLSearchParams({ type: $('catalog-type').value, q: query, skip: String(offset), genre: $('catalog-genre').value, feed: $('catalog-feed').value });
      const data = await api('/api/discover/catalog?' + params, { signal: AbortSignal.any([catalogAbort.signal, AbortSignal.timeout(20000)]) });
      if (generation !== catalogGeneration || !active || view !== 'discover') return;
      metas = more ? [...new Map([...metas, ...data.metas].map(m => [m.id, m])).values()] : data.metas;
      nextSkip = data.nextSkip;
      const fragment = document.createDocumentFragment();
      for (const meta of metas) {
        const card = button('', () => showTitle(meta)); card.className = 'poster-card'; card.setAttribute('aria-label', `Open ${meta.name}`);
        const art = element('div', '', 'poster-art'); if (meta.poster) art.append(image(meta.poster, '', 'poster-image'));
        art.append(element('span', meta.name, 'poster-fallback')); card.append(art, element('strong', meta.name), element('span', meta.year || (meta.type === 'series' ? 'Show' : 'Movie'), 'muted')); fragment.append(card);
      }
      $('catalog-grid').replaceChildren(fragment); $('catalog-more').hidden = nextSkip === null;
      if (query) message('catalog-message', metas.length ? `${metas.length} results` : 'No matches. Try a shorter title or IMDb ID.');
      else {
        const shown = feedNames[data.feed] || 'Browse';
        message('catalog-message', data.fallback ? `${feedNames[data.requestedFeed] || 'Browse'} was unavailable, so ${shown} is shown instead.` : metas.length ? shown : 'No titles in this browse view.');
      }
    } catch (e) {
      if (generation === catalogGeneration && active && view === 'discover') {
        const timeout = e.name === 'AbortError' || e.name === 'TimeoutError';
        message('catalog-message', query ? (timeout ? 'Search timed out. Try again.' : e.message) : 'Browse is temporarily unavailable. Search still works.', true);
        $('catalog-retry').hidden = false;
      }
    } finally { if (generation === catalogGeneration) $('catalog-more').disabled = false; }
  }

  async function showTitle(meta) {
    cancelTitle(); currentMeta = null; const generation = titleGeneration;
    titleAbort = new AbortController(); $('title-content').replaceChildren(); $('episode-area').replaceChildren(); $('source-area').replaceChildren();
    $('detail-title').textContent = meta.name; message('detail-message', 'Loading…');
    if (!$('title-dialog').open) $('title-dialog').showModal();
    try {
      const data = await api(`/api/discover/meta?type=${meta.type}&id=${meta.id}`, { signal: AbortSignal.any([titleAbort.signal, AbortSignal.timeout(20000)]) });
      if (generation !== titleGeneration || !$('title-dialog').open || !active) return;
      currentMeta = data.meta;
      const summary = element('div', '', 'title-summary'); if (currentMeta.poster) summary.append(image(currentMeta.poster, currentMeta.name, 'detail-poster'));
      const copy = element('div'); copy.append(element('p', [currentMeta.year, currentMeta.runtime, ...currentMeta.genres].filter(Boolean).join(' · '), 'muted'), element('p', currentMeta.description || ''));
      summary.append(copy); $('title-content').replaceChildren(summary); message('detail-message', '');
      if (currentMeta.type === 'movie') await findSources({ type: meta.type, id: meta.id });
      else renderEpisodes(currentMeta);
    } catch (e) { if (generation === titleGeneration && active) message('detail-message', e.name === 'AbortError' ? 'Cancelled.' : e.message, true); }
  }

  function renderEpisodes(meta) {
    const label = element('label', 'Season'); label.htmlFor = 'season-select';
    const select = element('select'); select.id = 'season-select';
    const seasons = [...new Set(meta.episodes.map(e => e.season))];
    for (const n of seasons) { const o = element('option', n === 0 ? 'Specials' : `Season ${n}`); o.value = String(n); select.append(o); }
    if (seasons.some(n => n > 0)) select.value = String(seasons.find(n => n > 0));
    const list = element('div', '', 'episode-list');
    const render = () => {
      cancelSource(); $('source-area').replaceChildren(); list.replaceChildren();
      for (const episode of meta.episodes.filter(e => e.season === +select.value)) {
        const b = button('', () => {
          for (const sibling of list.children) sibling.removeAttribute('aria-current'); b.setAttribute('aria-current', 'true');
          findSources({ type: 'series', id: meta.id, season: episode.season, episode: episode.episode }, episode.name);
        });
        b.className = 'episode-row'; b.append(element('strong', String(episode.episode).padStart(2, '0'), 'episode-number'));
        const info = element('span'); info.append(element('strong', episode.name)); if (episode.description) info.append(element('span', episode.description, 'episode-overview')); b.append(info);
        if (episode.released && Date.parse(episode.released) > Date.now()) b.disabled = true; list.append(b);
      }
    };
    select.addEventListener('change', render); $('episode-area').replaceChildren(label, select, list);
    if (!seasons.length) { $('episode-area').append(element('p', 'No episode list is available.')); return; } render();
  }

  function playbackContext(target, resolution) {
    return { title: currentMeta?.name || '', resolution, current: target, queue: target.type === 'series' ? episodeQueue(currentMeta, target) : [] };
  }

  function renderSourceTable(list, target, episodeName, generation, area, status, resolution) {
    for (const node of [...area.querySelectorAll('.source-controls,.recommended,.source-table-wrap,.source-note,.preparation')]) node.remove();
    const controls = element('div', '', 'source-controls'); const label = element('label', 'Resolution'); const select = element('select');
    for (const [value, text] of [['auto','Auto · 720p preferred'],['480p','480p'],['720p','720p'],['1080p','1080p'],['2160p','2160p / 4K']]) { const o = element('option', text); o.value = value; select.append(o); }
    select.value = resolution; label.append(select); controls.append(label); area.append(controls);
    const visible = filterSourcesByResolution(list, resolution);
    if (!visible.length) {
      const note = element('p', 'No sources match this resolution. Choose Auto or another resolution.', 'source-note'); area.append(note);
      select.addEventListener('change', () => { try { sessionStorage.setItem('tw-source-resolution', select.value); } catch {} renderSourceTable(list, target, episodeName, generation, area, status, select.value); });
      return;
    }
    const best = recommendSource(visible, target.type, resolution);
    const context = playbackContext(target, resolution);
    if (best) {
      const box = element('section', '', 'recommended'); const copy = element('div', '', 'recommended-copy');
      copy.append(element('div', 'Recommended', 'recommended-kicker'), element('div', best.title, 'recommended-title'), element('p', [best.cached ? 'Cached' : 'Not cached', qualityText(best), formatBytes(best.size)].join(' · '), 'recommended-meta'));
      box.append(copy, button(best.cached ? 'Play' : 'Prepare', () => prepare(best, generation, area, context), true)); area.append(box);
    }
    const wrap = element('div', '', 'source-table-wrap'); const table = element('table', '', 'source-table');
    const head = document.createElement('thead'); const hr = document.createElement('tr');
    for (const title of ['Filename','Size','Seeders','Quality','TorBox','']) hr.append(element('th', title)); head.append(hr); table.append(head);
    const body = document.createElement('tbody');
    for (const source of visible) {
      const row = document.createElement('tr'); if (best?.id === source.id) row.className = 'recommended-row';
      row.append(element('td', source.title, 'filename'), element('td', formatBytes(source.size)), element('td', Number.isSafeInteger(source.seeders) ? String(source.seeders) : '—'), element('td', qualityText(source)), element('td', source.cached ? 'Cached' : source.cached === false ? 'Not cached' : 'Unknown', source.cached ? 'cache-yes' : 'cache-no'));
      const action = document.createElement('td'); action.append(button(source.cached ? 'Play' : 'Prepare', () => prepare(source, generation, area, context))); row.append(action); body.append(row);
    }
    table.append(body); wrap.append(table); area.append(wrap);
    if (visible.every(s => s.seeders == null)) area.append(element('p', 'Seeder counts are not supplied by the current source index; “—” means unavailable, not zero. Filename is the source release name until TorBox resolves its internal file.', 'source-note'));
    select.addEventListener('change', () => { try { sessionStorage.setItem('tw-source-resolution', select.value); } catch {} renderSourceTable(list, target, episodeName, generation, area, status, select.value); });
  }

  async function findSources(target, episodeName = '') {
    cancelSource(); const generation = sourceGeneration; sourceAbort = new AbortController(); const signal = sourceAbort.signal;
    const heading = element('h3', episodeName ? `S${target.season}E${target.episode} · ${episodeName}` : 'Sources');
    const status = element('p', 'Finding sources…', 'status subtle-status'); const area = $('source-area'); area.replaceChildren(heading, status);
    const alive = () => active && generation === sourceGeneration && $('title-dialog').open;
    try {
      const sources = await loadPublicSources(target, { signal }); if (!alive()) return;
      if (!sources.length) { status.textContent = 'No source found.'; return; }
      status.textContent = 'Checking TorBox cache…';
      const result = await api('/api/discover/sources', { method: 'POST', data: { target, sources }, signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) }); if (!alive()) return;
      const list = result.sources; if (!list.length) { status.textContent = 'No supported source found.'; return; }
      status.textContent = result.warning || '';
      let resolution = 'auto'; try { resolution = sessionStorage.getItem('tw-source-resolution') || 'auto'; } catch {}
      renderSourceTable(list, target, episodeName, generation, area, status, resolution);
    } catch (e) {
      if (!alive()) return; status.textContent = e.name === 'TimeoutError' ? 'Source lookup timed out.' : e.message; status.classList.add('error');
      area.append(button('Retry', () => findSources(target, episodeName)));
    }
  }

  async function prepare(source, generation, area, context) {
    if (!active || generation !== sourceGeneration) return;
    const preparation = ++preparationGeneration; clearTimeout(pollTimer);
    for (const b of area.querySelectorAll('button')) b.disabled = true;
    let box = area.querySelector('.preparation'); if (box) box.remove(); box = element('section', '', 'preparation');
    const status = element('p', source.cached ? 'Opening cached source…' : 'Preparing source…'); const controls = element('div', '', 'actions'); box.append(status, controls); area.append(box);
    const alive = () => active && preparation === preparationGeneration && generation === sourceGeneration && $('title-dialog').open;
    const started = Date.now(); let statusBusy = false; const reset = () => { for (const b of area.querySelectorAll('button')) b.disabled = false; };
    const handle = result => {
      if (!alive()) return; status.textContent = result.message || result.state; controls.replaceChildren();
      if (result.state === 'ready') {
        const file = result.file;
        if (result.compatibility?.audioRisk) { controls.append(button('Play anyway', () => { $('title-dialog').close(); play(file, context); })); reset(); return; }
        $('title-dialog').close(); play(file, context); return;
      }
      if (result.state === 'choose_file') { for (const f of result.files) controls.append(button(f.title, () => check(f.id))); reset(); return; }
      if (result.state === 'preparing') { if (typeof result.progress === 'number') status.textContent += ` ${Math.round(result.progress * 100)}%`; if (Date.now() - started < 300000) pollTimer = setTimeout(() => check(), 5000); else controls.append(button('Check', () => check())); reset(); return; }
      controls.append(button('Check', () => check())); reset();
    };
    const check = async videoId => {
      if (!alive() || statusBusy) return; statusBusy = true; clearTimeout(pollTimer);
      try { const params = new URLSearchParams({ source: source.id }); if (videoId) params.set('file', videoId); handle(await api('/api/discover/status?' + params, { signal: AbortSignal.any([sourceAbort.signal, AbortSignal.timeout(30000)]) })); }
      catch (e) { if (alive()) { status.textContent = e.message; controls.replaceChildren(button('Check', () => check())); reset(); } } finally { statusBusy = false; }
    };
    try { handle(await api('/api/discover/prepare', { method: 'POST', data: { source: source.id, onlyCached: source.cached === true }, signal: AbortSignal.any([sourceAbort.signal, AbortSignal.timeout(60000)]) })); }
    catch (e) { if (alive()) { status.textContent = e.message; controls.replaceChildren(button('Check', () => check())); reset(); } }
  }

  async function playNext(context) {
    if (!active || !context?.queue?.length) return false;
    const next = context.queue[0], rest = context.queue.slice(1);
    try {
      const sources = await loadPublicSources(next, { signal: AbortSignal.timeout(40000) }); if (!sources.length) return false;
      const registered = await api('/api/discover/sources', { method: 'POST', data: { target: next, sources }, signal: AbortSignal.timeout(30000) });
      let best = recommendSource(registered.sources, 'series', context.resolution || 'auto') || recommendSource(registered.sources, 'series', 'auto');
      if (!best || best.audioRisk) return false;
      let result = await api('/api/discover/prepare', { method: 'POST', data: { source: best.id, onlyCached: best.cached === true }, signal: AbortSignal.timeout(60000) });
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        if (result.state === 'ready') { await play(result.file, { ...context, current: next, queue: rest }); return true; }
        if (result.state === 'choose_file') {
          if (result.files?.length !== 1) return false;
          result = await api('/api/discover/status?' + new URLSearchParams({ source: best.id, file: result.files[0].id }), { signal: AbortSignal.timeout(30000) }); continue;
        }
        if (result.state !== 'preparing') return false;
        await delay(3500);
        result = await api('/api/discover/status?' + new URLSearchParams({ source: best.id }), { signal: AbortSignal.timeout(30000) });
      }
    } catch {}
    return false;
  }

  $('discover-tab').addEventListener('click', openDiscover); $('library-tab').addEventListener('click', openLibrary);
  for (const id of ['catalog-type','catalog-feed','catalog-genre']) $(id).addEventListener('change', () => browse());
  $('catalog-more').addEventListener('click', () => browse(true)); $('catalog-retry').addEventListener('click', () => browse());
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); if (view !== 'discover') return; ++catalogGeneration; catalogAbort?.abort(); searchTimer = setTimeout(() => browse(), 350); });
  $('close-title').addEventListener('click', () => $('title-dialog').close()); $('title-dialog').addEventListener('close', cancelTitle);
  $('viewer').addEventListener('change', () => { cancelTitle(); if ($('title-dialog').open) $('title-dialog').close(); });
  return { async activate() { active = true; await openDiscover(); }, openLibrary, playNext, suspend() { active = false; ++catalogGeneration; catalogAbort?.abort(); cancelTitle(); clearTimeout(searchTimer); metas = []; nextSkip = null; currentMeta = null; $('catalog-grid').replaceChildren(); $('title-content').replaceChildren(); $('episode-area').replaceChildren(); $('source-area').replaceChildren(); if ($('title-dialog').open) $('title-dialog').close(); } };
}