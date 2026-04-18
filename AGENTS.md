# AGENTS.md

> Orientation guide for AI agents working on this repository.
> This document describes _what_ the app does, _how_ it is built and
> _why_ the current decisions were made. Use it as the entry point
> before making any change.

## 1. What fmusic is

A cross-platform **Electron + React + TypeScript** desktop app
(Windows · macOS · Linux) that lets you:

1. Download audio from YouTube, either by URL or by searching by name.
2. Manage a local library (tracks, playlists, genres, editable metadata).
3. Play the downloaded files with a built-in queue.

The download engine is the standalone `yt-dlp` binary, bundled per
platform. No Python installation is required on the user's machine.

## 2. High-level architecture

Three Electron processes plus a shared types module:

```
src/
├─ shared/                 # types + IPC channels (no Node/DOM deps)
│  ├─ types.ts
│  ├─ channels.ts
│  └─ i18n/                # translation registry (en.json, es.json, index.ts)
├─ main/                   # Node.js -- lifecycle, FS, SQLite, spawn yt-dlp
│  ├─ index.ts             # app lifecycle, BrowserWindow, CSP, IPC init
│  ├─ ipc.ts               # ipcMain.handle for every channel
│  ├─ paths.ts             # resolves binDir() in dev vs prod
│  ├─ settings.ts          # electron-store with defaults
│  ├─ ytdlp.ts             # wrapper: version/search/info/download
│  ├─ download-manager.ts  # sequential queue, job-update/track-added events
│  ├─ updater.ts           # re-downloads yt-dlp from Settings
│  ├─ i18n.ts              # t() helper reading settings.language
│  ├─ types.d.ts           # declares `*.sql?raw`
│  └─ library/
│     ├─ db.ts             # better-sqlite3 + migration runner
│     ├─ tracks-repo.ts
│     ├─ playlists-repo.ts
│     └─ migrations/
│        ├─ index.ts       # static list (imports ?raw)
│        └─ 001_initial.sql
├─ preload/
│  ├─ index.ts             # contextBridge -> window.fmusic
│  └─ index.d.ts           # global types for the renderer
└─ renderer/               # React + Vite
   ├─ index.html
   └─ src/
      ├─ main.tsx
      ├─ App.tsx           # HashRouter + IPC subscriptions
      ├─ styles.css
      ├─ util.ts
      ├─ components/
      │  ├─ Sidebar.tsx
      │  └─ PlayerBar.tsx
      ├─ i18n.ts              # useT() hook + playlistDisplayName helper
      ├─ pages/
      │  ├─ DownloadPage.tsx
      │  ├─ LibraryPage.tsx
      │  ├─ PlaylistsPage.tsx
      │  └─ SettingsPage.tsx
      └─ store/            # Zustand
         ├─ downloads.ts
         ├─ library.ts
         └─ player.ts      # Howler
```

Golden rule: **the renderer never calls Node APIs or the filesystem
directly**. All privileged operations go through IPC → handler in
`src/main/ipc.ts` → domain service.

## 3. Main flows

### Download
1. The UI calls `window.fmusic.enqueueDownload({ url })` (preload).
2. `ipc.ts` forwards to `DownloadManager.enqueue()`.
3. The manager spawns `yt-dlp -x --audio-format mp3 ...` and parses the
   `--progress-template` lines (prefixed with `__FMP__`) to emit
   `job-update` events to the renderer.
4. When done, ID3 tags are read with `music-metadata`, the row is
   inserted in SQLite (`insertTrack`), and a `track-added` event is
   emitted → the library refreshes.

### Metadata editing
1. The Library UI calls `window.fmusic.updateTrack(id, patch)` (preload).
2. `ipc.ts` forwards to `tracks-repo.updateTrack()`.
3. The repository updates the SQLite row and, if the resolved file is an
   `.mp3`, mirrors the edit into the file's ID3 tags with `node-id3`.
4. The Library UI fetches fresh metadata suggestions from the repo so
   artist / album / genre autocompletion stays up to date.

### Search
`yt-dlp --flat-playlist --dump-json "ytsearch10:<query>"` → one JSON
line per result. We do not rely on YouTube's official API.

### Preview
We embed an `<iframe>` pointing at
`https://www.youtube.com/embed/<id>`. The CSP in
`src/main/index.ts` allows that origin.

### Playback
Howler with `trackStreamUrl()` (main returns a valid `file://` URL for
the local MP3). The Zustand store keeps the queue and current index.

## 4. Persistence and migrations

- SQLite database `library.sqlite` under `app.getPath('userData')`.
- Tables: `tracks`, `playlists`, `playlist_tracks`, `schema_history`.
- **Forward-only migrations** registered statically in
  `src/main/library/migrations/index.ts` as `{ version, name, sql }`
  entries with SQL imported via Vite's `?raw`, so they are bundled
  without shipping loose files.
- On every startup: read `PRAGMA user_version`, run pending migrations
  in a transaction, record each in `schema_history`, then update
  `user_version`.
- **Before migrating** an existing DB we take an automatic backup to
  `<userData>/backups/library-<ISO>.sqlite`.

**To add a migration**:
1. Create `src/main/library/migrations/NNN_description.sql`.
2. `import mNNN from './NNN_description.sql?raw';` in `index.ts`.
3. Add `{ version: NNN, name: 'NNN_description', sql: mNNN }` to the array.

### Built-in playlists
Built-in playlists (`Favorites`) carry a `slug` (e.g. `'favorites'`) in
the `playlists` table. User-created playlists have `slug = NULL`.
- DB stores a canonical English `name`; the UI never shows it directly
  for built-ins. Instead, `playlistDisplayName(p, t)` resolves
  `t('playlists.builtins.<slug>')`.
- `ensureBuiltinPlaylists()` matches by slug, not by name, so the row is
  re-created even if the `name` column was manually edited.
- `deletePlaylist()` refuses any row where `slug IS NOT NULL` so
  built-ins cannot be deleted from the UI.

## 5. Native binary distribution

- `scripts/postinstall.js` runs after `npm install`:
  - Detects platform/arch (or reads `FMUSIC_TARGET_PLATFORM`/`ARCH`).
  - Downloads the right asset from `github.com/yt-dlp/yt-dlp`
    (`yt-dlp.exe`, `yt-dlp_macos`, `yt-dlp_linux` [+ aarch64/x86/arm64]).
  - Copies `ffmpeg-static/ffmpeg[.exe]` to `resources/bin/`.
  - `FMUSIC_SKIP_BINARIES=1` skips the entire download (used in
    CI/typecheck).
- `electron-builder.yml` declares `extraResources: resources/bin` →
  `bin`. At runtime `paths.binDir()` resolves:
  - Dev: `app.getAppPath()/resources/bin`
  - Prod: `process.resourcesPath/bin`
- There is an **in-app updater** (`src/main/updater.ts`) that
  re-downloads the binary from Settings → "Update download engine"
  whenever yt-dlp breaks due to YouTube player changes.

## 6. Conventions and decisions

- **Strict TypeScript** everywhere (`strict: true`).
- **ESM in the source code**, but the main/preload bundle is produced
  as **CJS** (that's what `electron-vite` emits). Because of that:
  - `electron-store@8` (CJS). `@10` is ESM-only and breaks `require()`.
  - `better-sqlite3@12.x` (has prebuilds for Node 24). `@11` would fall
    back to `node-gyp`, which breaks with Python 3.12+ (no
    `distutils`).
  - To make `music-metadata` expose `parseFile`, `tsconfig.node.json`
    uses `customConditions: ["node"]`.
- **React Router** in `HashRouter` mode (Electron loads `file://`).
- **Zustand** without middleware — plain state.
- **Howler** for audio; we don't use the Web Audio API directly.
- **Metadata writes** use `node-id3`, so only MP3 files get on-disk tag
  updates. Keep that limitation in mind when extending manual editing to
  other formats.
- **`contextIsolation: true`**, `nodeIntegration: false`, preload
  exposes only the minimum API (`window.fmusic`).
- **Restrictive CSP**; only `https://www.youtube.com` and
  `https://*.ytimg.com` are allowed as external origins (for the
  preview iframe).
- **Internationalization**: all user-facing strings live in
  `src/shared/i18n/{en,es}.json`. Renderer uses `useT()` and subscribes
  to `settings.language`; main uses `t()` which re-reads settings on
  every call. When `language` changes the tray menu is re-built via
  `refreshTrayLanguage()` (triggered from the `SettingsUpdate` handler
  in `src/main/ipc.ts`). To add a locale, drop a new JSON, extend the
  `Locale` union in `shared/types.ts`, and register the bundle in
  `shared/i18n/index.ts`.

## 7. Commands

```sh
npm install                          # installs deps + postinstall + native rebuild
FMUSIC_SKIP_BINARIES=1 npm install   # for CI/typecheck (skips yt-dlp/ffmpeg)
npm run dev                          # Electron + Vite with HMR
npm run build                        # compiles main/preload/renderer to out/
npm run typecheck                    # tsc --noEmit over node + web
npm run dist:win                     # NSIS .exe
npm run dist:mac                     # DMG (requires macOS)
npm run dist:linux                   # AppImage + .deb (requires Linux)
```

## 8. Observed gotchas

1. **macOS cannot be packaged from Windows/Linux.** electron-builder
   refuses explicitly (`Build for macOS is supported only on macOS`).
   Use the GitHub Actions workflow (`.github/workflows/release.yml`)
   which runs each target on its own runner.
2. **Symlinks on Windows.** Without Developer Mode or admin, 7za fails
   to extract the `winCodeSign-2.6.0.7z` bundle (two `.dylib` symlinks)
   and AppImage (hicolor icons). Workarounds:
   - Enable Developer Mode on Windows, or
   - Use the CI workflow (runs on native Ubuntu/macOS), or
   - For Linux from Windows, target `tar.gz` (no symlinks).
3. **`parseFile` from music-metadata.** It requires the `node`
   condition in `exports`. If another tsconfig loses it, you'll get
   "has no exported member 'parseFile'".
4. **`ERR_REQUIRE_ESM`**. Any ESM-only dependency imported from main
   crashes at runtime. Before adding a new main-process dep, check it
   has `"exports"."require"` or a CJS `main`.
5. **Native rebuild.** `better-sqlite3` must be compiled against
   Electron's ABI, not Node's. `electron-builder install-app-deps`
   does it automatically in `postinstall`. If you change the Electron
   version, delete `node_modules` and reinstall.
6. **yt-dlp progress.** If you change `--progress-template`, update the
   parser in `src/main/ytdlp.ts` too (look for `PROGRESS_PREFIX`).
7. **yt-dlp JS runtime.** As of late 2025 yt-dlp requires a JS runtime
   (Deno recommended) to solve YouTube's challenges. If the user has it
   in PATH, yt-dlp picks it up automatically. If not, downloads will
   fail. Documented in the README.

## 9. Adding a new feature / IPC channel

1. Define the channel in `src/shared/channels.ts`.
2. Add the payload/return types to `src/shared/types.ts`.
3. Implement the handler in `src/main/ipc.ts` (`ipcMain.handle(...)`).
4. Expose the function in `src/preload/index.ts` inside the `api`
   object.
5. Consume it from the renderer with `window.fmusic.<newFunction>(...)`.
6. If you need to emit events main → renderer, use `broadcast()` in
   `ipc.ts` and `onXxx` with `ipcRenderer.on` in the preload.

## 10. CI / release

Workflow `.github/workflows/release.yml`:
- Triggered by `v*` tags or manual dispatch.
- The `typecheck` job blocks the builds if type errors exist.
- Matrix build on the three official runners (`windows-latest`,
  `macos-latest`, `ubuntu-latest`).
- The `release` job (tags only) publishes a GitHub Release with the
  .exe, .dmg, .AppImage, .deb and `latest*.yml` files for
  electron-updater.
- Code signing is disabled (`CSC_IDENTITY_AUTO_DISCOVERY=false`); it
  will be enabled once certs are provided via repo secrets.

## 11. Things NOT to do

- Don't import `fs`, `child_process`, `path` or other Node modules from
  the renderer.
- Don't add ESM-only deps to `main/` or `preload/` without checking
  there is a CJS fallback.
- Don't commit binaries to `resources/bin/` (the postinstall fetches
  them).
- Don't write dynamic SQL by concatenating strings without bind
  parameters — always use `prepare(...).run({ named })`.
- Don't make a migration depend on runtime code (e.g. reading data from
  the app to recompute); it must be pure SQL.
- Don't break the `forward-only` migration convention; if you need to
  revert a change, create another migration.

## 12. Quick references

- Shared types: `src/shared/types.ts`
- IPC channels: `src/shared/channels.ts`
- Settings defaults: `src/main/settings.ts`
- SQL schema: `src/main/library/migrations/001_initial.sql`
- CSP: `src/main/index.ts` (function `configureSecurity`)
- Original plan (analysis + trade-offs): see the conversation history
  or the plan artifact if available.
