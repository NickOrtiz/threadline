// Theme and per-browser preferences. Loaded in <head>, before the page
// paints, so a saved dark theme never flashes light first.
//
// Preferences live in localStorage. They belong to this browser only, and
// the page works the same when storage is blocked.
(() => {
  const KEY = 'threadline.theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} };

  function apply(pref) {
    const dark = pref === 'dark' || (pref === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141614' : '#f3f0e9');
  }

  window.ThreadlinePrefs = {
    read, write,
    /** "system" | "light" | "dark" */
    getTheme: () => read(KEY, 'system'),
    setTheme(pref) { write(KEY, pref === 'system' ? null : pref); apply(pref); },
  };

  apply(window.ThreadlinePrefs.getTheme());
  media.addEventListener('change', () => apply(window.ThreadlinePrefs.getTheme()));
})();
