# KanaPet — Web Deploy Memory / Resume Playbook
> Updated 2026-10-27 for v1.22. Main resume file:
> `~/Downloads/kana/project details/SESSION_MEMORY.md`.

---

## 1. Identity
- **Project:** KanaPet — kana learning app (vanilla HTML/CSS/JS + Capacitor 6
  Android wrapper).
- **This folder:** `~/Downloads/kana/web-deploy` — the GitHub Pages repo.
- **Live URL:** https://nahid77777771-maker.github.io/kana-pet/
- **Live version:** v1.19 (last pushed). **Local files:** v1.22 (unpushed).
- **Latest public APK release:** v1.19. **Local APK:** v1.22.

## 2. Current state (IMPORTANT)
- `web-deploy` was fully synced to v1.22 on 2026-10-27.
- It is **not committed and not pushed**. Working tree is dirty.
- Nahid tests APK v1.22 first; push only after his approval.
- Do NOT claim the live site is v1.22 yet.

## 3. Git
- Remote: `https://github.com/nahid77777771-maker/kana-pet.git` (origin)
- Branch: `main`
- Last commit: `49ef6d1` — v1.19 offline voice pack + docs
- Deploy: GitHub Pages, root of `main`, `.nojekyll` present.
- Machine quirk: GitHub `git clone` / `ls-remote` can hang; push may be slow.

## 4. File mapping (source → deploy)
| Deploy file | Source |
|---|---|
| `index.html` | `project files/kanapet/www/web-version.html` |
| `app-shell.html` | `project files/kanapet/www/index.html` |
| `css/` | `www/css/` |
| `js/` | `www/js/` |
| `fonts/ icons/ audio/` | `www/fonts/`, `www/icons/`, `www/audio/` |
| `manifest.webmanifest`, `sw.js` | `www/` |

`web-deploy` is otherwise a copy of `www/`.

## 5. Sync command (after source edits)
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
```
Then (only when approved):
```bash
cd web-deploy
git add -A
git commit -m "v1.22: 10-minute reminders + full Bangla UI + PWA offline fonts"
git push origin main
```

## 6. What v1.22 contains
- 10-minute N5 word reminders:
  - Native Android alarm chain (closed-app delivery, boot restore, exact alarm
    optional).
  - Web timer + SW notification while page/PWA is open.
  - Profile "10-minute word station": toggle, next time, test send, history,
    clear, exact-alarm shortcut, practice recent words.
  - Notification order: kana, English, Bangla; Bangla labels when app language
    is Bangla.
- Full dynamic Bangla UI:
  - Working language selector in Profile.
  - Localized pet speech, charts, history/review, summary, toasts, download
    link, accessibility labels.
  - 817 curated Bangla meanings (`translations_words.js`).
- PWA:
  - Cache `kanapet-v1.22`; 26 core files including 8 fonts.
  - Network-first app shell, cache fallback; audio cached on first play.
  - `app-shell.html` removed from SW CORE (missing in APK).
- Fixes:
  - onboarding `<br>` rendering (`46 / characters / available`).
  - web notification waits for SW ready.
  - today label localized.
  - session count `10 / 10` (uses `session.size`).
  - review meta duplicate removed.
- Version: v1.22 in footer/i18n/SW; APK `12200`/`1.22`.

## 7. PWA verification
- HTTP test on `web-deploy` (port 8123):
  - SW activated; cache `kanapet-v1.22`; 26 entries; 8 fonts.
  - Offline reload after killing server: page loads, pool 46, v1.22, no errors.
  - `document.fonts.check` may be false if font unused; `fontCache: 8` confirms
    files are present.
  - Audio is NOT fully pre-cached; first play fetches and caches each clip.

## 8. Source architecture (for web)
- `index.html` = web entry; `app-shell.html` = APK shell copy.
- `www/js/n5words.js` (743 words) MUST load before `data.js`.
- `www/js/data.js` builds 1022 cards (208 basic + 41 N5 + 30 N4 + 743 reading).
- `www/js/i18n.js` + `translations_words.js` + `translations_bn.js` = language.
- `www/js/onboard.js` = first-run language modal.
- `www/js/reminders.js` = native/web reminders + history UI.
- `www/js/pet.js` = global pet actions/speech.
- `www/js/charts.js` = All Kana charts.
- `www/js/app.js` = sessions, audio, XP, i18n, language selector.
- `www/sw.js` = offline cache + notification display/click.

## 9. Gotchas
- Do not bump version strings in only one place; update en+bn `kanaPetVersion`,
  both HTML fallback footers, and SW cache.
- `VERSION` is 1.23 (next). APK v1.22 is already built.
- Live release asset remains v1.19 until a new release is created.
- Web reminders need the page/PWA open; only Android gives 24/7 delivery.
- Keep `app-shell.html` in deploy for compatibility even though SW no longer
  caches it.
- User tests first; no push without approval.
