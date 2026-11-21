/* KanaPet — main application logic. Vanilla JS, offline-first, localStorage persistence. */
(function () {
  'use strict';
  var STORAGE_KEY = 'kanapet_v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function tr(key, vars) {
    var s = window.I18n ? window.I18n.t(key) : key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function typeLabel(type) { return tr(type); }
  function groupLabel(group, type) {
    if (group === 'basic') return tr(type);
    if (group === 'dakuten') return tr(type === 'katakana' ? 'katakanaDakuten' : 'hiraganaDakuten');
    if (group === 'handakuten') return tr(type === 'katakana' ? 'katakanaMaru' : 'hiraganaMaru');
    if (group === 'yoon') return tr('yoon');
    if (group === 'n5') return tr('n5Vocab');
    if (group === 'n4') return tr('n4Vocab');
    if (group === 'n5read') return tr('n5Reading');
    return tr(type) || group || '';
  }

  /* ---------------- State & storage ---------------- */
  function defaultState() {
    return {
      settings: {
        userName: 'Learner', petName: 'Mochi', dailyGoal: 20, sessionSize: 20,
        sets: { hiraganaBasic: true, katakanaBasic: false, hiraganaDakuten: false, katakanaDakuten: false, hiraganaHandakuten: false, katakanaHandakuten: false, yoon: false, n5: false, n4: false, n5read: false },
        romajiHint: 'on', showRomaji: true, autoAdvance: true, autoplayAudio: true, soundOn: true, hapticOn: true,
        voiceActor: 'nanami', petSounds: true
      },
      stats: { xp: 0, level: 1, streak: 0, lastSessionDate: '', totalSessions: 0, totalCorrect: 0, totalAnswered: 0,
               learned: {}, correctStreak: {}, activity: {} },
      errors: {}, // key -> {count, correctStreak, kana, romaji, type, group}
      history: [] // {kana, romaji, correct, ts, type, group}, newest first, capped 500
    };
  }
  var state = load();
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var d = defaultState();
      // shallow-merge to tolerate old versions
      s.settings = Object.assign({}, d.settings, s.settings || {});
      s.settings.sets = Object.assign({}, d.settings.sets, (s.settings && s.settings.sets) || {});
      // migrate legacy combined dakuten/handakuten toggles → per-script sets
      var sets = s.settings.sets;
      if (sets.dakuten) { sets.hiraganaDakuten = true; sets.katakanaDakuten = true; }
      if (sets.handakuten) { sets.hiraganaHandakuten = true; sets.katakanaHandakuten = true; }
      delete sets.dakuten; delete sets.handakuten;
      s.stats = Object.assign({}, d.stats, s.stats || {});
      s.errors = s.errors || {};
      return s;
    } catch (e) { return defaultState(); }
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function yesterdayStr() { var d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* ---------------- Audio: TTS + SFX (WebAudio, no files) ---------------- */
  var audioCtx = null;
  function beep(freqs, dur) {
    if (!state.settings.soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * dur);
        g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + i * dur + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * dur + dur);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * dur); o.stop(audioCtx.currentTime + i * dur + dur + 0.05);
      });
    } catch (e) {}
  }
  function vibrate(p) { if (state.settings.hapticOn && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }
  // --- Pronunciation ------------------------------------------------------
  // Primary: built-in OFFLINE voice packs. One clip per kana / word lives in
  // www/audio/<hash>.mp3 (Momo) or www/audio/<pack>/<hash>.mp3 (other actors).
  // Clips are generated at build time (tools/gen_voicepack.js for Momo,
  // tools/gen_edge_voicepack.py for Edge voices). Fallback: Momo's clip, then
  // the device's own Japanese text-to-speech. No microphone / speech
  // recognition anywhere.
  //
  // stable string hash — MUST match both voice-pack generators.
  function hashKey(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h = (h ^ Math.imul(s.length, 2654435761)) >>> 0;
    return h.toString(16);
  }
  var VOICE_PACKS = {
    momo:   { name: 'Momo',   dir: '' },
    nanami: { name: 'Nanami', dir: 'nanami/' },
    yuki:   { name: 'Yuki',   dir: 'yuki/' },
    keita:  { name: 'Keita',  dir: 'keita/' }
  };
  function currentVoice() {
    return VOICE_PACKS[state.settings.voiceActor] ? state.settings.voiceActor : 'momo';
  }
  function clipSrc(text, actor) {
    var id = VOICE_PACKS[actor] ? actor : 'momo';
    return 'audio/' + VOICE_PACKS[id].dir + hashKey(text) + '.mp3';
  }
  var voiceFailed = {}; // src -> true once we know the clip is missing/broken
  var voiceAudio = null; // keep a reference so playback isn't garbage-collected
  var voiceCache = {}, voiceOrder = [], VOICE_CACHE_MAX = 28;
  function getClip(src) {
    var a = voiceCache[src];
    if (a) return a;
    a = new Audio(src);
    a.preload = 'auto';
    voiceCache[src] = a;
    voiceOrder.push(src);
    if (voiceOrder.length > VOICE_CACHE_MAX) {
      var old = voiceOrder.shift();
      try { voiceCache[old].pause(); } catch (e) {}
      delete voiceCache[old];
    }
    return a;
  }
  function preloadKana(text) {
    if (!text) return;
    var src = clipSrc(text, currentVoice());
    if (!voiceFailed[src] && !voiceCache[src]) getClip(src);
  }

  function ttsFallback(text) {
    try {
      if (!('speechSynthesis' in window) || !text) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP'; u.rate = 0.85;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  function speakKana(text, actorOverride) {
    if (!text) return;
    var actor = VOICE_PACKS[actorOverride] ? actorOverride : currentVoice();
    var src = clipSrc(text, actor);
    function fallback() {
      if (actor !== 'momo') { speakKana(text, 'momo'); return; }
      ttsFallback(text);
    }
    if (voiceFailed[src]) { fallback(); return; }
    try {
      var a = getClip(src);
      a.__text = text;
      a.onerror = function () { voiceFailed[src] = true; fallback(); };
      voiceAudio = a;
      try { a.currentTime = 0; } catch (e) {}
      var p = a.play();
      if (p && p.catch) p.catch(function (err) {
        // Autoplay-blocked before any user gesture is NOT a broken clip.
        if (err && err.name === 'NotAllowedError') return;
        voiceFailed[src] = true; fallback();
      });
    } catch (e) { fallback(); }
  }
  window.speakKana = speakKana; // shared with charts.js / other modules
  window.pronounce = speakKana;
  window.preloadKana = preloadKana;
  window.VOICE_PACKS = VOICE_PACKS;

  // On the web build only (not inside the Capacitor APK), add a link so
  // anyone can grab the standalone offline Android app.
  function addWebDownloadLink() {
    try {
      if (window.Capacitor) return;
      var link = document.createElement('a');
      link.href = 'https://github.com/nahidsarker771/kana-pet/releases/latest/download/KanaPet.apk';
      link.target = '_blank'; link.rel = 'noopener';
      link.style.cssText = 'display:inline-block;margin:10px auto;padding:9px 18px;border:1.5px solid currentColor;border-radius:10px;color:var(--accent,#4a90d9);text-decoration:none;font-size:13px;font-weight:600';
      link.setAttribute('data-i18n', 'downloadApk');
      link.textContent = tr('downloadApk');
      var v = document.querySelector('[data-i18n="kanaPetVersion"]');
      if (v && v.parentNode) v.parentNode.insertBefore(link, v.nextSibling);
    } catch (e) {}
  }

  /* ---------------- Session / deck ---------------- */
  var session = null; // {deck:[entries], correct, total, fromReview, phase:'idle'|'feedback', timers:[]}
  var rafId = null;

  function selectedPool() {
    var s = state.settings.sets;
    return KANA.ALL.filter(function (e) {
      if (e.group === 'basic') {
        if (e.type === 'hiragana' && s.hiraganaBasic) return true;
        if (e.type === 'katakana' && s.katakanaBasic) return true;
        return false;
      }
      if (e.group === 'dakuten' && e.type === 'hiragana' && s.hiraganaDakuten) return true;
      if (e.group === 'dakuten' && e.type === 'katakana' && s.katakanaDakuten) return true;
      if (e.group === 'handakuten' && e.type === 'hiragana' && s.hiraganaHandakuten) return true;
      if (e.group === 'handakuten' && e.type === 'katakana' && s.katakanaHandakuten) return true;
      if (e.group === 'yoon' && s.yoon) return true;
      if (e.group === 'n5' && s.n5) return true;
      if (e.group === 'n4' && s.n4) return true;
      if (e.group === 'n5read' && s.n5read) return true;
      return false;
    });
  }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function startSession(pool, fromReview) {
    var n = Math.min(state.settings.sessionSize, pool.length);
    var deck = shuffle(pool.slice()).slice(0, n);
    if (deck.length === 0) { toast(window.I18n ? window.I18n.t('noSetsSelected') : 'No characters selected — pick sets in Profile.'); return; }
    session = { deck: deck, size: deck.length, correct: 0, total: 0, fromReview: !!fromReview, phase: 'idle', romajiPeek: false, timers: [] };
    $('#start-panel').classList.add('hidden');
    $('#summary-panel').classList.add('hidden');
    $('#deck-area').classList.remove('hidden');
    $('.tab-content').classList.add('no-scroll');
    renderDeck();
    renderControls();
    updateSessionProgress();
  }
  function clearSessionTimers() { if (session) session.timers.forEach(function (t) { clearTimeout(t); }); if (session) session.timers = []; }

  function meaningBn(meaning) {
    if (!meaning) return '';
    if (window.MEANINGS_WORD_BN && window.MEANINGS_WORD_BN[meaning]) return window.MEANINGS_WORD_BN[meaning];
    if (window.MEANINGS_BN && window.MEANINGS_BN[meaning]) return window.MEANINGS_BN[meaning];
    return '';
  }
  function localizedMeaning(meaning) {
    if (!meaning) return '';
    return window.I18n && window.I18n.getLang() === 'bn' ? (meaningBn(meaning) || meaning) : meaning;
  }
  // Resolve a stored history/error record back to its KANA entry. New records
  // carry `key`; old ones are matched by kana + romaji + group.
  function recordEntry(rec) {
    if (!rec) return null;
    if (rec.key) { var hit = KANA.byKey(rec.key); if (hit) return hit; }
    for (var i = 0; i < KANA.ALL.length; i++) {
      var e = KANA.ALL[i];
      if (e.kana === rec.kana && e.romaji === rec.romaji && e.group === rec.group) return e;
    }
    return null;
  }
  function recordMeaningLine(rec) {
    var entry = recordEntry(rec);
    var meaning = rec.meaning || (entry && entry.example && entry.example.meaning) || '';
    if (!meaning) return '';
    var word = entry && entry.example ? entry.example.word : '';
    var isWordCard = rec.type === 'reading' || rec.type === 'vocab' || (word && word === rec.kana);
    var text = localizedMeaning(meaning);
    return word && !isWordCard ? word + ' · ' + text : text;
  }

  function fillCard(el, entry, depth) {
    if (!entry) { el.style.display = 'none'; return; }
    preloadKana(entry.kana);
    // full state reset — kills stale transform/opacity/transition that cause overlap
    el.style.display = '';
    el.style.transition = 'none';
    el.style.opacity = '';
    el.classList.remove('flipped', 'flash-good', 'flash-bad', 'rise-in');
    el.dataset.key = entry.key;
    var hintMode = state.settings.romajiHint;
    var cs = state.stats.correctStreak[entry.key] || 0;
    var isReading = entry.group === 'n5read'; // reading test: don't spoil the answer on the front
    var peek = !!(session && session.romajiPeek); // manual reveal via the eye button
    var showHint = state.settings.showRomaji && (peek || (!isReading && (hintMode === 'on' || (hintMode === 'auto' && cs < 3))));
    var hideRom = !state.settings.showRomaji;
    var romStyle = hideRom ? ' style="display:none"' : '';
    var groupName = groupLabel(entry.group, entry.type);
    var typeName = typeLabel(entry.type);
    var fitFront = fitKana(el, entry.kana, 120);
    var fitBack = fitKana(el, entry.kana, 78);
    var fitRom = fitRomaji(el, entry.romaji, 28);
    var fitHint = fitRomaji(el, entry.romaji, 18);
    var exExtra = '';
    if (entry.example) {
      var exWord = entry.example.word;
      var exRom = entry.example.romaji;
      var exMean = localizedMeaning(entry.example.meaning);
      var isWordCard = isReading || entry.type === 'vocab' || exWord === entry.kana;
      exExtra = isWordCard ? exMean : exWord + (exRom ? ' (' + exRom + ')' : '') + ' · ' + exMean;
    }
    el.innerHTML =
      '<div class="card-flip">' +
        '<div class="face front">' +
          '<span class="type-tag">' + typeName + '</span>' +
          '<span class="group-tag">' + groupName + '</span>' +
          '<p class="kana-big jp kana-sound" data-speak="' + entry.kana + '" role="button" tabindex="0" aria-label="' + tr('ariaHearLetter') + '" style="font-size:' + fitFront + 'px">' + entry.kana + '</p>' +
          '<p class="romaji-hint" style="font-size:' + fitHint + 'px">' + (showHint ? entry.romaji : '&nbsp;') + '</p>' +
          (exExtra ? '<p class="front-extra"' + (peek ? '' : ' style="display:none"') + '>' + exExtra + '</p>' : '') +
          '<span class="tap-hint">' + tr('tapCardHint') + '</span>' +
          '<button class="speaker-btn" data-speak="' + entry.kana + '" aria-label="' + tr('ariaPlayAudio') + '">' + speakerIcon() + '</button>' +
        '</div>' +
        '<div class="face back">' +
          '<span class="type-tag">' + typeName + '</span>' +
          '<p class="kana-big jp kana-sound" data-speak="' + entry.kana + '" role="button" tabindex="0" aria-label="' + tr('ariaHearLetter') + '" style="font-size:' + fitBack + 'px">' + entry.kana + '</p>' +
          '<p class="romaji" style="font-size:' + fitRom + 'px"' + romStyle + '>' + entry.romaji + '</p>' +
          (isReading ? '' : '<p class="ex-word jp">' + entry.example.word + '</p>') +
          (isReading ? '' : '<p class="ex-romaji" style="font-size:' + Math.min(fitRom, 14) + 'px"' + romStyle + '>' + entry.example.romaji + '</p>') +
          '<p class="ex-meaning">"' + (window.I18n && window.I18n.getLang()==='bn' ? (meaningBn(entry.example.meaning) || entry.example.meaning_bn || entry.example.meaning) : entry.example.meaning) + '"</p>' +
          '<button class="speaker-btn" data-speak="' + entry.kana + '" aria-label="' + tr('ariaPlayAudio') + '">' + speakerIcon() + '</button>' +
        '</div>' +
      '</div>';
    // stacked depth transform
    var sc = depth === 0 ? 1 : depth === 1 ? 0.92 : 0.84;
    var ty = depth === 0 ? 0 : depth === 1 ? 14 : 28;
    el.style.transform = 'scale(' + sc + ') translateY(' + ty + 'px)';
    el.style.zIndex = 3 - depth;
    el.style.opacity = depth > 2 ? 0 : 1;
  }
  function speakerIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>'; }

  // Kana glyph "width unit": full-width kana = 1em, narrow marks (ー っ ゃ ゅ ょ,
  // small vowels, dakuten/handakuten) are fractionally narrower. Used to shrink
  // long reading words so they always fit the card instead of overflowing.
  function kanaUnits(str) {
    var narrow = { 'ー': .55, 'っ': .55, 'ゃ': .55, 'ゅ': .55, 'ょ': .55, 'ぁ': .55, 'ぃ': .55, 'ぅ': .55, 'ぇ': .55, 'ぉ': .55, 'ゎ': .55, 'ゕ': .55, 'ゖ': .55, '゛': .15, '゜': .15 };
    var u = 0;
    for (var i = 0; i < str.length; i++) u += narrow[str[i]] || 1;
    return u;
  }
  // Pick a font-size so the word fits the card width, never exceeding basePx.
  function fitKana(el, kana, basePx) {
    var avail = Math.max(el.offsetWidth - 64, 180); // card width minus face padding + safety
    var fit = Math.floor(avail / Math.max(kanaUnits(kana), 1));
    return Math.max(16, Math.min(basePx, fit));
  }
  // Same fit for romaji (average glyph ≈ 0.55em in bold Baloo 2).
  function fitRomaji(el, romaji, basePx) {
    var avail = Math.max(el.offsetWidth - 72, 170);
    var fit = Math.floor(avail / Math.max(romaji.length * 0.55, 1));
    return Math.max(11, Math.min(basePx, fit));
  }

  function renderDeck() {
    if (!session) return;
    fillCard($('#card0'), session.deck[0], 0);
    fillCard($('#card1'), session.deck[1], 1);
    fillCard($('#card2'), session.deck[2], 2);
    preloadKana(session.deck[1] && session.deck[1].kana);
    // next card springs up from the stack (smooth physics, masks any overlap)
    var c0 = $('#card0');
    c0.classList.add('rise-in');
    setTimeout(function () { c0.classList.remove('rise-in'); }, 320);
  }

  function currentEntry() { return session && session.deck[0]; }

  function updateSessionProgress() {
    if (!session) return;
    var done = session.total, total = session.size || (session.total + session.deck.length);
    $('#session-count').textContent = done + ' / ' + total;
    $('#session-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  }

  function eyeIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'; }
  function eyeOffIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'; }

  function renderControls() {
    var revealed = session && session.phase === 'revealed';
    $('#next-btn').style.display = revealed ? '' : 'none';
    var dim = revealed ? '0.45' : '1';
    $('#missed-btn').style.opacity = dim;
    $('#got-it-btn').style.opacity = dim;
    var rt = $('#romaji-toggle');
    if (rt) {
      rt.innerHTML = state.settings.showRomaji ? eyeIcon() : eyeOffIcon();
      rt.setAttribute('aria-pressed', state.settings.showRomaji ? 'true' : 'false');
    }
  }

  // Apply the romaji on/off state to the cards already on screen without
  // re-rendering them (re-render would reset a flipped card / hide the answer).
  function applyRomajiState() {
    var show = !!state.settings.showRomaji;
    ['#card0', '#card1', '#card2'].forEach(function (sel) {
      var el = $(sel);
      if (!el || el.style.display === 'none') return;
      var entry = el.dataset.key && KANA.byKey(el.dataset.key);
      if (!entry) return;
      var hint = el.querySelector('.romaji-hint');
      if (hint) hint.innerHTML = show ? entry.romaji : '&nbsp;';
      var extra = el.querySelector('.front-extra');
      if (extra) extra.style.display = show ? '' : 'none';
      $$('.romaji, .ex-romaji', el).forEach(function (n) { n.style.display = show ? '' : 'none'; });
    });
  }

  function setRomajiShown(show) {
    state.settings.showRomaji = !!show;
    if (session) session.romajiPeek = !!show;
    save();
    applyRomajiState();
    renderControls();
  }

  /* ---------------- Answer handling ---------------- */
  function flashScreen(kind) {
    var f = $('#screen-flash');
    f.className = 'screen-flash ' + kind; void f.offsetWidth;
    setTimeout(function () { f.className = 'screen-flash'; }, 550);
  }
  function showResultBadge(ok) {
    var b = $('#result-badge');
    b.innerHTML = ok ? checkIcon() : crossIcon();
    b.style.color = ok ? 'var(--good)' : 'var(--bad)';
    b.style.left = ok ? '18%' : '62%';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    setTimeout(function () { b.classList.remove('show'); }, 900);
  }
  function checkIcon() { return '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; }
  function crossIcon() { return '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'; }

  function scheduleAdvance(delay, force) {
    if (state.settings.autoAdvance || force) {
      session.timers.push(setTimeout(function () { flingAndAdvance(); }, delay));
    } else {
      session.phase = 'revealed'; // answer stays on screen until user taps Next
      renderControls();
    }
  }

  function handleAnswer(correct, forceAdvance) {
    if (!session || (session.phase !== 'idle' && session.phase !== 'skipping')) return;
    var entry = currentEntry();
    if (!entry) return;
    session.phase = 'feedback';
    session.total++;
    var today = todayStr();
    state.stats.activity[today] = (state.stats.activity[today] || 0) + 1;

    if (correct) {
      session.correct++;
      state.stats.totalCorrect++;
      state.stats.learned[entry.key] = (state.stats.learned[entry.key] || 0) + 1;
      state.stats.correctStreak[entry.key] = (state.stats.correctStreak[entry.key] || 0) + 1;
      addXP(10);
      // graduate from error list after 3 correct in a row
      if (state.errors[entry.key]) {
        state.errors[entry.key].correctStreak = (state.errors[entry.key].correctStreak || 0) + 1;
        if (state.errors[entry.key].correctStreak >= 3) delete state.errors[entry.key];
      }
      flashScreen('good'); showResultBadge(true); beep([523, 784], 0.12); vibrate(40);
      if (window.Pet) Pet.happy();
      $('#card0').classList.add('flash-good');
      // reveal answer briefly
      $('#card0').classList.add('flipped');
      if (state.settings.autoplayAudio) speakKana(entry.kana);
      scheduleAdvance(800, forceAdvance);
    } else {
      state.stats.correctStreak[entry.key] = 0;
      var er = state.errors[entry.key] || { count: 0, correctStreak: 0, kana: entry.kana, romaji: entry.romaji, type: entry.type, group: entry.group };
      if (!er.meaning) er.meaning = (entry.example && entry.example.meaning) || '';
      er.count++; er.correctStreak = 0;
      state.errors[entry.key] = er;
      flashScreen('bad'); showResultBadge(false); beep([220, 180], 0.16); vibrate([80, 40, 80]);
      if (window.Pet) Pet.sad();
      $('#card0').classList.add('flash-bad', 'flipped'); // reveal correct reading
      if (state.settings.autoplayAudio) speakKana(entry.kana);
      scheduleAdvance(1600);
    }
    state.stats.totalAnswered++;
    state.history.unshift({ key: entry.key, kana: entry.kana, romaji: entry.romaji, meaning: (entry.example && entry.example.meaning) || '', correct: correct, ts: Date.now(), type: entry.type, group: entry.group });
    if (state.history.length > 500) state.history.length = 500;
    save();
    updateBadge();
    updateSessionProgress();
  }

  function addXP(n) {
    var before = state.stats.level;
    state.stats.xp += n;
    state.stats.level = Math.floor(state.stats.xp / 100) + 1;
    if (state.stats.level > before) {
      var msg = tr('levelUp', { level: state.stats.level });
      if (state.stats.level >= 3) msg += ' ' + tr('gotAccessory', { pet: state.settings.petName });
      toast(msg);
      if (window.Pet) Pet.setLevel(state.stats.level);
    }
    $('#xp-num').textContent = state.stats.xp;
    $('#lvl-num').textContent = state.stats.level;
  }

  function flingAndAdvance() {
    var c0 = $('#card0');
    animateTransform(c0, 'translateY(-130%) rotate(14deg) scale(.9)', 280, function () {
      if (!session) return;
      session.deck.shift();
      session.phase = 'idle';
      if (session.deck.length === 0) endSession();
      else { renderDeck(); renderControls(); }
    });
  }

  /* duration-interpolated transform animation (A1) */
  function animateTransform(el, targetStr, dur, onDone) {
    if (rafId) cancelAnimationFrame(rafId);
    var start = performance.now();
    // parse current transform as starting point; we just interpolate opacity/translate via CSS transition fallback
    el.style.transition = 'transform ' + dur + 'ms cubic-bezier(.2,.8,.3,1)';
    el.style.transform = targetStr;
    el.style.opacity = '0';
    var done = false;
    function finish() { if (done) return; done = true; el.style.transition = 'none'; el.style.opacity = ''; if (onDone) onDone(); }
    setTimeout(finish, dur + 60);
  }

  function endSession() {
    clearSessionTimers();
    var acc = session.total ? Math.round((session.correct / session.total) * 100) : 0;
    var mistakes = session.total - session.correct;
    state.stats.totalSessions++;
    // streak
    var today = todayStr();
    if (state.stats.lastSessionDate !== today) {
      if (state.stats.lastSessionDate === yesterdayStr()) state.stats.streak++;
      else state.stats.streak = 1;
      state.stats.lastSessionDate = today;
    }
    save();
    var msg = mistakes === 0 ? tr('perfect') : mistakes <= 3 ? tr('fewSlips') : tr('keepPracticing', { pet: state.settings.petName });
    $('#sum-accuracy').textContent = acc + '%';
    $('#sum-mistakes').textContent = mistakes;
    $('#sum-correct').textContent = session.correct + ' / ' + session.total;
    $('#sum-msg').textContent = msg;
    $('#deck-area').classList.add('hidden');
    $('#summary-panel').classList.remove('hidden');
    $('.tab-content').classList.remove('no-scroll');
    if (acc >= 80) { confettiBurst(); if (window.Pet) Pet.celebrate(); }
    else if (window.Pet) Pet.happy();
    session = null;
    updateBadge();
    renderProgress();
    renderReview();
    updateXPBar();
  }

  /* ---------------- Stop / abort an in-progress session ---------------- */
  function stopSession() {
    if (!session) return;
    clearSessionTimers();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    session = null;
    $('#stop-modal').classList.remove('show');
    $('#deck-area').classList.add('hidden');
    $('#summary-panel').classList.add('hidden');
    $('.tab-content').classList.remove('no-scroll');
    $('#start-panel').classList.remove('hidden');
    renderStartPanel();
    if (window.Pet) Pet.happy();
    toast(tr('sessionStopped'));
  }

  /* ---------------- Swipe physics on top card ---------------- */
  function initSwipe() {
    var c0 = $('#card0');
    var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, startTime = 0, moved = false;
    c0.addEventListener('pointerdown', function (e) {
      if (!session || session.phase !== 'idle') return;
      if (e.target.closest('[data-speak]')) return; // let letter / speaker sound work (no flip/drag)
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY; startTime = performance.now();
      dx = 0; dy = 0;
      c0.classList.add('dragging');
      c0.style.transition = 'none';
      try { c0.setPointerCapture(e.pointerId); } catch (err) {}
    });
    c0.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - startX; dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
      var rot = dx * 0.08;
      c0.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + rot + 'deg)';
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      c0.classList.remove('dragging');
      var dt = Math.max(1, performance.now() - startTime);
      var vx = dx / dt, vy = dy / dt;
      var dist = Math.hypot(dx, dy);
      if (!moved) {
        // tap → flip card
        c0.style.transform = '';
        c0.classList.toggle('flipped');
        if (c0.classList.contains('flipped') && state.settings.autoplayAudio) {
          var en = currentEntry(); if (en) speakKana(en.kana);
        }
        return;
      }
      if (dist > 90 || Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4) {
        // fling off in swipe direction → counts as skip (error)
        var rot = dx * 0.08;
        c0.style.transition = 'transform 260ms cubic-bezier(.2,.8,.3,1), opacity 260ms ease';
        c0.style.transform = 'translate(' + (dx * 3) + 'px,' + (dy * 3) + 'px) rotate(' + (rot * 3) + 'deg)';
        c0.style.opacity = '0';
        if (session) session.phase = 'skipping'; // lock against double-swipe overlap
        setTimeout(function () {
          c0.style.transition = 'none'; c0.style.opacity = ''; c0.style.transform = '';
          handleAnswer(false); // skip = error (commits stats + flings the next card)
        }, 270);
      } else {
        // spring back
        c0.style.transition = 'transform 220ms cubic-bezier(.2,1.4,.4,1)';
        c0.style.transform = '';
        setTimeout(function () { c0.style.transition = 'none'; }, 240);
      }
    }
    c0.addEventListener('pointerup', end);
    c0.addEventListener('pointercancel', end);
  }

  // Play a letter's sound whenever any element carrying data-speak is tapped
  // (card kana glyph, speaker button, kana in the charts, review rows, ...).
  function initLetterSound() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-speak]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      speakKana(b.getAttribute('data-speak'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var b = e.target.closest && e.target.closest('[data-speak]');
      if (!b) return;
      e.preventDefault();
      speakKana(b.getAttribute('data-speak'));
    });
  }

  /* ---------------- Confetti (canvas particles) ---------------- */
  var confettiTimer = null;
  function confettiBurst() {
    var cv = $('#confetti');
    var ctx = cv.getContext('2d');
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    var colors = ['#297a2e', '#d97706', '#ff8fab', '#7cc6f5', '#fbbf24'];
    var parts = [];
    for (var i = 0; i < 140; i++) {
      parts.push({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
        vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, s: 5 + Math.random() * 7,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], life: 1 });
    }
    if (confettiTimer) cancelAnimationFrame(confettiTimer);
    var t0 = performance.now();
    function frame(now) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      var alive = false;
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr;
        if (p.y < cv.height + 20 && now - t0 < 3500) {
          alive = true;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
        }
      });
      if (alive) confettiTimer = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    }
    confettiTimer = requestAnimationFrame(frame);
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  window.toast = toast;

  /* ---------------- Tabs ---------------- */
  var currentTab = 'learn';
  function switchTab(name) {
    var previous = currentTab;
    currentTab = name;
    $$('.tab-page').forEach(function (p) { p.classList.remove('active'); });
    $('#tab-' + name).classList.add('active');
    $$('.tabbar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    $('.tab-content').classList.toggle('no-scroll', name === 'learn' && !!session);
    if (name === 'review') renderReview();
    if (name === 'progress') renderProgress();
    if (name === 'profile') { renderProfile(); syncProfileJump(); }
    if (name === 'kana') renderKanaTab();
    if (name === 'learn') { if (!session) { $('#deck-area').classList.add('hidden'); $('#start-panel').classList.remove('hidden'); renderStartPanel(); } }
    if (window.Pet && previous !== name) Pet.tabChange(name, previous);
  }

  function updateBadge() {
    var n = Object.keys(state.errors).length;
    var b = $('#review-badge');
    b.textContent = n > 99 ? '99+' : n;
    b.style.display = n > 0 ? '' : 'none';
  }

  /* ---------------- Start panel ---------------- */
  function renderStartPanel() {
    var pool = selectedPool();
    $('#pool-count').textContent = pool.length;
    $('#session-size-info').textContent = state.settings.sessionSize;
    var today = state.stats.activity[todayStr()] || 0;
    var todayLabel = (window.I18n && window.I18n.t('today')) || 'today';
    $('#today-progress').textContent = today + ' / ' + state.settings.dailyGoal + ' ' + todayLabel;
    $('#pet-name-start').textContent = state.settings.petName;
  }

  var reviewView = 'missed'; // 'missed' | 'history'
  function renderHistory() {
    var list = $('#history-list');
    list.innerHTML = '';
    var h = state.history || [];
    if (!h.length) { list.innerHTML = '<div class="empty-note">' + tr('noHistoryYet') + '</div>'; return; }
    h.slice(0, 100).forEach(function (r) {
      var d = new Date(r.ts);
      var time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      var tag = groupLabel(r.group, r.type);
      var meaning = recordMeaningLine(r);
      var row = document.createElement('div');
      row.className = 'error-row';
      row.innerHTML = '<span class="k jp kana-sound" data-speak="' + r.kana + '" role="button" tabindex="0">' + r.kana + '</span>' +
        '<div class="info"><div class="r">' + r.romaji + '</div>' +
        (meaning ? '<div class="mn">' + meaning + '</div>' : '') +
        '<div class="sub">' + tag + ' · ' + time + '</div></div>' +
        '<span class="miss" style="background:' + (r.correct ? 'rgba(22,163,74,.12)' : 'var(--accent2-soft)') + ';color:' + (r.correct ? 'var(--good)' : 'var(--accent2)') + '">' + (r.correct ? tr('gotIt') : tr('missed')) + '</span>';
      list.appendChild(row);
    });
  }

  /* ---------------- Review tab ---------------- */
  function renderReview() {
    // segmented control active state + list visibility
    var segMissed = $('#seg-missed'), segHist = $('#seg-history');
    if (segMissed) segMissed.classList.toggle('active', reviewView === 'missed');
    if (segHist) segHist.classList.toggle('active', reviewView === 'history');
    $('#error-list').style.display = reviewView === 'missed' ? '' : 'none';
    $('#history-list').style.display = reviewView === 'history' ? '' : 'none';
    if (reviewView === 'history') { renderHistory(); return; }
    var list = $('#error-list');
    var keys = Object.keys(state.errors);
    keys.sort(function (a, b) { return state.errors[b].count - state.errors[a].count; });
    list.innerHTML = '';
    if (keys.length === 0) {
      list.innerHTML = '<div class="empty-note">' + tr('noMissedYet') + ' ' + state.settings.petName + ' ' + tr('proud') + '</div>';
      $('#practice-missed-btn').disabled = true;
      $('#practice-missed-btn').style.opacity = '0.5';
      return;
    }
    $('#practice-missed-btn').disabled = false;
    $('#practice-missed-btn').style.opacity = '';
    keys.forEach(function (k) {
      var er = state.errors[k];
      var typeName = typeLabel(er.type);
      var groupName = groupLabel(er.group, er.type);
      var meta = groupName && groupName !== typeName ? typeName + ' · ' + groupName : typeName;
      var meaning = recordMeaningLine(er);
      var row = document.createElement('div');
      row.className = 'error-row';
      row.innerHTML = '<span class="k jp kana-sound" data-speak="' + er.kana + '" role="button" tabindex="0">' + er.kana + '</span>' +
        '<div class="info"><div class="r">' + er.romaji + '</div>' +
        (meaning ? '<div class="mn">' + meaning + '</div>' : '') +
        '<div class="sub">' + meta + ' · ' + tr('correctStreak', { streak: er.correctStreak }) + '</div></div>' +
        '<span class="miss">' + tr('missedTimes', { count: er.count }) + '</span>';
      list.appendChild(row);
    });
  }

  /* ---------------- Progress tab ---------------- */
  function masteryPct(filterFn) {
    var set = KANA.ALL.filter(filterFn);
    if (!set.length) return 0;
    var learned = set.filter(function (e) { return (state.stats.learned[e.key] || 0) > 0; }).length;
    return Math.round((learned / set.length) * 100);
  }
  function renderProgress() {
    $('#stat-streak').textContent = state.stats.streak;
    $('#stat-sessions').textContent = state.stats.totalSessions;
    $('#stat-learned').textContent = Object.keys(state.stats.learned).length;
    $('#stat-accuracy').textContent = state.stats.totalAnswered ? Math.round(state.stats.totalCorrect / state.stats.totalAnswered * 100) + '%' : '—';
    var bars = [
      ['mastery-hira', masteryPct(function (e) { return e.type === 'hiragana' && e.group === 'basic'; }), '#297a2e'],
      ['mastery-kata', masteryPct(function (e) { return e.type === 'katakana' && e.group === 'basic'; }), '#d97706'],
      ['mastery-hiradaku', masteryPct(function (e) { return e.group === 'dakuten' && e.type === 'hiragana'; }), '#7cc6f5'],
      ['mastery-katadaku', masteryPct(function (e) { return e.group === 'dakuten' && e.type === 'katakana'; }), '#5fb3e8'],
      ['mastery-hirahand', masteryPct(function (e) { return e.group === 'handakuten' && e.type === 'hiragana'; }), '#ff8fab'],
      ['mastery-katahand', masteryPct(function (e) { return e.group === 'handakuten' && e.type === 'katakana'; }), '#f48fb1']
    ];
    bars.forEach(function (b) {
      var el = $('#' + b[0]);
      el.firstElementChild.style.width = b[1] + '%';
      el.firstElementChild.style.background = b[2];
      el.nextElementSibling.textContent = b[1] + '%';
    });
    // heatmap last 30 days
    var hm = $('#heatmap');
    hm.innerHTML = '';
    for (var i = 29; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      var c = state.stats.activity[key] || 0;
      var cell = document.createElement('div');
      var lvl = c === 0 ? '' : c < 5 ? 'l1' : c < 15 ? 'l2' : c < 30 ? 'l3' : 'l4';
      cell.className = 'cell ' + lvl;
      cell.title = tr('cardsTitle', { name: key, count: c });
      hm.appendChild(cell);
    }
  }

  /* ---------------- Profile / settings ---------------- */
  var SET_KEYS = ['hiraganaBasic', 'katakanaBasic', 'hiraganaDakuten', 'katakanaDakuten', 'hiraganaHandakuten', 'katakanaHandakuten', 'yoon', 'n5', 'n4', 'n5read'];
  var PROFILE_JUMP_IDS = ['group-profile', 'group-sets', 'group-goals', 'group-audio', 'reminders-group'];
  var profileJumpActive = '';

  function renderHeroName(name) {
    var display = (name || '').trim() || 'Learner';
    var avatar = $('#profile-avatar'), heroName = $('#profile-hero-name');
    if (avatar) avatar.textContent = display.charAt(0).toUpperCase();
    if (heroName) heroName.textContent = display;
  }
  function updateProfileHero() {
    renderHeroName(state.settings.userName);
    var lvl = $('#profile-hero-level'), xp = $('#profile-hero-xp');
    if (lvl) lvl.textContent = state.stats.level;
    if (xp) xp.textContent = state.stats.xp + ' XP';
  }
  function updateSetsCount() {
    var on = SET_KEYS.filter(function (k) { return !!state.settings.sets[k]; }).length;
    var el = $('#sets-count');
    if (el) el.textContent = on + '/' + SET_KEYS.length;
  }
  function markProfileJump(id) {
    if (!id || id === profileJumpActive) return;
    profileJumpActive = id;
    $$('.profile-jump [data-jump]').forEach(function (btn) {
      var on = btn.dataset.jump === id;
      btn.classList.toggle('on', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }
  function syncProfileJump() {
    if (currentTab !== 'profile') return;
    var bar = $('.profile-jump'), pane = $('.tab-content');
    if (!bar || !pane) return;
    var pivot = bar.getBoundingClientRect().bottom + 8;
    var active = PROFILE_JUMP_IDS[0];
    PROFILE_JUMP_IDS.forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec && sec.getBoundingClientRect().top <= pivot) active = id;
    });
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4) active = PROFILE_JUMP_IDS[PROFILE_JUMP_IDS.length - 1];
    markProfileJump(active);
  }
  function renderVoiceGrid() {
    var active = currentVoice();
    $$('[data-voice]').forEach(function (card) {
      var on = card.dataset.voice === active;
      card.classList.toggle('active', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function renderProfile() {
    $('#set-username').value = state.settings.userName;
    $('#set-petname').value = state.settings.petName;
    if ($('#set-language')) $('#set-language').value = (localStorage.getItem('kanapet_lang') || 'en');
    $('#set-daily').value = state.settings.dailyGoal;
    $('#set-daily-val').textContent = state.settings.dailyGoal;
    $('#set-session').value = state.settings.sessionSize;
    $('#set-session-val').textContent = state.settings.sessionSize;
    $('#set-romaji').value = state.settings.romajiHint;
    $('#set-autoplay').checked = state.settings.autoplayAudio;
    $('#set-showromaji').checked = state.settings.showRomaji;
    $('#set-autoadvance').checked = state.settings.autoAdvance;
    $('#set-sound').checked = state.settings.soundOn;
    $('#set-petsounds').checked = state.settings.petSounds;
    $('#set-haptic').checked = state.settings.hapticOn;
    renderVoiceGrid();
    updateProfileHero();
    updateSetsCount();
    SET_KEYS.forEach(function (k) {
      var c = $('[data-set="' + k + '"]');
      if (c) {
        c.classList.toggle('on', !!state.settings.sets[k]);
        c.setAttribute('aria-pressed', state.settings.sets[k] ? 'true' : 'false');
      }
    });
  }
  /* ---------------- Kana tab (all letters) ---------------- */
  var kanaChart = 'all';
  function renderKanaTab() {
    if (!window.Charts) return;
    var search = $('#kana-chart-search');
    window.Charts.render({
      chart: kanaChart,
      search: (search && search.value) || '',
      container: 'kana-charts-container'
    });
  }
  function bindKanaTab() {
    var chips = $$('[data-kana-chart]');
    var search = $('#kana-chart-search');
    var clear = $('#kana-chart-clear');
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        kanaChart = chip.getAttribute('data-kana-chart');
        renderKanaTab();
      });
    });
    if (search) {
      search.addEventListener('input', renderKanaTab);
    }
    if (clear) {
      clear.addEventListener('click', function () {
        if (search) search.value = '';
        renderKanaTab();
      });
    }
  }

  function bindSettings() {
    $('#set-language').addEventListener('change', function (e) {
      if (window.I18n) window.I18n.setLang(e.target.value);
    });
    $('#set-username').addEventListener('input', function (e) { renderHeroName(e.target.value); });
    $('#set-username').addEventListener('change', function (e) {
      state.settings.userName = e.target.value.trim() || 'Learner';
      save();
      updateProfileHero();
    });
    $('#set-petname').addEventListener('change', function (e) {
      state.settings.petName = e.target.value || 'Mochi'; save();
      $('.pet-name-tag').textContent = state.settings.petName;
    });
    $('#set-daily').addEventListener('input', function (e) { state.settings.dailyGoal = +e.target.value; $('#set-daily-val').textContent = e.target.value; save(); });
    $('#set-session').addEventListener('input', function (e) { state.settings.sessionSize = +e.target.value; $('#set-session-val').textContent = e.target.value; save(); });
    $('#set-romaji').addEventListener('change', function (e) { state.settings.romajiHint = e.target.value; save(); });
    $('#set-autoplay').addEventListener('change', function (e) { state.settings.autoplayAudio = e.target.checked; save(); });
    $('#set-showromaji').addEventListener('change', function (e) {
      setRomajiShown(e.target.checked);
      toast(e.target.checked ? (window.I18n?window.I18n.t('romajiShown'):'Romaji shown.') : (window.I18n?window.I18n.t('romajiHidden'):'Romaji hidden — practice by listening!'));
    });
    $('#set-autoadvance').addEventListener('change', function (e) { state.settings.autoAdvance = e.target.checked; save(); toast(e.target.checked ? tr('autoAdvanceOn') : tr('autoAdvanceOff')); });
    $('#set-sound').addEventListener('change', function (e) { state.settings.soundOn = e.target.checked; save(); });
    $('#set-petsounds').addEventListener('change', function (e) {
      state.settings.petSounds = e.target.checked; save();
      if (window.Pet) Pet.setSoundEnabled(state.settings.petSounds);
      if (state.settings.petSounds && window.Pet) Pet.sound('chirp');
    });
    $('#set-haptic').addEventListener('change', function (e) { state.settings.hapticOn = e.target.checked; save(); });
    $$('[data-voice]').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = card.dataset.voice;
        if (!VOICE_PACKS[id]) return;
        state.settings.voiceActor = id; save();
        renderVoiceGrid();
        speakKana('わたし', id);
        toast(tr('voiceChanged', { name: VOICE_PACKS[id].name }));
      });
    });
    $$('[data-set]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var k = chip.dataset.set;
        state.settings.sets[k] = !state.settings.sets[k];
        chip.classList.toggle('on', state.settings.sets[k]);
        chip.setAttribute('aria-pressed', state.settings.sets[k] ? 'true' : 'false');
        updateSetsCount();
        save();
      });
    });
    $('#mix-all').addEventListener('click', function () {
      SET_KEYS.forEach(function (k) {
        state.settings.sets[k] = true;
        var c = $('[data-set="' + k + '"]');
        if (c) { c.classList.add('on'); c.setAttribute('aria-pressed', 'true'); }
      });
      updateSetsCount();
      save(); toast(tr('allSetsEnabled'));
    });
    $('#view-charts').addEventListener('click', function () { switchTab('kana'); });
    $$('.profile-jump [data-jump]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.dataset.jump);
        if (!target) return;
        markProfileJump(btn.dataset.jump);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    var profileScroll = $('.tab-content');
    if (profileScroll) {
      var jumpRaf = null;
      profileScroll.addEventListener('scroll', function () {
        if (currentTab !== 'profile' || jumpRaf) return;
        jumpRaf = requestAnimationFrame(function () { jumpRaf = null; syncProfileJump(); });
      }, { passive: true });
    }
    $('#reset-btn').addEventListener('click', function () { $('#reset-modal').classList.add('show'); });
    $('#reset-cancel').addEventListener('click', function () { $('#reset-modal').classList.remove('show'); });
    $('#reset-confirm').addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      state = load();
      $('#reset-modal').classList.remove('show');
      if (window.Pet) { Pet.setLevel(1); Pet.setSoundEnabled(state.settings.petSounds); }
      updateXPBar(); updateBadge(); renderProfile(); renderProgress(); renderReview(); renderStartPanel();
      toast(tr('progressReset'));
    });
  }

  function updateXPBar() {
    $('#xp-num').textContent = state.stats.xp;
    $('#lvl-num').textContent = state.stats.level;
    $('.pet-name-tag').textContent = state.settings.petName;
    updateProfileHero();
    if (window.Pet) Pet.setLevel(state.stats.level);
  }

  /* ---------------- Practice reminder history words ---------------- */
  window.KanaPetPracticeWords = function (words) {
    var seen = {}, pool = [];
    (words || []).forEach(function (w) {
      var kana = typeof w === 'string' ? w : (w && w.kana);
      if (!kana || seen[kana]) return;
      seen[kana] = true;
      var found = null;
      for (var i = 0; i < KANA.ALL.length; i++) {
        var e = KANA.ALL[i];
        if (e.kana !== kana) continue;
        if (e.group === 'n5read') { found = e; break; }
        if (!found) found = e;
      }
      if (found) pool.push(found);
    });
    if (!pool.length) {
      toast(window.I18n ? window.I18n.t('remindersPracticeEmpty') : 'No reminder words to practice yet.');
      return false;
    }
    switchTab('learn');
    startSession(pool, false);
    return true;
  };

  /* ---------------- Boot ---------------- */
  function init() {
    // tab bar
    $$('.tabbar button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
    // learn buttons
    $('#start-btn').addEventListener('click', function () { startSession(selectedPool(), false); });
    $('#again-btn').addEventListener('click', function () { startSession(selectedPool(), false); });
    $('#practice-missed-btn').addEventListener('click', function () {
      var pool = Object.keys(state.errors).map(function (k) { return KANA.byKey(k); }).filter(Boolean);
      if (pool.length) { switchTab('learn'); startSession(pool, true); }
    });
    $('#seg-missed').addEventListener('click', function () { reviewView = 'missed'; renderReview(); });
    $('#seg-history').addEventListener('click', function () { reviewView = 'history'; renderReview(); });
    $('#got-it-btn').addEventListener('click', function () { handleAnswer(true); });
    $('#missed-btn').addEventListener('click', function () { handleAnswer(false); });
    $('#stop-btn').addEventListener('click', function () { if (session) $('#stop-modal').classList.add('show'); });
    $('#stop-cancel').addEventListener('click', function () { $('#stop-modal').classList.remove('show'); });
    $('#stop-confirm').addEventListener('click', stopSession);
    $('#next-btn').addEventListener('click', function () { if (session && session.phase === 'revealed') flingAndAdvance(); });
    $('#romaji-toggle').addEventListener('click', function () {
      setRomajiShown(!state.settings.showRomaji);
      toast(state.settings.showRomaji ? (window.I18n?window.I18n.t('romajiShown'):'Romaji shown.') : (window.I18n?window.I18n.t('romajiHidden'):'Romaji hidden — practice by listening!'));
    });

    initSwipe();
    initLetterSound();
    addWebDownloadLink();
    bindSettings();
    bindKanaTab();
    updateXPBar();
    updateBadge();
    renderStartPanel();
    renderControls();
    if (window.Pet) { Pet.init(); Pet.setSoundEnabled(state.settings.petSounds); }
    switchTab('learn');
    window.addEventListener('languageChanged', function () {
      renderStartPanel();
      renderProfile();
      renderProgress();
      renderReview();
      if (currentTab === 'kana') renderKanaTab();
      if (session && session.phase === 'idle') renderDeck();
    });

    // Android back-button guard (Capacitor) — TODO: import @capacitor/app for full handler; web fallback:
    window.addEventListener('beforeunload', function () { clearSessionTimers(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
