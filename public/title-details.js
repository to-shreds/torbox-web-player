import { getRatingsKey, peekRottenTomatoes, fetchRottenTomatoes } from './title-ratings.js?v=release-1.2.16-details.1';
import { peekWikidataRating, fetchWikidataRating } from './wikidata-ratings.js?v=release-1.2.16-details.1';

const similarCache = new Map();
const validId = id => /^tt[0-9]{5,12}$/.test(id || '');
const node = (tag, text = '', className = '') => {
  const value = document.createElement(tag); value.textContent = text;
  if (className) value.className = className;
  return value;
};
const external = (label, href, className = '') => {
  const link = node('a', label, `title-external-link ${className}`.trim());
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
  return link;
};
export function trailerUrl(meta) {
  const trailer = (Array.isArray(meta?.trailers) ? meta.trailers : []).find(row => /^[a-zA-Z0-9_-]{11}$/.test(row?.ytId || ''));
  if (trailer) return `https://www.youtube.com/watch?v=${trailer.ytId}`;
  const query = [String(meta?.name || '').slice(0, 250), String(meta?.year || '').match(/\d{4}/)?.[0], 'official trailer'].filter(Boolean).join(' ');
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: query })}`;
}
export function createTrailerLink(meta) {
  const href = trailerUrl(meta), link = external('Watch trailer ↗', href, 'trailer-link');
  link.title = href.includes('/watch?') ? 'Watch the trailer on YouTube' : 'Find trailers for this title on YouTube';
  link.setAttribute('aria-label', `${link.title} (opens a new tab)`);
  return link;
}
export function rottenTomatoesUrl(meta, rating) {
  try {
    const url = new URL(rating?.url);
    if (url.protocol === 'https:' && url.hostname === 'www.rottentomatoes.com' && !url.username && !url.password && !url.port && /^\/(?:m|tv)\/[a-zA-Z0-9_/-]+$/.test(url.pathname)) return url.href;
  } catch {}
  return `https://www.rottentomatoes.com/search?${new URLSearchParams({ search: String(meta?.name || '').slice(0, 250) })}`;
}
export function cachedTitleRating(meta) {
  if (!validId(meta?.id)) return null;
  return peekRottenTomatoes(meta.id, meta.type) || peekWikidataRating(meta.id, meta.type);
}
function recordedLabel(rating, short = false) {
  if (!rating?.recordedAt || !Number.isFinite(Date.parse(rating.recordedAt))) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', ...(short ? {} : { day: 'numeric' }), year: 'numeric' }).format(new Date(rating.recordedAt));
}
export function addPosterRating(card, meta) {
  card.dataset.titleId = meta.id; card.dataset.titleType = meta.type;
  card.querySelector('.poster-rating')?.remove();
  const rating = cachedTitleRating(meta);
  if (!rating) return;
  const date = rating.provider === 'Wikidata' ? recordedLabel(rating, true) : '';
  const badge = node('span', `RT ${rating.score}%${date ? ` · ${date}` : ''}`, 'poster-rating');
  badge.title = `Rotten Tomatoes critics score${date ? ` recorded ${recordedLabel(rating)}` : ''}, via ${rating.provider}`;
  badge.setAttribute('aria-label', badge.title); card.append(badge);
}
export function refreshPosterRatings(meta = null) {
  for (const card of document.querySelectorAll('.poster-card[data-title-id]')) {
    if (!meta || (card.dataset.titleId === meta.id && card.dataset.titleType === meta.type)) addPosterRating(card, meta || { id: card.dataset.titleId, type: card.dataset.titleType });
  }
}

// Extras have their own lifecycle. They never gate details, source preparation,
// or Play, and never turn the home grid into one request per poster.
export function mountTitleExtras(meta, { ratings, similar, api, posterCard, signal, isCurrent, allowExternal = true, showSimilar = true }) {
  const lifecycle = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
  let observer = null, frame = null, disposed = false, requested = false;
  const current = () => !disposed && !requestSignal.aborted && isCurrent();
  const cancel = () => { disposed = true; lifecycle.abort(); observer?.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  signal?.addEventListener('abort', cancel, { once: true });
  const renderRating = (rating, notice = '') => {
    if (!current()) return;
    ratings.replaceChildren();
    if (typeof meta.imdbRating === 'number' && Number.isFinite(meta.imdbRating) && meta.imdbRating >= 0 && meta.imdbRating <= 10) {
      ratings.append(node('span', `IMDb ${meta.imdbRating.toFixed(1)}/10`, 'title-rating-badge'));
    }
    const label = rating ? `Rotten Tomatoes ${rating.score}%` : 'Rotten Tomatoes ↗';
    if (rating || allowExternal) {
      const group = node('span', '', 'title-rating-group');
      group.append(allowExternal ? external(label, rottenTomatoesUrl(meta, rating), 'title-rating-badge') : node('span', label, 'title-rating-badge'));
      if (rating) group.append(node('small', rating.provider === 'Wikidata' ? `Recorded ${recordedLabel(rating)} · via Wikidata` : 'Critics score · via OMDb', 'title-rating-source'));
      ratings.append(group);
    }
    if (notice) ratings.append(node('small', notice, 'title-rating-source'));
  };
  renderRating(cachedTitleRating(meta));
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!current()) return;
    void (async () => {
      let rating = null, notice = '';
      if (getRatingsKey()) {
        try { rating = await fetchRottenTomatoes(meta, { signal: requestSignal }); }
        catch (error) {
          if (!current()) return;
          if (error?.code === 'RATINGS_KEY_INVALID') notice = 'Update the OMDb key in Settings.';
          if (error?.code === 'RATINGS_QUOTA') notice = 'OMDb daily limit reached.';
        }
      }
      if (!rating && current()) {
        try { rating = await fetchWikidataRating(meta, { signal: requestSignal }); } catch {}
      }
      if (!current()) return;
      renderRating(rating || cachedTitleRating(meta), notice);
      refreshPosterRatings(meta);
    })();
  });

  similar.replaceChildren(); similar.hidden = !showSimilar;
  if (showSimilar) {
    const heading = node('div', '', 'similar-heading');
    heading.append(node('h3', 'More like this'), node('span', 'Based on shared genres', 'muted'));
    const status = node('p', 'Finding similar titles…', 'similar-status muted'); status.setAttribute('role', 'status');
    const grid = node('div', '', 'similar-grid'); similar.append(heading, status, grid);
    const renderSimilar = rows => {
      if (!current()) return;
      grid.replaceChildren();
      const seen = new Set([meta.id]);
      for (const row of Array.isArray(rows) ? rows.slice(0, 40) : []) {
        if (!validId(row?.id) || row.type !== meta.type || typeof row.name !== 'string' || seen.has(row.id)) continue;
        seen.add(row.id); grid.append(posterCard(row)); if (grid.children.length >= 12) break;
      }
      status.textContent = grid.children.length ? '' : 'No similar titles are available for this title yet.';
      status.hidden = !!grid.children.length;
    };
    const load = async () => {
      if (!current() || requested) return;
      requested = true; observer?.disconnect(); status.hidden = false; status.textContent = 'Finding similar titles…';
      const key = `${meta.type}:${meta.id}`, old = similarCache.get(key);
      if (old && old.until > Date.now()) { renderSimilar(old.metas); return; }
      try {
        const result = await api(`/api/discover/similar?${new URLSearchParams({ type: meta.type, id: meta.id })}`, { signal: AbortSignal.any([requestSignal, AbortSignal.timeout(8000)]) });
        if (!current()) return;
        if (!Array.isArray(result?.metas)) throw new Error('Invalid similar titles');
        similarCache.delete(key); similarCache.set(key, { metas: result.metas.slice(0, 12), until: Date.now() + 5 * 60_000 });
        while (similarCache.size > 80) similarCache.delete(similarCache.keys().next().value);
        renderSimilar(result.metas);
      } catch {
        if (!current()) return;
        status.textContent = 'Similar titles are unavailable right now. ';
        const retry = node('button', 'Try again', 'text-button'); retry.type = 'button';
        retry.addEventListener('click', () => { requested = false; void load(); }); status.append(retry);
      }
    };
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(); }, { root: similar.closest('dialog'), rootMargin: '100px' });
      observer.observe(similar);
    } else { void load(); }
  }
  return () => { cancel(); signal?.removeEventListener('abort', cancel); };
}
