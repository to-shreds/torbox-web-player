import test from 'node:test';
// Fixed public metadata requests only. No TorBox credentials or account mutations.
test('opt-in Zilean source availability', { skip: process.env.SOURCE_ACCESS_CHECK !== 'zilean', timeout: 40000 }, async () => {
  const checks = [
    ['movie', 'ImdbId=tt1160419'],
    ['episode', 'ImdbId=tt0903747&Season=1&Episode=1'],
    ['public_sample', 'ImdbId=tt1254207']
  ];
  const results = await Promise.all(checks.map(async ([label, query]) => {
    const out = { label }; const started = Date.now(); let response;
    try {
      response = await fetch('https://zileanfortheweebs.midnightignite.me/dmm/filtered?' + query, {
        headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000)
      });
      out.status = response.status;
      if (!response.ok) return out;
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4194304) throw new Error(); chunks.push(Buffer.from(value)); }
      } finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      out.array = Array.isArray(data); out.count = Array.isArray(data) ? data.length : null;
      if (Array.isArray(data)) {
        out.fields = Object.keys(data[0] || {}).filter(k => /^[a-zA-Z_]{1,40}$/.test(k)).slice(0, 30);
        out.types = Object.fromEntries(out.fields.map(k => [k, Array.isArray(data[0][k]) ? 'array' : typeof data[0][k]]));
        out.hashes = data.filter(t => /^[a-f0-9]{40}$/i.test(t.info_hash || '')).length;
        out.matchingImdb = data.filter(t => t.imdb_id === new URLSearchParams(query).get('ImdbId')).length;
      }
    } catch (e) {
      const code = e?.cause?.code || e?.name;
      out.error = ['ENOTFOUND', 'TimeoutError', 'AbortError'].includes(code) ? code : 'REQUEST_FAILED';
    } finally {
      try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {}
      out.durationMs = Date.now() - started;
    }
    return out;
  }));
  console.log(JSON.stringify({ event: 'zilean_access_check', results }));
});
