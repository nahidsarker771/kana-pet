/* KanaPet — 10-minute N5 word reminders.
 * Android: a native alarm chain (KanaPetReminders plugin) keeps delivering new
 * words every 10 minutes even when the app is closed. Web: a timer + service
 * worker notification while the page is open. Both keep a trackable history.
 */
(function () {
  'use strict';
  var KEY = 'kanapet_reminders_v1';
  var INTERVAL_MIN = 10;
  var MAX_HISTORY = 200;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  function tr(key, vars) {
    var s = window.I18n ? window.I18n.t(key) : key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function toast(msg) {
    if (window.toast) { window.toast(msg); return; }
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function load() {
    var d = { enabled: false, nextAt: 0, history: [], exact: true, permission: true };
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return d;
      var s = JSON.parse(raw);
      d.enabled = !!s.enabled;
      d.nextAt = +s.nextAt || 0;
      d.history = Array.isArray(s.history) ? s.history : [];
      if (typeof s.exact === 'boolean') d.exact = s.exact;
      if (typeof s.permission === 'boolean') d.permission = s.permission;
    } catch (e) {}
    return d;
  }
  var settings = load();
  var history = settings.history.slice(0, MAX_HISTORY);
  var webTimer = null;
  var nativePoll = null;
  var swReg = null;
  var lastStatus = '';
  var practiceWordCount = 0;

  function save() {
    settings.history = history.slice(0, MAX_HISTORY);
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function getNative() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.KanaPetReminders) {
        return window.Capacitor.Plugins.KanaPetReminders;
      }
    } catch (e) {}
    return null;
  }
  function isNative() { return !!getNative(); }
  function langCode() {
    return (window.I18n && window.I18n.getLang && window.I18n.getLang() === 'bn') ? 'bn' : 'en';
  }
  function nativeSyncLanguage() {
    var p = getNative();
    if (!p || !p.setLanguage) return;
    try {
      var res = p.setLanguage({ lang: langCode() });
      if (res && res.catch) res.catch(function () {});
    } catch (e) {}
  }

  function wordPool() {
    var rows = window.N5READ_WORDS || [];
    return rows.map(function (r) {
      var en = r[2] || '';
      var bn = (window.MEANINGS_WORD_BN && window.MEANINGS_WORD_BN[en]) ||
               (window.MEANINGS_BN && window.MEANINGS_BN[en]) || en;
      return { kana: r[0], romaji: r[1], en: en, bn: bn };
    });
  }

  function normalizeWord(w) {
    if (!w || !w.kana) return null;
    return {
      kana: String(w.kana),
      romaji: String(w.romaji || ''),
      en: String(w.en || ''),
      bn: String(w.bn || w.en || ''),
      ts: +w.ts || Date.now()
    };
  }

  function mergeHistory(list) {
    var map = {}, changed = false;
    history.forEach(function (w) { var n = normalizeWord(w); if (n) map[n.kana + '@' + n.ts] = n; });
    (list || []).forEach(function (w) {
      var n = normalizeWord(w);
      if (!n) return;
      var key = n.kana + '@' + n.ts;
      if (!map[key]) changed = true;
      map[key] = n;
    });
    history = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.ts - a.ts; }).slice(0, MAX_HISTORY);
    save();
    return changed;
  }

  function pickWord() {
    var pool = wordPool();
    if (!pool.length) return null;
    var recent = {};
    history.slice(0, 40).forEach(function (w) { recent[w.kana] = true; });
    var w = null;
    for (var i = 0; i < 60; i++) {
      var c = pool[Math.floor(Math.random() * pool.length)];
      if (!recent[c.kana]) { w = c; break; }
      if (!w) w = c;
    }
    return w;
  }

  function formatRemaining(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + ('0' + s).slice(-2);
  }
  function formatTime(ts) {
    var d = new Date(ts), now = new Date();
    var time = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (d.toDateString() === now.toDateString()) return time;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time;
  }

  /* ---------------- Web notifications ---------------- */
  function initSW() {
    if (isNative() || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
    }).catch(function () {});
  }
  function webNotify(word) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    var title = word.kana;
    var body = tr('notificationEnglish') + ': ' + word.en + '\n' + tr('notificationBangla') + ': ' + word.bn;
    var opts = {
      body: body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'kanapet-word',
      renotify: true,
      data: { url: './' }
    };
    try {
      if (swReg && swReg.showNotification) { swReg.showNotification(title, opts); return true; }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg && reg.showNotification) reg.showNotification(title, opts);
        }).catch(function () {});
        return true;
      }
      var n = new Notification(title, opts);
      n.onclick = function () { try { window.focus(); n.close(); } catch (e) {} };
      return true;
    } catch (e) { return false; }
  }
  function webTick() {
    if (!settings.enabled || isNative()) return;
    var now = Date.now();
    if (!settings.nextAt) { settings.nextAt = now + INTERVAL_MIN * 60000; save(); }
    if (now >= settings.nextAt) {
      var w = pickWord();
      if (w) {
        var rec = normalizeWord({ kana: w.kana, romaji: w.romaji, en: w.en, bn: w.bn, ts: now });
        mergeHistory([rec]);
        webNotify(rec);
      }
      settings.nextAt = now + INTERVAL_MIN * 60000;
      save();
      renderHistory();
      renderStatus();
    }
  }
  function startWebTimer() {
    stopWebTimer();
    webTick();
    webTimer = setInterval(webTick, 1000);
  }
  function stopWebTimer() { if (webTimer) { clearInterval(webTimer); webTimer = null; } }

  /* ---------------- Native bridge ---------------- */
  function nativeStart() {
    var p = getNative();
    if (!p || !p.start) return Promise.reject(new Error('native plugin missing'));
    return p.start({ words: JSON.stringify(wordPool()), intervalMin: INTERVAL_MIN, lang: langCode() }).then(function (res) {
      if (res) {
        settings.enabled = res.running !== false;
        if (res.nextAt) settings.nextAt = +res.nextAt;
        settings.exact = res.exact !== false;
        settings.permission = res.granted !== false && res.permission !== false;
        save();
      }
      syncHistory();
      render();
      return res;
    });
  }
  function syncHistory() {
    var p = getNative();
    if (!p || !p.getHistory) return Promise.resolve();
    return p.getHistory().then(function (res) {
      var list = (res && res.history) || (Array.isArray(res) ? res : []);
      if (mergeHistory(list)) renderHistory();
      renderStatus();
    }).catch(function () {});
  }
  function pollNative() {
    var p = getNative();
    if (!p || !p.status || !settings.enabled) return;
    p.status().then(function (res) {
      if (!res) return;
      settings.enabled = !!res.running;
      if (res.nextAt) settings.nextAt = +res.nextAt;
      settings.exact = res.exact !== false;
      settings.permission = res.permission !== false;
      save();
      renderStatus();
      syncHistory();
      if (!settings.enabled) render();
    }).catch(function () {});
  }
  function startNativePoll() {
    stopNativePoll();
    nativePoll = setInterval(pollNative, 15000);
  }
  function stopNativePoll() { if (nativePoll) { clearInterval(nativePoll); nativePoll = null; } }

  /* ---------------- Start / stop ---------------- */
  function start() {
    settings.enabled = true;
    save();
    if (isNative()) {
      nativeStart().then(function (res) {
        toast(tr('reminderStarted'));
        if (res && (res.granted === false || res.permission === false)) toast(tr('remindersPermission'));
        if (res && res.exact === false) toast(tr('exactAlarmHint'));
        startNativePoll();
        render();
      }).catch(function () {
        settings.enabled = false; settings.nextAt = 0; save();
        render();
        toast(tr('remindersNativeError'));
      });
      return;
    }
    // Web: the change event is a user gesture, safe to request permission.
    if (!('Notification' in window)) {
      settings.enabled = false; save(); render(); toast(tr('remindersPermission')); return;
    }
    var begin = function () {
      if (!settings.nextAt || settings.nextAt < Date.now()) settings.nextAt = Date.now() + INTERVAL_MIN * 60000;
      save(); startWebTimer(); render();
      toast(tr('reminderStarted'));
    };
    if (Notification.permission === 'granted') { begin(); return; }
    if (Notification.permission === 'denied') {
      settings.enabled = false; save(); render(); toast(tr('remindersPermission')); return;
    }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') begin();
      else { settings.enabled = false; save(); render(); toast(tr('reminderDenied')); }
    }).catch(function () {
      settings.enabled = false; save(); render(); toast(tr('reminderDenied'));
    });
  }

  function stop() {
    settings.enabled = false;
    settings.nextAt = 0;
    save();
    stopWebTimer();
    stopNativePoll();
    var p = getNative();
    if (p && p.stop) { try { p.stop(); } catch (e) {} }
    render();
    toast(tr('reminderStopped'));
  }

  function sendNow() {
    var p = getNative();
    if (p && p.sendNow) {
      p.sendNow().then(function (res) {
        if (res && res.word) mergeHistory([res.word]);
        syncHistory();
        render();
        toast(tr('wordSent'));
      }).catch(function () {
        toast(tr('remindersNativeError'));
      });
      return;
    }
    var word = pickWord();
    if (!word) return;
    var rec = normalizeWord({ kana: word.kana, romaji: word.romaji, en: word.en, bn: word.bn, ts: Date.now() });
    mergeHistory([rec]);
    if (('Notification' in window) && Notification.permission === 'granted') webNotify(rec);
    settings.nextAt = Date.now() + INTERVAL_MIN * 60000;
    save();
    render();
    toast(tr('wordSent'));
  }

  function clearHistory() {
    var p = getNative();
    if (p && p.clearHistory) { try { p.clearHistory(); } catch (e) {} }
    history = [];
    save();
    renderHistory();
    renderStatus();
    toast(tr('historyCleared'));
  }

  /* ---------------- UI ---------------- */
  function renderStatus() {
    var el = $('#reminder-status');
    var note = $('#reminder-note');
    var cb = $('#set-reminders');
    var exactBtn = $('#reminder-exact');
    if (!el) return;
    if (cb) cb.checked = !!settings.enabled;
    el.classList.remove('off', 'warn');
    var text;
    if (!settings.enabled) {
      el.classList.add('off');
      text = tr('remindersOff');
    } else {
      text = tr(isNative() ? 'remindersRunning' : 'remindersOn', { time: formatRemaining(settings.nextAt - Date.now()) });
    }
    if (settings.enabled && settings.permission === false) {
      el.classList.add('warn');
      text = tr('remindersPermission') + ' · ' + text;
    }
    if (text !== lastStatus) { el.textContent = text; lastStatus = text; }
    if (note) {
      var n = '';
      if (isNative() && settings.exact === false) n = tr('exactAlarmHint');
      else if (!isNative()) n = tr('remindersWebNote');
      if (note.textContent !== n) note.textContent = n;
    }
    if (exactBtn) exactBtn.style.display = (isNative() && settings.exact === false) ? '' : 'none';
  }

  function renderHistory() {
    var list = $('#reminder-history');
    var practice = $('#reminder-practice');
    if (!list) return;
    list.innerHTML = '';
    if (!history.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = tr('noWordHistory');
      list.appendChild(empty);
      if (practice) practice.style.display = 'none';
      practiceWordCount = 0;
      return;
    }
    var seen = {};
    practiceWordCount = 0;
    history.slice(0, 60).forEach(function (w) {
      if (!seen[w.kana]) { seen[w.kana] = true; practiceWordCount++; }
      var row = document.createElement('div');
      row.className = 'error-row reminder-row';
      var k = document.createElement('span');
      k.className = 'k jp kana-sound';
      k.setAttribute('data-speak', w.kana);
      k.setAttribute('role', 'button');
      k.setAttribute('tabindex', '0');
      k.textContent = w.kana;
      var info = document.createElement('div');
      info.className = 'info';
      var r = document.createElement('div');
      r.className = 'r';
      r.textContent = (w.romaji ? w.romaji + ' · ' : '') + w.en;
      var sub = document.createElement('div');
      sub.className = 'sub';
      var bn = document.createElement('span');
      bn.className = 'bn';
      bn.textContent = tr('notificationBangla') + ': ' + w.bn;
      sub.appendChild(bn);
      sub.appendChild(document.createElement('br'));
      sub.appendChild(document.createTextNode(formatTime(w.ts)));
      info.appendChild(r); info.appendChild(sub);
      var time = document.createElement('span');
      time.className = 'time';
      time.textContent = tr('tenMinutesShort');
      row.appendChild(k); row.appendChild(info); row.appendChild(time);
      list.appendChild(row);
    });
    if (practice) practice.style.display = practiceWordCount ? '' : 'none';
  }

  function render() { renderStatus(); renderHistory(); }

  function practiceRecent() {
    var seen = {}, words = [];
    history.slice(0, 30).forEach(function (w) {
      if (!seen[w.kana]) { seen[w.kana] = true; words.push(w.kana); }
    });
    if (window.KanaPetPracticeWords) window.KanaPetPracticeWords(words);
  }

  function openExactSettings() {
    var p = getNative();
    if (p && p.openExactAlarmSettings) { try { p.openExactAlarmSettings(); } catch (e) {} }
  }

  function bind() {
    var cb = $('#set-reminders');
    if (cb) cb.addEventListener('change', function () { if (cb.checked) start(); else stop(); });
    var test = $('#reminder-test');
    if (test) test.addEventListener('click', sendNow);
    var clear = $('#reminder-clear');
    if (clear) clear.addEventListener('click', clearHistory);
    var practice = $('#reminder-practice');
    if (practice) practice.addEventListener('click', practiceRecent);
    var exact = $('#reminder-exact');
    if (exact) exact.addEventListener('click', openExactSettings);
    window.addEventListener('languageChanged', function () { nativeSyncLanguage(); render(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (isNative()) { pollNative(); syncHistory(); }
      renderStatus();
    });
  }

  var uiTimer = null;
  function startUiTimer() {
    if (uiTimer) return;
    uiTimer = setInterval(function () {
      if (!settings.enabled) return;
      var page = document.getElementById('tab-profile');
      if (page && page.classList.contains('active')) renderStatus();
    }, 1000);
  }

  function init() {
    initSW();
    bind();
    nativeSyncLanguage();
    render();
    startUiTimer();
    if (!settings.enabled) {
      // Native reminders can outlive the WebView's localStorage (update,
      // backup restore, cleared site data). Adopt them if they are running.
      if (isNative()) {
        getNative().status().then(function (res) {
          if (res && res.running) {
            settings.enabled = true;
            settings.nextAt = +res.nextAt || 0;
            settings.exact = res.exact !== false;
            settings.permission = res.permission !== false;
            save();
            syncHistory();
            startNativePoll();
            render();
          }
        }).catch(function () {});
      }
      return;
    }

    if (isNative()) {
      // Re-push the current word pool and make sure the alarm chain exists
      // (e.g. after an app update or reboot). History lives natively.
      getNative().status().then(function (res) {
        if (res && res.running) {
          settings.nextAt = +res.nextAt || settings.nextAt;
          settings.exact = res.exact !== false;
          settings.permission = res.permission !== false;
          save();
          syncHistory();
          startNativePoll();
          render();
        } else {
          nativeStart().then(function () { startNativePoll(); });
        }
      }).catch(function () {
        nativeStart().then(function () { startNativePoll(); });
      });
    } else {
      if (('Notification' in window) && Notification.permission === 'granted') {
        if (!settings.nextAt || settings.nextAt < Date.now()) settings.nextAt = Date.now() + INTERVAL_MIN * 60000;
        save();
        startWebTimer();
        render();
      } else {
        settings.enabled = false; save(); render();
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.KanaPetReminders = {
    init: init,
    start: start,
    stop: stop,
    sendNow: sendNow,
    clearHistory: clearHistory,
    getHistory: function () { return history.slice(); },
    wordPool: wordPool,
    isNative: isNative
  };
})();
