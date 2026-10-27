/* KanaPet — virtual pet controller. The SVG itself is inline in index.html (#pet).
 * The pet stage is global: it stays visible on every tab and has head-room so
 * jumps / reactions are never clipped. Idle: wander, blink, hop, chase, stretch,
 * yawn, look around, dance, nap. Reactive: happy, sad, celebrate, tab emotions.
 */
(function () {
  'use strict';
  var petEl, habitat, dotEl, timers = [], lastActivity = Date.now(), sleeping = false, level = 1;
  var paused = false, lastReaction = -1, lastTab = '';
  var ACTION_CLASSES = ['hop', 'spin', 'wiggle', 'bounce', 'dance', 'love', 'shy', 'pop', 'shake', 'dizzy',
    'wave', 'stretch', 'yawn', 'roll', 'think', 'sing', 'sneeze', 'peek', 'jump', 'sit'];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function tr(key, fallback) {
    var s = window.I18n ? window.I18n.t(key) : key;
    return s && s !== key ? s : (fallback || key);
  }

  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = []; }

  function setAccessory(lvl) {
    level = lvl;
    var hat = $('#pet-hat'), scarf = $('#pet-scarf');
    if (hat) hat.style.display = lvl >= 3 ? '' : 'none';
    if (scarf) scarf.style.display = lvl >= 5 ? '' : 'none';
  }

  function blink() {
    var eyes = $('#pet-eyes');
    if (!eyes) return;
    eyes.style.transition = 'transform .08s ease';
    eyes.setAttribute('transform', 'scale(1 0.1)');
    setTimeout(function () { if (eyes) eyes.setAttribute('transform', 'scale(1 1)'); }, 120);
  }

  function wander() {
    if (!petEl || !habitat) return;
    var w = Math.max(20, habitat.clientWidth - 94);
    var x = Math.max(6, Math.random() * w);
    petEl.style.left = x + 'px';
  }

  function hop() {
    if (!petEl) return;
    petEl.classList.remove('hop'); void petEl.offsetWidth; petEl.classList.add('hop');
  }

  function spawnDot() {
    if (!habitat || !dotEl) return;
    var w = habitat.clientWidth - 26;
    dotEl.style.left = (10 + Math.random() * w) + 'px';
    dotEl.style.top = (12 + Math.random() * 34) + 'px';
    dotEl.style.opacity = '1';
    setTimeout(function () { if (dotEl) dotEl.style.opacity = '0'; }, 2600);
    setTimeout(wander, 400);
  }

  // Floating effect particles. Each type has an emoji/symbol, a colour class,
  // and a count. Rendered as absolutely-positioned nodes that float up & fade.
  var FX = {
    heart:   { ch: '\u2665', cls: 'heart-fx',  n: 3 },
    star:    { ch: '\u2605', cls: 'star-fx',   n: 3 },
    note:    { ch: '\u266A', cls: 'note-fx',   n: 2 },
    sparkle: { ch: '\u2728', cls: 'star-fx',   n: 3 },
    anger:   { ch: '\uD83D\uDCA2', cls: 'anger-fx', n: 2 },
    sweat:   { ch: '\u25CF', cls: 'sweat-fx',  n: 1 },
    zzz:     { ch: 'z', cls: 'note-fx',        n: 2 }
  };
  function fx(type) {
    if (!petEl || !habitat) return;
    var cfg = FX[type] || FX.heart;
    for (var i = 0; i < cfg.n; i++) {
      (function (i) {
        var el = document.createElement('div');
        el.className = 'pet-fx ' + cfg.cls;
        el.textContent = cfg.ch;
        el.style.left = (parseFloat(petEl.style.left || '40') + 20 + i * 12) + 'px';
        el.style.top = (habitat.clientHeight - 70) + 'px';
        el.style.animationDelay = (i * 90) + 'ms';
        habitat.appendChild(el);
        setTimeout(function () { el.remove(); }, 1400);
      })(i);
    }
  }

  // Tap reactions — tap/click the pet and it plays a random one of these.
  var REACTIONS = [
    { cls: 'hop',     fx: 'heart',   sayKey: 'petYay',   sound: 'mew' },
    { cls: 'spin',    fx: 'star',    sayKey: 'petWhee',  sound: 'chirp' },
    { cls: 'wiggle',  fx: 'note',    sayKey: 'petHiHi',  sound: 'sing' },
    { cls: 'bounce',  fx: 'heart',   sayKey: 'petBoing', sound: 'boop' },
    { cls: 'dance',   fx: 'note',    sayKey: 'petLaLa',  sound: 'sing' },
    { cls: 'love',    fx: 'heart',   sayKey: 'petLove',  sound: 'purr' },
    { cls: 'shy',     fx: 'sweat',   sayKey: 'petHehe',  sound: 'mew' },
    { cls: 'pop',     fx: 'sparkle', sayKey: '!',        sound: 'chirp' },
    { cls: 'shake',   fx: 'anger',   sayKey: 'petHmph',  sound: 'grumble' },
    { cls: 'dizzy',   fx: 'star',    sayKey: '@_@',      sound: 'wobble' },
    { cls: 'wave',    fx: 'note',    sayKey: 'petHello', sound: 'chirp' },
    { cls: 'stretch', fx: 'heart',   sayKey: 'petAhh',   sound: 'sleepy' },
    { cls: 'yawn',    fx: 'zzz',     sayKey: 'petSleepy', sound: 'sleepy' },
    { cls: 'roll',    fx: 'star',    sayKey: 'petWheee', sound: 'chirp' },
    { cls: 'think',   fx: 'note',    sayKey: 'petHmm',   sound: 'boop' },
    { cls: 'sing',    fx: 'note',    sayKey: 'petLaLa',  sound: 'sing' },
    { cls: 'sneeze',  fx: 'sweat',   sayKey: 'petAchoo', sound: 'boop' },
    { cls: 'peek',    fx: 'sparkle', sayKey: 'petPeek',  sound: 'chirp' }
  ];

  // Cute synthesized pet voice (WebAudio, no assets). The context starts only
  // after a user gesture; app.js mirrors the Profile "Pet sounds" toggle here.
  var soundCtx = null, soundsOn = true;
  function audio() {
    if (!soundCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { soundCtx = new Ctx(); } catch (e) { return null; }
    }
    if (soundCtx.state === 'suspended') { try { soundCtx.resume(); } catch (e) {} }
    return soundCtx;
  }
  function tone(freq, at, dur, type, peak, endFreq) {
    var ctx = soundCtx; if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    var t = ctx.currentTime + 0.01 + at;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak || 0.06, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.04);
  }
  function purr() {
    var ctx = audio(); if (!ctx) return;
    var t = ctx.currentTime + 0.01;
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = 165;
    lp.type = 'lowpass'; lp.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.04);
    g.gain.setValueAtTime(0.055, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    var lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 27; lg.gain.value = 0.022;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(lp); lp.connect(g); g.connect(ctx.destination);
    o.start(t); lfo.start(t); o.stop(t + 0.75); lfo.stop(t + 0.75);
  }
  function petSound(kind) {
    if (!soundsOn) return;
    var ctx = audio(); if (!ctx) return;
    var k = kind || 'mew';
    if (k === 'purr') { purr(); return; }
    if (k === 'chirp') {
      tone(920, 0, 0.07, 'triangle', 0.045, 1250);
      tone(1240, 0.07, 0.06, 'triangle', 0.04, 980);
      tone(1060, 0.13, 0.09, 'triangle', 0.035, 1280);
      return;
    }
    if (k === 'happy') {
      tone(660, 0, 0.09, 'triangle', 0.05, 880);
      tone(880, 0.09, 0.09, 'triangle', 0.05, 1100);
      tone(1100, 0.18, 0.14, 'triangle', 0.045, 1320);
      return;
    }
    if (k === 'celebrate') {
      [660, 830, 990, 1320].forEach(function (f, i) { tone(f, i * 0.07, 0.16, 'triangle', 0.05, f * 1.02); });
      return;
    }
    if (k === 'sad') {
      tone(560, 0, 0.22, 'triangle', 0.045, 430);
      tone(430, 0.2, 0.3, 'triangle', 0.04, 300);
      return;
    }
    if (k === 'grumble') {
      tone(150, 0, 0.28, 'sawtooth', 0.035, 95);
      tone(110, 0.08, 0.24, 'triangle', 0.03, 80);
      return;
    }
    if (k === 'sleepy') { tone(420, 0, 0.35, 'sine', 0.03, 250); return; }
    if (k === 'sing') {
      [660, 784, 880, 1046].forEach(function (f, i) { tone(f, i * 0.12, 0.13, 'triangle', 0.04, f); });
      return;
    }
    if (k === 'boop') { tone(430, 0, 0.13, 'sine', 0.06, 190); return; }
    if (k === 'wobble') {
      tone(620, 0, 0.18, 'triangle', 0.04, 760);
      tone(680, 0.12, 0.2, 'triangle', 0.035, 520);
      return;
    }
    var p = 0.92 + Math.random() * 0.16;
    tone(610 * p, 0, 0.16, 'sine', 0.06, 980 * p);
    tone(940 * p, 0.1, 0.16, 'triangle', 0.035, 620 * p);
  }

  function petName() {
    var tag = document.querySelector('.pet-name-tag');
    return (tag && tag.textContent.trim()) || 'Mochi';
  }

  function bubble(text) {
    if (!petEl || !habitat || !text) return;
    text = tr(text, text).split('{pet}').join(petName());
    var b = document.createElement('div');
    b.className = 'pet-say';
    b.textContent = text;
    b.style.left = parseFloat(petEl.style.left || '40') + 'px';
    habitat.appendChild(b);
    setTimeout(function () { b.remove(); }, 1500);
  }

  function play(cls, fxType, say) {
    if (!petEl) return;
    wake();
    ACTION_CLASSES.forEach(function (x) { petEl.classList.remove(x); });
    void petEl.offsetWidth;
    if (cls) petEl.classList.add(cls);
    if (fxType) fx(fxType);
    if (say) bubble(say);
    if (fxType) setTimeout(function () { fx(fxType); }, 300);
    if (cls) setTimeout(function () { if (petEl) petEl.classList.remove(cls); }, 1300);
  }

  function react() {
    if (!petEl) return;
    var i = Math.floor(Math.random() * REACTIONS.length);
    if (REACTIONS.length > 1 && i === lastReaction) i = (i + 1) % REACTIONS.length;
    lastReaction = i;
    var r = REACTIONS[i];
    play(r.cls, r.fx, r.sayKey);
    petSound(r.sound || 'mew');
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }

  // Each tab gets its own little emotion so switching tabs feels alive.
  function tabChange(tab, previous) {
    if (!petEl || (tab === lastTab && previous !== undefined)) { lastTab = tab; return; }
    lastTab = tab;
    var r = {
      learn:    { cls: 'hop',     fx: 'star',    sayKey: 'petLetsLearn' },
      review:   { cls: 'think',   fx: 'note',    sayKey: 'petReviewTime' },
      progress: { cls: 'dance',   fx: 'heart',   sayKey: 'petLookUs' },
      profile:  { cls: 'wave',    fx: 'heart',   sayKey: 'petHiIm' }
    }[tab];
    if (r) {
      play(r.cls, r.fx, r.sayKey);
      petSound(tab === 'review' ? 'boop' : tab === 'progress' ? 'happy' : 'chirp');
    }
  }

  function sleep() {
    if (!petEl || sleeping) return;
    sleeping = true;
    petEl.classList.add('sleep');
    fx('zzz');
  }
  function wake() {
    if (!petEl) return;
    sleeping = false;
    petEl.classList.remove('sleep');
    lastActivity = Date.now();
  }

  function happy() { play('hop', 'heart', null); petSound('happy'); }
  function sad() {
    wake();
    if (petEl) {
      petEl.classList.remove('sad'); void petEl.offsetWidth; petEl.classList.add('sad');
      setTimeout(function () { if (petEl) petEl.classList.remove('sad'); }, 900);
    }
    fx('sweat');
    petSound('sad');
  }
  function celebrate() {
    play('spin', 'heart', 'petWeDidIt');
    petSound('celebrate');
    setTimeout(function () { hop(); }, 350);
    setTimeout(function () { fx('heart'); }, 650);
  }

  function idleLoop() {
    if (paused) return;
    var r = Math.random();
    if (Date.now() - lastActivity > 30000) { sleep(); return; }
    if (r < 0.24) wander();
    else if (r < 0.40) blink();
    else if (r < 0.52) { hop(); setTimeout(wander, 500); }
    else if (r < 0.62) spawnDot();
    else if (r < 0.72) play('stretch', null, null);
    else if (r < 0.80) play('yawn', 'zzz', null);
    else if (r < 0.88) play('peek', 'sparkle', null);
    else if (r < 0.95) play('dance', 'note', null);
    else blink();
  }

  function start() {
    clearTimers();
    if (paused) return;
    timers.push(setInterval(idleLoop, 2600));
    timers.push(setInterval(blink, 4200));
    timers.push(setInterval(function () { if (!paused && Date.now() - lastActivity > 30000) sleep(); }, 5000));
  }

  function setPaused(v) {
    paused = !!v;
    if (paused) clearTimers();
    else { wake(); start(); }
  }

  function init() {
    petEl = $('#pet');
    habitat = $('#pet-habitat') || $('.pet-habitat');
    if (!petEl || !habitat) return;
    dotEl = document.createElement('div');
    dotEl.className = 'float-dot';
    dotEl.style.opacity = '0';
    dotEl.style.transition = 'opacity .4s ease, left .8s ease, top .8s ease';
    habitat.appendChild(dotEl);
    start();
    petEl.addEventListener('click', react);
    petEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); react(); }
    });
    ['pointerdown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, wake, { passive: true });
    });
    document.addEventListener('visibilitychange', function () { setPaused(document.hidden); });
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!petEl || !habitat) return;
        var max = Math.max(6, habitat.clientWidth - 90);
        var cur = parseFloat(petEl.style.left || '0');
        if (cur > max) petEl.style.left = max + 'px';
      }, 200);
    }, { passive: true });
  }

  window.Pet = {
    init: init, happy: happy, sad: sad, celebrate: celebrate,
    setLevel: setAccessory, touch: wake, react: react,
    tabChange: tabChange, play: play, say: bubble, sleep: sleep, wake: wake,
    sound: petSound,
    setSoundEnabled: function (v) { soundsOn = !!v; }
  };
})();
