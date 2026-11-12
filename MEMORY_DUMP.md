# KanaPet — Web Deploy Memory / Resume Playbook
> Updated 2026-10-28 for v1.25. Main resume file:
> `~/Downloads/kana/project details/SESSION_MEMORY.md`.

## 1. State
- **Live URL:** https://nahidsarker771.github.io/kana-pet/
- **Live version:** v1.25 pushed 2026-10-28 (verify after Pages rebuild).
- **Code commit:** `83535e5` `v1.25: minimal Learn tab, fixed romaji eye, Review meanings`.
- **Latest APK release:** v1.25, asset `KanaPet.apk` (49,940,783 bytes).
- **Local APK:** `project files/apk/KanaPet-v1.25.apk`.
- **Source `VERSION`:** 1.26 (next build).
- Previous code: `952cab3` (v1.23). v1.24 was APK-only, not pushed.

## 2. Git
- Remote: `https://github.com/nahidsarker771/kana-pet.git` (origin)
- Branch: `main`; GitHub Pages from repo root; `.nojekyll` present.
- Audio is ~45 MB, so pushes can take a while.
- `web-deploy` docs are a follow-up commit; code commit `83535e5` is the v1.25 code.

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

## 5. What v1.25 contains
- **Review meanings:** Missed + History records store `key` + `meaning` on
  every answer and render a localized meaning line (`water`, `fish`; for kana
  cards `みず · water`). Legacy records get meanings via `recordEntry()` lookup.
- **Eye reveal:** eye ON shows the example word + meaning on the card front
  (`さかな (sakana) · fish`; reading/vocab just the meaning) and also reveals
  reading-card romaji until the session ends.
- **v1.24 Learn tab:** only Missed / Got it; Skip row + instruction text gone;
  eye in the progress row; no-scroll session layout 360×600–800; eye patches
  cards in place (flipped answers stay visible).
- **PWA:** cache `kanapet-v1.25`; 26 core files incl. 8 fonts; audio regex
  `/\/audio\/.*\.mp3$/` caches subdirectory packs on first play.
- Voice actors (Momo/Nanami/Yuki/Keita), pet sounds, 10-min reminders and
  Bangla UI unchanged from v1.23.

## 6. Verification
- Headless Chromium 151 (360×640/800): eye ON shows front word + meaning, no
  face overflow; Review Missed + History show localized meanings; legacy
  records backfilled (`み` → `みず · water`, `みず` → `water`).
- Re-checked v1.24: eye keeps flipped card; session has no scroll; Skip/hint
  elements absent; 0 app errors.
- APK v1.25: 12500 / 1.25 / sdk 30–34; APK `assets/public` JS/HTML/SW match
  source; debug-signed. No real-device test yet.
- Web push: verify live footer shows v1.25 and SW cache `kanapet-v1.25` after
  GitHub Pages rebuild.

## 7. Architecture (web)
- `index.html` = web entry; `app-shell.html` = APK shell copy.
- `www/js/n5words.js` (743 words) MUST load before `data.js`.
- `www/js/app.js` = sessions/audio/voice actor/XP/i18n/review records.
- `www/js/pet.js` = pet actions/speech + WebAudio sounds.
- `www/js/reminders.js` = native/web reminders + history.
- `www/js/charts.js`, `onboard.js`, `i18n.js` = support.
- `sw.js` = offline cache + notification click.

## 8. Gotchas
- Bump `kanaPetVersion` en+bn, both HTML fallbacks, and SW cache together.
- `VERSION` is 1.26; APK v1.25 is built/released.
- History keeps old records working via the kana + romaji + group backfill in
  `recordEntry()` — do not remove it.
- Edge only has Nanami + Keita for natural Japanese; Yuki is a pitch variant.
- PWA audio is cached on first play, not pre-cached.
- Keep `app-shell.html` in deploy for compatibility even though SW no longer
  caches it.
- No push without build/test; v1.22, v1.23 and v1.25 pushes were explicitly
  approved by Nahid.
