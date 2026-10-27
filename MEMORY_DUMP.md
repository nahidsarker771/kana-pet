# KanaPet — Web Deploy Memory / Resume Playbook
> Updated 2026-10-27 for v1.23. Main resume file:
> `~/Downloads/kana/project details/SESSION_MEMORY.md`.

## 1. State
- **Live URL:** https://nahid77777771-maker.github.io/kana-pet/
- **Live version:** v1.23, verified 2026-10-27.
- **Code commit:** `952cab3` `v1.23: 4 offline voice actors + pet emotion sounds`.
- **Latest APK release:** v1.23, asset `KanaPet.apk` (49,939,959 bytes).
- **Local APK:** `project files/apk/KanaPet-v1.23.apk`.
- **Source `VERSION`:** 1.24 (next build).
- v1.22 (`abafd6c`) was also pushed and verified before v1.23.

## 2. Git
- Remote: `https://github.com/nahid77777771-maker/kana-pet.git` (origin)
- Branch: `main`; GitHub Pages from repo root; `.nojekyll` present.
- Audio is ~45 MB, so pushes can take a while.
- `web-deploy` docs are a follow-up commit; code commit `952cab3` is the v1.23 code.

## 3. File mapping (source → deploy)
| Deploy file | Source |
|---|---|
| `index.html` | `project files/kanapet/www/web-version.html` |
| `app-shell.html` | `project files/kanapet/www/index.html` |
| `css/` | `www/css/` |
| `js/` | `www/js/` |
| `fonts/ icons/` | `www/fonts/`, `www/icons/` |
| `audio/` | `www/audio/` (Momo root + nanami/ yuki/ keita/) |
| `manifest.webmanifest`, `sw.js` | `www/` |

## 4. Sync command
```bash
cd ~/Downloads/kana
cp "project files/kanapet/www/web-version.html" web-deploy/index.html
cp "project files/kanapet/www/index.html"        web-deploy/app-shell.html
cp "project files/kanapet/www/manifest.webmanifest" "project files/kanapet/www/sw.js" web-deploy/
rsync -a --delete "project files/kanapet/www/js/"    web-deploy/js/
rsync -a --delete "project files/kanapet/www/css/"   web-deploy/css/
rsync -a --delete "project files/kanapet/www/fonts/" web-deploy/fonts/
rsync -a --delete "project files/kanapet/www/icons/" web-deploy/icons/
rsync -a --delete "project files/kanapet/www/audio/" web-deploy/audio/
cd web-deploy && git add -A && git commit -m "..." && git push origin main
```

## 5. What v1.23 contains
- **Voice actors:** Momo (root, original female), Nanami
  (`audio/nanami/`, natural female), Yuki (`audio/yuki/`, Nanami +20Hz), Keita
  (`audio/keita/`, natural male). 1003 clips each; default Nanami; Profile
  cards select + preview `わたし`; fallback selected → Momo → device TTS.
- **Pet sounds:** WebAudio mew/chirp/purr/boop/sing/happy/sad/celebrate/
  grumble/sleepy/wobble; pet taps, tab changes, correct/wrong, celebration.
  Profile toggle `settings.petSounds` (default on).
- **PWA:** cache `kanapet-v1.23`; 26 core files incl. 8 fonts; audio regex
  `/\/audio\/.*\.mp3$/` caches subdirectory packs on first play.
- Bangla/English labels for the new controls.
- Version strings/APK: v1.23, `12300`.

## 6. Verification
- Headless file test: 4 cards; default Nanami; all four audio paths; selection
  persists; pet sounds off=0/on oscillators; Bangla labels; 0 errors.
- PWA HTTP test: SW `kanapet-v1.23`, 26 core files, 8 fonts, 4 audio clips
  cached, offline reload, voice persists; 0 errors.
- APK: 12300 / 1.23 / sdk 30–34; 1003 root + 3009 subdir clips; debug-signed;
  key assets match source. No real-device test yet.

## 7. Architecture (web)
- `index.html` = web entry; `app-shell.html` = APK shell copy.
- `www/js/n5words.js` (743 words) MUST load before `data.js`.
- `www/js/app.js` = sessions/audio/voice actor/XP/i18n.
- `www/js/pet.js` = pet actions/speech + WebAudio sounds.
- `www/js/reminders.js` = native/web reminders + history.
- `www/js/charts.js`, `onboard.js`, `i18n.js` = support.
- `sw.js` = offline cache + notification click.

## 8. Gotchas
- Bump `kanaPetVersion` en+bn, both HTML fallbacks, and SW cache together.
- `VERSION` is 1.24; APK v1.23 is built/released.
- Edge only has Nanami + Keita for natural Japanese; Yuki is a pitch variant.
- PWA audio is cached on first play, not pre-cached.
- Keep `app-shell.html` in deploy for compatibility even though SW no longer
  caches it.
- No push without build/test; v1.22/v1.23 pushes were explicitly approved.
