(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const audio = $('audio');
  const KEY = 'omb.v1';
  const SPEEDS = [1, 1.25, 1.5, 0.85];

  /* ---------- Storage: listening history lives on this device ---------- */
  const fresh = () => ({ eps: {}, saved: [], log: [], speed: 1 });
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.eps) return Object.assign(fresh(), s);
    } catch (e) { /* storage blocked or corrupt: start clean */ }
    return fresh();
  }
  const store = load();
  store.log = store.log.filter(x => x.sec >= 3).slice(0, 300);
  let saveTimer = null;
  function persist(now) {
    clearTimeout(saveTimer);
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };
    if (now) write(); else saveTimer = setTimeout(write, 1200);
  }
  const epState = id => store.eps[id] || (store.eps[id] = { pos: 0, heard: [], done: false, doneAt: null, last: null });

  /* ---------- Heard intervals: which seconds have actually been played ---------- */
  function addInterval(list, a, b) {
    const all = list.concat([[a, b]]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [s, e] of all) {
      const last = out[out.length - 1];
      if (last && s <= last[1] + 0.6) last[1] = Math.max(last[1], e);
      else out.push([s, e]);
    }
    return out.map(([s, e]) => [Math.floor(s * 10) / 10, Math.ceil(e * 10) / 10]);
  }
  function covered(list, a, b) {
    let c = 0;
    for (const [s, e] of list) c += Math.max(0, Math.min(e, b) - Math.max(s, a));
    return c;
  }

  /* ---------- Helpers ---------- */
  const fmt = t => { t = Math.max(0, t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parseDate = id => { const [y, m, d] = id.split('-').map(Number); return new Date(y, m - 1, d); };
  const shortDate = id => parseDate(id).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  function when(ts) {
    const d = new Date(ts), now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `today ${time}`;
    return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
  }
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }

  /* ---------- State ---------- */
  let index = [];          // list of briefings
  let ep = null;           // the open briefing (episode.json)
  let audioId = null;      // briefing whose audio is loaded
  let loadingId = null;
  let pendingSeek = null;
  let sentEls = [], starts = [], paraEls = [], segEls = [], chipEls = [];
  let active = -1, activeSeg = -1, follow = true, lastT = null, session = null, dragging = false;
  let userScrollAt = 0, lastMarks = 0, triedBlob = false;

  const total = () => (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (ep ? ep.duration : 0);

  /* ---------- Loading ---------- */
  async function start() {
    $('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    audio.defaultPlaybackRate = store.speed;
    $('speed').textContent = `${store.speed}×`;
    try {
      index = (await getJSON('episodes/index.json')).episodes || [];
    } catch (e) {
      $('epDate').textContent = 'Could not load the briefings. Check your connection, then reopen.';
      return;
    }
    const m = location.hash.match(/^#d(\d{4}-\d\d-\d\d)$/);
    const id = (m && index.some(x => x.id === m[1])) ? m[1] : (index[0] && index[0].id);
    if (id) await openEpisode(id);
    else $('epDate').textContent = 'No briefings yet.';
    route();
  }

  function setAudio(id) {
    triedBlob = false;
    audioId = id;
    audio.src = `episodes/${id}/briefing.mp3`;
    audio.load();
  }

  function openEpisode(id, opts = {}) {
    const { autoplay = false, seekTo = null } = opts;
    if (audioId === id && ep && ep.id === id) {
      if (seekTo != null) go(seekTo);
      if (autoplay) play();
      return Promise.resolve();
    }
    finishSession();
    loadingId = id;
    setAudio(id);                         // set synchronously so play() stays inside the tap on iPhone
    const st = epState(id);
    const resume = st.done ? 0 : st.pos;
    pendingSeek = seekTo != null ? seekTo : (resume > 1 ? resume : null);
    if (autoplay) play();
    return getJSON(`episodes/${id}/episode.json`).then(data => {
      if (loadingId !== id) return;
      ep = data;
      if (pendingSeek != null && pendingSeek > ep.duration - 3) pendingSeek = null;
      renderEpisode();
      updateUI(true);
    }).catch(() => {
      $('epDate').textContent = 'Could not load this briefing. Check your connection.';
    });
  }

  /* ---------- Rendering: briefing ---------- */
  function statusPill(id, duration) {
    const st = store.eps[id];
    if (st && (st.done || covered(st.heard, 0, duration) >= 0.9 * duration)) {
      return `<span class="pill done">✓ Heard${st.doneAt ? ' ' + esc(when(st.doneAt)) : ''}</span>`;
    }
    if (st && st.heard.length) return `<span class="pill">${fmt(duration - covered(st.heard, 0, duration))} unheard</span>`;
    return '<span class="pill new">New</span>';
  }

  function renderEpisode() {
    $('epDate').textContent = ep.dateline;
    $('epSummary').textContent = ep.summary || ep.title;
    $('epMeta').innerHTML = `<span>${fmt(ep.duration)}</span><span>${ep.sections.length} sections</span>${statusPill(ep.id, ep.duration)}`;

    $('chips').innerHTML = ep.sections.map((s, i) =>
      `<button type="button" class="chip" data-i="${i}"><span class="tick">✓</span>${esc(s.heading)}</button>`).join('');

    $('transcript').innerHTML = ep.sections.map((s, i) => {
      const saved = store.saved.some(x => x.id === ep.id && x.s === i);
      const paras = s.paragraphs.map(p =>
        `<p data-a="${p[0].start}" data-b="${p[p.length - 1].end}">` +
        p.map(x => `<span class="s" tabindex="0" role="button" data-start="${x.start}">${esc(x.text)}</span>`).join(' ') +
        '</p>').join('');
      return `<section class="seg" data-i="${i}"><div class="seg-head">` +
        `<button class="jump" type="button" data-start="${s.start}"><span class="ts">${fmt(s.start)}</span>${esc(s.heading)}</button>` +
        `<span class="pill done heard-pill" hidden>✓ Heard</span>` +
        `<button class="savebtn" type="button" data-i="${i}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}</button>` +
        `</div>${paras}</section>`;
    }).join('');

    $('ledger').innerHTML = (ep.numbers || []).map(n =>
      `<tr><th scope="row">${esc(n.label)}</th><td>${esc(n.value)}</td><td class="${esc(n.dir || 'flat')}">${esc(n.change)}</td></tr>`).join('');
    $('ledgerNote').textContent = ep.numbers_note || '';
    $('sources').innerHTML = (ep.sources || []).map(s =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('');
    $('srcCount').textContent = `(${(ep.sources || []).length})`;

    sentEls = [...document.querySelectorAll('#transcript .s')];
    starts = sentEls.map(el => +el.dataset.start);
    paraEls = [...document.querySelectorAll('#transcript p')];
    segEls = [...document.querySelectorAll('#transcript .seg')];
    chipEls = [...document.querySelectorAll('#chips .chip')];
    active = -1; activeSeg = -1;
    $('dur').textContent = fmt(total());
    updateMarks();
  }

  /* ---------- Playback ---------- */
  function play() { audio.play().catch(() => { /* needs a tap first */ }); }
  function toggle() { audio.paused ? play() : audio.pause(); }
  function go(t) {
    const d = total();
    t = Math.max(0, d ? Math.min(t, d - 0.1) : t);
    lastT = null;
    if (audio.readyState < 1) { pendingSeek = t; updateUI(true, t); return; }
    audio.currentTime = t;
    updateUI(true);
  }
  function sectionAt(t) {
    if (!ep) return -1;
    let i = -1;
    ep.sections.forEach((s, k) => { if (s.start <= t + 0.05) i = k; });
    return i;
  }
  function skipSection(dir) {
    if (!ep) return;
    const i = sectionAt(audio.currentTime);
    const target = dir < 0 && audio.currentTime - (ep.sections[i]?.start || 0) > 3 ? i : i + dir;
    const s = ep.sections[Math.max(0, Math.min(ep.sections.length - 1, target))];
    go(s.start);
  }

  function track() {
    if (!audioId) return;
    const t = audio.currentTime;
    const st = epState(audioId);
    if (!audio.paused && !audio.seeking && lastT !== null) {
      const d = t - lastT;
      if (d > 0 && d < 1 + 1.5 * Math.max(1, audio.playbackRate)) {
        st.heard = addInterval(st.heard, lastT, t);
        if (session) { session.sec += d / (audio.playbackRate || 1); session.end = Date.now(); }
      }
    }
    lastT = audio.paused ? null : t;
    st.pos = t;
    st.last = Date.now();
    const dur = total();
    if (!st.done && dur > 0 && covered(st.heard, 0, dur) / dur >= 0.9) {
      st.done = true;
      st.doneAt = Date.now();
      persist(true);
      if (ep && ep.id === audioId) $('epMeta').innerHTML = `<span>${fmt(ep.duration)}</span><span>${ep.sections.length} sections</span>${statusPill(ep.id, ep.duration)}`;
    } else persist();
  }

  function startSession() {
    const prev = store.log[0];
    if (prev && prev.id === audioId && Date.now() - prev.end < 10 * 60 * 1000) session = prev;
    else { session = { id: audioId, at: Date.now(), end: Date.now(), sec: 0 }; store.log.unshift(session); }
  }
  function finishSession() {
    if (!session) return;
    if (session.sec < 3) store.log = store.log.filter(x => x !== session);
    session = null;
    persist(true);
  }

  /* ---------- UI updates ---------- */
  function indexAt(t) {
    let lo = 0, hi = starts.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= t + 0.05) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  function updateMarks() {
    if (!ep) return;
    const st = store.eps[ep.id] || { heard: [] };
    const dur = ep.duration;
    ep.sections.forEach((s, i) => {
      const end = i + 1 < ep.sections.length ? ep.sections[i + 1].start : dur;
      const heard = covered(st.heard, s.start, end) >= 0.85 * (end - s.start);
      chipEls[i] && chipEls[i].classList.toggle('heard', heard);
      const pill = segEls[i] && segEls[i].querySelector('.heard-pill');
      if (pill) pill.hidden = !heard;
    });
    paraEls.forEach(p => {
      const a = +p.dataset.a, b = +p.dataset.b;
      p.classList.toggle('heard', covered(st.heard, a, b) >= 0.9 * (b - a));
    });
    const d = total() || dur;
    $('heardbar').innerHTML = st.heard.map(([a, b]) =>
      `<i style="left:${Math.min(100, a / d * 100)}%;width:${Math.min(100, (b - a) / d * 100)}%"></i>`).join('') + '<b id="posbar"></b>';
  }

  function updateUI(force, shownTime) {
    const t = shownTime != null ? shownTime : (pendingSeek != null && audio.readyState < 1 ? pendingSeek : audio.currentTime);
    const d = total();
    $('cur').textContent = fmt(t);
    $('dur').textContent = fmt(d);
    if (!dragging && d) $('seek').value = Math.round(t / d * 1000);
    if (force || Date.now() - lastMarks > 1000) { updateMarks(); lastMarks = Date.now(); }
    const pos = $('posbar');
    if (pos && d) pos.style.width = `${Math.min(100, t / d * 100)}%`;
    if (!ep || ep.id !== audioId) return;

    const seg = sectionAt(t);
    if (seg !== activeSeg) {
      activeSeg = seg;
      chipEls.forEach((c, i) => c.classList.toggle('on', i === seg));
      setMeta(seg >= 0 ? ep.sections[seg].heading : ep.title);
    }
    if (audio.paused && t < 0.5 && !audio.played.length) {
      $('now').textContent = pendingSeek ? `Resume at ${fmt(pendingSeek)}` : 'Press play';
    } else {
      $('now').textContent = seg >= 0 ? ep.sections[seg].heading : '';
    }

    const i = indexAt(t);
    if (i === active && !force) return;
    if (active >= 0 && sentEls[active]) sentEls[active].classList.remove('on');
    active = i;
    if (i < 0 || !sentEls[i]) return;
    const el = sentEls[i];
    el.classList.add('on');
    const visible = !$('view-listen').hidden;
    if (follow && visible && !audio.paused && Date.now() - userScrollAt > 6000) {
      const r = el.getBoundingClientRect();
      const top = 24;
      const bottom = window.innerHeight - document.querySelector('.dock').offsetHeight - 24;
      if (r.top < top || r.bottom > bottom) {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollBy({ top: r.top - top - (bottom - top) * 0.25, behavior: reduce ? 'auto' : 'smooth' });
      }
    }
  }

  function setMeta(title) {
    if (!('mediaSession' in navigator) || !ep) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title, artist: 'Omaha Morning Brief', album: ep.dateline,
        artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
      });
    } catch (e) { /* not supported */ }
  }

  /* ---------- Library, log and saved ---------- */
  function renderLibrary() {
    const ul = $('episodes');
    if (!index.length) { ul.innerHTML = '<li class="empty">No briefings yet.</li>'; return; }
    ul.innerHTML = index.map(e => {
      const st = store.eps[e.id];
      const d = parseDate(e.id);
      const bars = (st ? st.heard : []).map(([a, b]) =>
        `<i style="left:${Math.min(100, a / e.duration * 100)}%;width:${Math.min(100, (b - a) / e.duration * 100)}%"></i>`).join('');
      return `<li class="ep-row"><button class="ep-open" type="button" data-id="${e.id}">` +
        `<span class="ep-date">${d.toLocaleDateString(undefined, { month: 'short' })}<b>${d.getDate()}</b>${d.toLocaleDateString(undefined, { weekday: 'short' })}</span>` +
        `<span class="ep-body"><span class="ep-sum">${esc(e.summary || e.title)}</span>` +
        `<span class="ep-info"><span>${fmt(e.duration)}</span>${statusPill(e.id, e.duration)}</span>` +
        `<span class="minibar" aria-hidden="true">${bars}</span></span></button></li>`;
    }).join('');

    const heardCount = index.filter(e => store.eps[e.id] && store.eps[e.id].done).length;
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    const secs = store.log.filter(x => x.at >= week).reduce((s, x) => s + x.sec, 0);
    const listened = secs === 0 ? 'nothing' : secs < 60 ? 'under 1 min' : `${Math.round(secs / 60)} min`;
    $('stats').textContent = `${heardCount} of ${index.length} briefing${index.length === 1 ? '' : 's'} heard · ${listened} listened in the last 7 days`;

    const log = store.log.filter(x => x.sec >= 3).slice(0, 40);
    $('log').innerHTML = log.length
      ? log.map(x => `<li><span>${esc(when(x.at))} · ${esc(shortDate(x.id))} briefing</span><span>${x.sec < 60 ? `${Math.round(x.sec)} sec` : `${Math.round(x.sec / 60)} min`}</span></li>`).join('')
      : '<li class="empty">Nothing played yet. Press play on a briefing and it will be logged here.</li>';
  }

  function renderSaved() {
    const ul = $('saved');
    ul.innerHTML = store.saved.length
      ? store.saved.map((x, k) => `<li><span class="eyebrow">${esc(shortDate(x.id))} briefing · saved ${esc(when(x.at))}</span>` +
          `<h4>${esc(x.heading)}</h4><p>${esc(x.text)}</p>` +
          `<span class="row"><button type="button" class="ghost" data-play="${k}">Play from here</button>` +
          `<button type="button" class="ghost" data-remove="${k}">Remove</button></span></li>`).join('')
      : '<li class="empty">Nothing saved yet. Tap Save next to any section of a briefing to keep it here.</li>';
  }

  function toggleSave(i) {
    const k = store.saved.findIndex(x => x.id === ep.id && x.s === i);
    if (k >= 0) store.saved.splice(k, 1);
    else {
      const s = ep.sections[i];
      const text = s.paragraphs[0].slice(0, 2).map(x => x.text).join(' ');
      store.saved.unshift({ id: ep.id, s: i, heading: s.heading, text, start: s.start, at: Date.now() });
    }
    persist(true);
    const btn = document.querySelector(`.savebtn[data-i="${i}"]`);
    const on = k < 0;
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Saved' : 'Save';
  }

  /* ---------- Views ---------- */
  function route() {
    const h = location.hash.slice(1);
    const m = h.match(/^d(\d{4}-\d\d-\d\d)$/);
    if (m && index.some(x => x.id === m[1]) && (!ep || ep.id !== m[1])) openEpisode(m[1]);
    const view = (h === 'library' || h === 'saved') ? h : 'listen';
    const changed = $(`view-${view}`).hidden;
    ['listen', 'library', 'saved'].forEach(v => { $(`view-${v}`).hidden = v !== view; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
    if (view === 'library') renderLibrary();
    if (view === 'saved') renderSaved();
    if (changed) window.scrollTo(0, 0);
  }

  /* ---------- Events ---------- */
  $('play').addEventListener('click', toggle);
  $('back').addEventListener('click', () => go(audio.currentTime - 15));
  $('fwd').addEventListener('click', () => go(audio.currentTime + 30));
  $('speed').addEventListener('click', () => {
    const next = SPEEDS[(SPEEDS.indexOf(store.speed) + 1) % SPEEDS.length];
    store.speed = next;
    audio.playbackRate = audio.defaultPlaybackRate = next;
    $('speed').textContent = `${next}×`;
    persist(true);
  });
  $('follow').addEventListener('click', () => {
    follow = !follow;
    $('follow').setAttribute('aria-pressed', String(follow));
    if (follow) userScrollAt = 0;
  });
  $('seek').addEventListener('input', () => { dragging = true; $('cur').textContent = fmt($('seek').value / 1000 * total()); });
  $('seek').addEventListener('change', () => { dragging = false; go($('seek').value / 1000 * total()); });

  $('chips').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (c) { go(ep.sections[+c.dataset.i].start); play(); }
  });
  $('transcript').addEventListener('click', e => {
    const save = e.target.closest('.savebtn');
    if (save) { toggleSave(+save.dataset.i); return; }
    const t = e.target.closest('.s, .jump');
    if (t) { go(+t.dataset.start); play(); }
  });
  $('transcript').addEventListener('keydown', e => {
    const s = e.target.closest('.s');
    if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(+s.dataset.start); play(); }
  });
  $('episodes').addEventListener('click', e => {
    const b = e.target.closest('.ep-open');
    if (!b) return;
    openEpisode(b.dataset.id);
    location.hash = 'listen';
  });
  $('saved').addEventListener('click', e => {
    const p = e.target.closest('[data-play]');
    const r = e.target.closest('[data-remove]');
    if (p) {
      const x = store.saved[+p.dataset.play];
      openEpisode(x.id, { seekTo: x.start, autoplay: true });
      location.hash = 'listen';
    } else if (r) {
      store.saved.splice(+r.dataset.remove, 1);
      persist(true);
      renderSaved();
      if (ep) renderEpisode();
    }
  });
  $('clearBtn').addEventListener('click', () => { $('clearConfirm').hidden = false; $('clearBtn').hidden = true; });
  $('clearNo').addEventListener('click', () => { $('clearConfirm').hidden = true; $('clearBtn').hidden = false; });
  $('clearYes').addEventListener('click', () => {
    session = null;
    Object.assign(store, fresh(), { speed: store.speed });
    persist(true);
    $('clearConfirm').hidden = true; $('clearBtn').hidden = false;
    renderLibrary(); renderSaved();
    if (ep) { renderEpisode(); updateUI(true); }
  });

  audio.addEventListener('loadedmetadata', () => {
    audio.playbackRate = store.speed;
    if (pendingSeek != null) { audio.currentTime = Math.min(pendingSeek, audio.duration - 0.5); pendingSeek = null; }
    updateUI(true);
  });
  audio.addEventListener('play', () => {
    audio.playbackRate = store.speed;
    $('player').classList.add('playing');
    $('play').setAttribute('aria-label', 'Pause');
    lastT = audio.currentTime;
    startSession();
  });
  audio.addEventListener('pause', () => {
    $('player').classList.remove('playing');
    $('play').setAttribute('aria-label', 'Play');
    track();
    lastT = null;
    finishSession();
    updateMarks();
  });
  audio.addEventListener('ended', () => { lastT = null; finishSession(); updateMarks(); });
  audio.addEventListener('seeking', () => { lastT = null; });
  audio.addEventListener('timeupdate', () => { track(); updateUI(false); });
  audio.addEventListener('error', async () => {
    if (!audioId || triedBlob) { $('now').textContent = 'Audio could not load. Check your connection.'; return; }
    triedBlob = true;
    try {
      const r = await fetch(`episodes/${audioId}/briefing.mp3`);
      if (!r.ok) throw new Error(r.status);
      audio.src = URL.createObjectURL(await r.blob());
      audio.load();
    } catch (e) {
      $('now').textContent = 'Audio could not load. Check your connection.';
    }
  });

  ['wheel', 'touchmove'].forEach(ev => window.addEventListener(ev, () => { userScrollAt = Date.now(); }, { passive: true }));
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { track(); persist(true); } });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, button, .s, a, summary')) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') go(audio.currentTime - 15);
    else if (e.key === 'ArrowRight') go(audio.currentTime + 30);
  });

  if ('mediaSession' in navigator) {
    const handlers = {
      play: () => play(),
      pause: () => audio.pause(),
      seekbackward: () => go(audio.currentTime - 15),
      seekforward: () => go(audio.currentTime + 30),
      seekto: d => go(d.seekTime),
      previoustrack: () => skipSection(-1),
      nexttrack: () => skipSection(1),
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(k, fn); } catch (e) { /* unsupported action */ }
    }
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) { /* not allowed here */ }
  }

  start();
})();
