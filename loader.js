// Chooses the data the UI renders. The UI itself never knows where it came from.
//
// Order of precedence:
//   1. ?fixture=<name> in the URL        → fixtures/<name>.json
//   2. The data source saved in Settings → live, or a named fixture
//   3. Default                           → data/state.json from `npm run sync`
// If live data is missing, it falls back to the normal-day fixture and
// Settings says so.
(async () => {
  const FIXTURES = ['normal-day', 'returning-after-weekend'];
  const urlFixture = new URLSearchParams(location.search).get('fixture');
  const saved = window.ThreadlinePrefs.read('threadline.dataSource', 'live');

  const load = async url => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };

  const requested = urlFixture
    ? { mode: 'fixture', name: urlFixture, origin: 'url' }
    : saved !== 'live' && FIXTURES.includes(saved)
      ? { mode: 'fixture', name: saved, origin: 'setting' }
      : { mode: 'live', name: null, origin: 'default' };

  let data;
  let source = requested;
  try {
    data = await load(requested.mode === 'live' ? 'data/state.json' : `fixtures/${encodeURIComponent(requested.name)}.json`);
  } catch (err) {
    console.info('Threadline: falling back to the normal-day fixture.', err.message);
    data = await load('fixtures/normal-day.json');
    source = { mode: 'fixture', name: 'normal-day', origin: 'fallback', requested };
  }

  window.THREADLINE_DATA = data;
  window.THREADLINE_SOURCE = { ...source, fixtures: FIXTURES };

  // Under `npm start`, the server reports sync status. Under any other
  // static server this request fails and the page simply stays static.
  try {
    const res = await fetch('/api/sync', { cache: 'no-store' });
    if (res.ok) window.THREADLINE_SYNC = await res.json();
  } catch {}

  /** JSON requests to the local server. Throws with the server's message. */
  window.threadlineApi = async (path, method = 'GET', body) => {
    const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${res.status}`);
    return json;
  };

  window.startThreadline(data);
  if (window.THREADLINE_SYNC) listenForSyncs();

  function listenForSyncs() {
    const events = new EventSource('/api/events');
    // Sync status changed (started, finished, failed): refresh the labels.
    events.addEventListener('status', e => {
      window.THREADLINE_SYNC = JSON.parse(e.data);
      window.refreshThreadlineStatus?.();
    });
    // data/state.json was rewritten by a sync or a local change.
    events.addEventListener('state', async () => {
      if (window.THREADLINE_SOURCE.origin === 'fallback') { location.reload(); return; } // first live data
      if (window.THREADLINE_SOURCE.mode !== 'live') return; // a chosen fixture stays put
      try { window.updateThreadline(await load('data/state.json')); } catch (err) { console.warn('Threadline: could not load new data.', err); }
    });

    // Tell the server you are here, so it can show "while you were away"
    // after a gap. Only while the page is visible.
    const seen = () => { if (document.visibilityState === 'visible') window.threadlineApi('/api/seen', 'POST', {}).catch(() => {}); };
    seen();
    setInterval(seen, 5 * 60_000);
    document.addEventListener('visibilitychange', seen);
  }
})();
