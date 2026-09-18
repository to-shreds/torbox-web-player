import { loadPublicSources } from './source-client.js';
const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
const button = (label, fn, primary = false) => { const b = element('button', label, primary ? 'primary' : ''); b.type = 'button'; b.addEventListener('click', fn); return b; };
const image = (url, label, className) => { const i = element('img', '', className); i.alt = label; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = url; i.addEventListener('error', () => { i.hidden = true; }); return i; };
const sourceLabel = s => [s.quality, s.cached === true ? 'Cached in TorBox' : s.cached === false ? 'Needs preparation' : 'Availability unknown', s.hint].filter(Boolean).join(' · ');
export function createDiscoveryUI({ api, play, loadLibrary }) {
  let view = 'discover', active = false, catalogGeneration = 0, titleGeneration = 0, sourceGeneration = 0, preparationGeneration = 0;
  let catalogAbort, titleAbort, sourceAbort, searchTimer, pollTimer, metas = [], nextSkip = null, currentMeta;
  function cancelSource() { ++preparationGeneration; ++sourceGeneration; sourceAbort?.abort(); clearTimeout(pollTimer); }
  function cancelTitle() { ++titleGeneration; titleAbort?.abort(); cancelSource(); }
  function message(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('error', error); }
  function displayTab(next) {
    view = next; $('discover-panel').hidden = next !== 'discover'; $('library-panel').hidden = next !== 'library';
    $('discover-tab').setAttribute('aria-selected', String(next === 'discover'));
    $('library-tab').setAttribute('aria-selected', String(next === 'library'));
    $('page-title').textContent = next === 'discover' ? 'What are we watching?' : 'Your TorBox files';
    $('search').placeholder = next === 'discover' ? 'Search movies and shows, or enter an IMDb ID' : 'Search files already in your TorBox account';
  }
  async function openLibrary() {
    displayTab('library'); ++catalogGeneration; catalogAbort?.abort();
    await loadLibrary();
  }
  async function openDiscover() { displayTab('discover'); await browse(); }
  async function browse(more = false) {
    if (!active || view !== 'discover') return;
    const offset = more ? nextSkip : 0; if (offset === null) return;
    const generation = ++catalogGeneration; catalogAbort?.abort(); catalogAbort = new AbortController();
    $('catalog-more').disabled = true; $('catalog-retry').hidden = true;
    if (!more) { metas = []; nextSkip = null; $('catalog-grid').replaceChildren(); $('catalog-more').hidden = true; }
    message('catalog-message', 'Searching the movie and show catalog…');
    try {
      const params = new URLSearchParams({ type: $('catalog-type').value, q: $('search').value.trim(), skip: String(offset), genre: $('catalog-genre').value });
      const data = await api('/api/discover/catalog?' + params, { signal: AbortSignal.any([catalogAbort.signal, AbortSignal.timeout(20000)]) });
      if (generation !== catalogGeneration || !active || view !== 'discover') return;
      metas = more ? [...new Map([...metas, ...data.metas].map(m => [m.id, m])).values()] : data.metas;
      nextSkip = data.nextSkip;
      const fragment = document.createDocumentFragment();
      for (const meta of metas) {
        const card = button('', () => showTitle(meta)); card.className = 'poster-card'; card.setAttribute('aria-label', `Open ${meta.name}${meta.year ? ', ' + meta.year : ''}`);
        const art = element('div', '', 'poster-art'); if (meta.poster) art.append(image(meta.poster, '', 'poster-image'));
        art.append(element('span', meta.name, 'poster-fallback'));
        card.append(art, element('strong', meta.name), element('span', meta.year || (meta.type === 'series' ? 'TV show' : 'Movie'), 'muted'));
        fragment.append(card);
      }
      $('catalog-grid').replaceChildren(fragment); $('catalog-more').hidden = nextSkip === null;
      message('catalog-message', metas.length ? `${metas.length} titles${$('search').value.trim() ? ' found' : ' to explore'}. Open one to check its sources.` : 'No matching titles in this catalog. Try a shorter title, clear the genre, switch Movies / Shows, or enter the IMDb ID.');
    } catch (e) {
      if (generation === catalogGeneration && active && view === 'discover') { message('catalog-message', e.name === 'AbortError' || e.name === 'TimeoutError' ? 'The catalog request timed out. Try again.' : e.message, true); $('catalog-retry').hidden = false; }
    } finally { if (generation === catalogGeneration) $('catalog-more').disabled = false; }
  }
  async function showTitle(meta) {
    cancelTitle(); currentMeta = null; const generation = titleGeneration;
    titleAbort = new AbortController(); $('title-content').replaceChildren(); $('episode-area').replaceChildren(); $('source-area').replaceChildren();
    $('detail-title').textContent = meta.name; message('detail-message', 'Loading title details…');
    if (!$('title-dialog').open) $('title-dialog').showModal();
    try {
      const data = await api(`/api/discover/meta?type=${meta.type}&id=${meta.id}`, { signal: AbortSignal.any([titleAbort.signal, AbortSignal.timeout(20000)]) });
      if (generation !== titleGeneration || !$('title-dialog').open || !active) return;
      currentMeta = data.meta;
      const summary = element('div', '', 'title-summary');
      if (currentMeta.poster) summary.append(image(currentMeta.poster, currentMeta.name, 'detail-poster'));
      const copy = element('div'); copy.append(element('p', [currentMeta.year, currentMeta.runtime, ...currentMeta.genres].filter(Boolean).join(' · '), 'muted'), element('p', currentMeta.description || 'No description is available.'));
      summary.append(copy); $('title-content').replaceChildren(summary); message('detail-message', '');
      if (currentMeta.type === 'movie') await findSources({ type: meta.type, id: meta.id });
      else renderEpisodes(currentMeta);
    } catch (e) { if (generation === titleGeneration && active) message('detail-message', e.name === 'AbortError' ? 'Title loading was cancelled.' : e.message, true); }
  }
  function renderEpisodes(meta) {
    const label = element('label', 'Season'); label.htmlFor = 'season-select';
    const select = element('select'); select.id = 'season-select';
    const seasons = [...new Set(meta.episodes.map(e => e.season))];
    for (const n of seasons) { const o = element('option', n === 0 ? 'Specials' : `Season ${n}`); o.value = String(n); select.append(o); }
    if (seasons.some(n => n > 0)) select.value = String(seasons.find(n => n > 0));
    const list = element('div', '', 'episode-list'); list.setAttribute('aria-label', 'Episodes');
    const render = () => {
      cancelSource(); $('source-area').replaceChildren();
      list.replaceChildren();
      for (const episode of meta.episodes.filter(e => e.season === +select.value)) {
        const b = button('', () => {
          for (const sibling of list.children) sibling.removeAttribute('aria-current');
          b.setAttribute('aria-current', 'true');
          findSources({ type: 'series', id: meta.id, season: episode.season, episode: episode.episode }, episode.name);
        });
        b.className = 'episode-row';
        const n = element('strong', String(episode.episode).padStart(2, '0'), 'episode-number');
        const info = element('span'); info.append(element('strong', episode.name));
        if (episode.description) info.append(element('span', episode.description, 'episode-overview'));
        b.append(n, info);
        if (episode.released && Date.parse(episode.released) > Date.now()) { b.disabled = true; info.append(element('small', 'Not released yet')); }
        list.append(b);
      }
    };
    select.addEventListener('change', render);
    $('episode-area').replaceChildren(label, select, list);
    if (!seasons.length) { $('episode-area').append(element('p', 'The catalog has no episode list for this show.')); return; }
    render();
  }
  async function findSources(target, episodeName = '') {
    cancelSource(); const generation = sourceGeneration; sourceAbort = new AbortController();
    const signal = sourceAbort.signal;
    const heading = element('h3', episodeName ? `S${target.season} · E${target.episode}: ${episodeName}` : 'Choose a version');
    const status = element('p', 'Finding torrent sources…', 'status'); status.setAttribute('role', 'status');
    const area = $('source-area'); area.replaceChildren(heading, status);
    const alive = () => active && generation === sourceGeneration && $('title-dialog').open;
    try {
      const sources = await loadPublicSources(target, { signal });
      if (!alive()) return;
      if (!sources.length) { status.textContent = 'No torrent source found for this selection. Nothing has been added to TorBox.'; return; }
      status.textContent = 'Checking which versions are cached in TorBox…';
      const result = await api('/api/discover/sources', { method: 'POST', data: { target, sources }, signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
      if (!alive()) return;
      status.textContent = result.warning || 'Choose Play or Prepare. Searching and opening titles never adds torrents.';
      const list = result.sources;
      if (!list.length) { status.textContent = 'No supported source was found.'; return; }
      const best = list[0];
      const primary = button(best.cached ? 'Play selected version' : 'Prepare selected version', () => prepare(best, generation, area), true);
      area.append(element('p', sourceLabel(best), 'muted'), primary);
      const details = element('details', '', 'versions'); details.append(element('summary', `Other versions (${list.length})`));
      for (const source of list) {
        const row = element('article', '', 'source-row');
        const copy = element('div'); copy.append(element('strong', sourceLabel(source)), element('p', source.title, 'source-name'));
        if (source.size) copy.append(element('small', `${(source.size / 1024 ** 3).toFixed(2)} GB`));
        const actions = element('div', '', 'actions');
        actions.append(button(source.cached ? 'Play' : 'Prepare', () => prepare(source, generation, area)));
        // An explicitly selected fallback permits a download if a cached source disappears.
        if (source.cached) actions.append(button('Prepare if needed', () => prepare({ ...source, cached: false }, generation, area)));
        row.append(copy, actions); details.append(row);
      }
      area.append(details, element('p', 'Codec labels are source hints, not a playback guarantee. Conversion is not connected yet.', 'muted'));
    } catch (e) {
      if (!alive()) return;
      status.textContent = e.name === 'TimeoutError' ? 'Source lookup timed out. Nothing was added.' : e.message;
      status.classList.add('error');
      area.append(button('Try source lookup again', () => findSources(target, episodeName)));
    }
  }
  async function prepare(source, generation, area) {
    if (!active || generation !== sourceGeneration) return;
    const preparation = ++preparationGeneration;
    clearTimeout(pollTimer);
    for (const b of area.querySelectorAll('button')) b.disabled = true;
    let box = area.querySelector('.preparation');
    if (box) box.remove(); box = element('section', '', 'preparation');
    const status = element('p', 'Opening the selected version in TorBox…'); status.setAttribute('role', 'status');
    const controls = element('div', '', 'actions'); box.append(status, controls); area.append(box);
    const alive = () => active && preparation === preparationGeneration && generation === sourceGeneration && $('title-dialog').open;
    const started = Date.now(); let statusBusy = false;
    const resetButtons = () => { for (const b of area.querySelectorAll('button')) b.disabled = false; };
    const handle = result => {
      if (!alive()) return;
      status.textContent = result.message || result.state;
      controls.replaceChildren();
      if (result.state === 'ready') {
        // Reuse the existing authenticated player and progress protections.
        const file = result.file; $('title-dialog').close(); play(file); return;
      }
      if (result.state === 'choose_file') {
        for (const f of result.files) controls.append(button(f.title, () => check(f.id)));
        resetButtons(); return;
      }
      if (result.state === 'preparing') {
        if (typeof result.progress === 'number') status.textContent += ` ${Math.round(result.progress * 100)}%`;
        if (Date.now() - started < 300000) pollTimer = setTimeout(() => check(), 5000);
        else controls.append(button('Check status', () => check()));
        resetButtons(); return;
      }
      controls.append(button('Check status', () => check())); resetButtons();
    };
    const check = async videoId => {
      if (!alive() || statusBusy) return; statusBusy = true; clearTimeout(pollTimer);
      try {
        const params = new URLSearchParams({ source: source.id }); if (videoId) params.set('file', videoId);
        handle(await api('/api/discover/status?' + params, { signal: AbortSignal.any([sourceAbort.signal, AbortSignal.timeout(30000)]) }));
      } catch (e) { if (alive()) { status.textContent = e.message; controls.replaceChildren(button('Check status', () => check())); resetButtons(); } }
      finally { statusBusy = false; }
    };
    try {
      handle(await api('/api/discover/prepare', { method: 'POST', data: { source: source.id, onlyCached: source.cached === true }, signal: AbortSignal.any([sourceAbort.signal, AbortSignal.timeout(60000)]) }));
    } catch (e) {
      if (alive()) { status.textContent = e.message; controls.replaceChildren(button('Check status', () => check())); resetButtons(); }
    }
  }
  $('discover-tab').addEventListener('click', openDiscover);
  $('library-tab').addEventListener('click', openLibrary);
  $('catalog-type').addEventListener('change', () => browse()); $('catalog-genre').addEventListener('change', () => browse());
  $('catalog-more').addEventListener('click', () => browse(true)); $('catalog-retry').addEventListener('click', () => browse());
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer); if (view !== 'discover') return;
    ++catalogGeneration; catalogAbort?.abort();
    searchTimer = setTimeout(() => browse(), 350);
  });
  $('close-title').addEventListener('click', () => $('title-dialog').close());
  $('title-dialog').addEventListener('close', cancelTitle);
  $('viewer').addEventListener('change', () => { cancelTitle(); if ($('title-dialog').open) $('title-dialog').close(); });
  return {
    async activate() { active = true; await openDiscover(); },
    openLibrary,
    suspend() {
      active = false; ++catalogGeneration; catalogAbort?.abort(); cancelTitle(); clearTimeout(searchTimer);
      metas = []; nextSkip = null; currentMeta = null; $('catalog-grid').replaceChildren(); $('title-content').replaceChildren(); $('episode-area').replaceChildren(); $('source-area').replaceChildren();
      if ($('title-dialog').open) $('title-dialog').close();
    }
  };
}
