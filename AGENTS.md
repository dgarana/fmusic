# AGENTS.md

> Guía de orientación para agentes de IA que trabajen en este repositorio.
> Este documento describe _qué_ hace la app, _cómo_ está construida y
> _por qué_ se han tomado las decisiones actuales. Úsalo como punto de
> entrada antes de hacer cualquier cambio.

## 1. Qué es fmusic

App de escritorio **Electron + React + TypeScript** multiplataforma
(Windows · macOS · Linux) que permite:

1. Descargar audio de YouTube desde una URL o buscando por nombre.
2. Gestionar una biblioteca local (tracks, playlists, géneros).
3. Reproducir los archivos descargados con una cola integrada.

El motor de descarga es el binario standalone de `yt-dlp`, empaquetado
por plataforma. No se requiere Python en la máquina del usuario.

## 2. Arquitectura de alto nivel

Tres procesos Electron + un módulo compartido de tipos:

```
src/
├─ shared/                 # tipos + canales IPC (sin deps de Node/DOM)
│  ├─ types.ts
│  └─ channels.ts
├─ main/                   # Node.js -- lifecycle, FS, SQLite, spawn yt-dlp
│  ├─ index.ts             # app lifecycle, BrowserWindow, CSP, IPC init
│  ├─ ipc.ts               # ipcMain.handle para todos los canales
│  ├─ paths.ts             # resuelve binDir() en dev vs prod
│  ├─ settings.ts          # electron-store con defaults
│  ├─ ytdlp.ts             # wrapper: version/search/info/download
│  ├─ download-manager.ts  # cola secuencial, eventos job-update/track-added
│  ├─ updater.ts           # re-descarga de yt-dlp desde Settings
│  ├─ types.d.ts           # declaración `*.sql?raw`
│  └─ library/
│     ├─ db.ts             # better-sqlite3 + migrador
│     ├─ tracks-repo.ts
│     ├─ playlists-repo.ts
│     └─ migrations/
│        ├─ index.ts       # lista estática (imports ?raw)
│        └─ 001_initial.sql
├─ preload/
│  ├─ index.ts             # contextBridge -> window.fmusic
│  └─ index.d.ts           # tipos globales para el renderer
└─ renderer/               # React + Vite
   ├─ index.html
   └─ src/
      ├─ main.tsx
      ├─ App.tsx           # HashRouter + suscripciones IPC
      ├─ styles.css
      ├─ util.ts
      ├─ components/
      │  ├─ Sidebar.tsx
      │  └─ PlayerBar.tsx
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

Regla de oro: **el renderer nunca llama a APIs de Node ni al filesystem
directamente**. Toda operación privilegiada pasa por IPC → handler en
`src/main/ipc.ts` → servicio de dominio.

## 3. Flujos principales

### Descarga
1. UI llama `window.fmusic.enqueueDownload({ url })` (preload).
2. `ipc.ts` reenvía a `DownloadManager.enqueue()`.
3. Manager spawnéа `yt-dlp -x --audio-format mp3 ...` y parsea
   `--progress-template` vía un prefijo `__FMP__` para emitir eventos
   `job-update` al renderer.
4. Al terminar, lee ID3 con `music-metadata`, inserta en SQLite
   (`insertTrack`), emite `track-added` → la biblioteca se refresca.

### Búsqueda
`yt-dlp --flat-playlist --dump-json "ytsearch10:<query>"` → una línea
JSON por resultado. No dependemos de la API oficial de YouTube.

### Previsualización
Se usa un `<iframe>` de `https://www.youtube.com/embed/<id>`. La CSP de
`src/main/index.ts` permite ese origen.

### Reproducción
Howler con `trackStreamUrl()` (main devuelve un `file://` válido del
MP3 local). El store Zustand mantiene cola e índice.

## 4. Persistencia y migraciones

- Base SQLite `library.sqlite` bajo `app.getPath('userData')`.
- Tablas: `tracks`, `playlists`, `playlist_tracks`, `schema_history`.
- **Migraciones forward-only** registradas estáticamente en
  `src/main/library/migrations/index.ts` como `{ version, name, sql }`
  con SQL importado vía Vite `?raw` (así se empaquetan sin copiar
  archivos sueltos al build).
- Cada arranque: leer `PRAGMA user_version`, ejecutar pendientes en
  transacción, registrar en `schema_history`, actualizar `user_version`.
- **Antes de migrar** una DB existente se hace backup automático a
  `<userData>/backups/library-<ISO>.sqlite`.

**Para añadir una migración**:
1. Crea `src/main/library/migrations/NNN_descripcion.sql`.
2. `import mNNN from './NNN_descripcion.sql?raw';` en `index.ts`.
3. Añade `{ version: NNN, name: 'NNN_descripcion', sql: mNNN }` al array.

## 5. Distribución de binarios nativos

- `scripts/postinstall.js` corre tras `npm install`:
  - Detecta plataforma/arch (o lee `FMUSIC_TARGET_PLATFORM`/`ARCH`).
  - Descarga el asset correspondiente de `github.com/yt-dlp/yt-dlp`
    (`yt-dlp.exe`, `yt-dlp_macos`, `yt-dlp_linux` [+ aarch64/x86/arm64]).
  - Copia `ffmpeg-static/ffmpeg[.exe]` a `resources/bin/`.
  - `FMUSIC_SKIP_BINARIES=1` omite toda la descarga (usado en CI/typecheck).
- `electron-builder.yml` declara `extraResources: resources/bin` →
  `bin`. En runtime `paths.binDir()` resuelve:
  - Dev: `app.getAppPath()/resources/bin`
  - Prod: `process.resourcesPath/bin`
- Hay un **updater in-app** (`src/main/updater.ts`) que re-descarga el
  binario desde Ajustes → "Actualizar motor de descarga" cuando yt-dlp
  se rompe por cambios en YouTube.

## 6. Convenciones y decisiones

- **TypeScript estricto** en todo (`strict: true`).
- **ESM en el código fuente**, pero el bundle de main/preload se genera
  como **CJS** (lo que hace `electron-vite`). Por eso:
  - `electron-store@8` (CJS). `@10` es ESM-only y rompe `require()`.
  - `better-sqlite3@12.x` (tiene prebuilds para Node 24). `@11` caía a
    `node-gyp`, que rompe con Python 3.12+ (sin `distutils`).
  - Para que `music-metadata` exponga `parseFile`, `tsconfig.node.json`
    usa `customConditions: ["node"]`.
- **React Router** en modo `HashRouter` (Electron carga `file://`).
- **Zustand** sin middleware — estado simple.
- **Howler** para audio; no usamos Web Audio directamente.
- **`contextIsolation: true`**, `nodeIntegration: false`, preload
  expone solo la API mínima (`window.fmusic`).
- **CSP** restrictiva; solo se permiten `https://www.youtube.com`
  y `https://*.ytimg.com` externos (para el iframe de preview).

## 7. Comandos

```sh
npm install                          # instala deps + postinstall + rebuild nativo
FMUSIC_SKIP_BINARIES=1 npm install   # para CI/typecheck (omite yt-dlp/ffmpeg)
npm run dev                          # Electron + Vite con HMR
npm run build                        # compila main/preload/renderer a out/
npm run typecheck                    # tsc --noEmit sobre node + web
npm run dist:win                     # NSIS .exe
npm run dist:mac                     # DMG (requiere macOS)
npm run dist:linux                   # AppImage + .deb (requiere Linux)
```

## 8. Gotchas observados

1. **macOS no se puede empaquetar desde Windows/Linux.** electron-builder
   rechaza explícitamente (`Build for macOS is supported only on macOS`).
   Usa el workflow de GitHub Actions (`.github/workflows/release.yml`)
   que corre cada target en su propio runner.
2. **Symlinks en Windows.** Sin Developer Mode ni admin, 7za falla al
   extraer los bundles `winCodeSign-2.6.0.7z` (2 `.dylib` symlinks) y
   AppImage (iconos hicolor). Soluciones:
   - Activar Developer Mode en Windows, o
   - Usar el workflow CI (corre en Ubuntu/macOS nativo), o
   - Para Linux desde Windows, target `tar.gz` (sin symlinks).
3. **`parseFile` de music-metadata.** Requiere la condición `node` del
   `exports`. Si otro tsconfig lo pierde, fallará con "has no exported
   member 'parseFile'".
4. **`ERR_REQUIRE_ESM`**. Cualquier dep ESM-only importada por main
   crashea en runtime. Antes de añadir una dep a `main/`, comprueba que
   tenga `"exports"."require"` o `main` CJS.
5. **Rebuild nativo.** `better-sqlite3` debe estar compilado contra la
   ABI de Electron, no la de Node. `electron-builder install-app-deps`
   lo hace automáticamente en `postinstall`. Si editas la versión de
   Electron, borra `node_modules` y reinstala.
6. **Progreso de yt-dlp.** Si cambias `--progress-template`, actualiza
   también el parser en `src/main/ytdlp.ts` (busca `PROGRESS_PREFIX`).
7. **Runtime JS de yt-dlp.** A partir de fin 2025 yt-dlp requiere un
   runtime JS (Deno recomendado) para resolver retos de YouTube. Si el
   usuario lo tiene en PATH, yt-dlp lo usa solo. Si no, hay errores de
   descarga. Documentado en el README.

## 9. Añadir una nueva feature / canal IPC

1. Define el canal en `src/shared/channels.ts`.
2. Añade tipos de payload/retorno a `src/shared/types.ts`.
3. Implementa el handler en `src/main/ipc.ts` (`ipcMain.handle(...)`).
4. Expón la función en `src/preload/index.ts` dentro del objeto `api`.
5. Consume desde el renderer con `window.fmusic.<nuevaFuncion>(...)`.
6. Si hace falta emitir eventos main → renderer, `broadcast()` en
   `ipc.ts` y `onXxx` con `ipcRenderer.on` en preload.

## 10. CI / release

Workflow `.github/workflows/release.yml`:
- Dispara con tags `v*` o manualmente.
- Job `typecheck` bloquea los builds si hay errores de tipos.
- Matrix build en los 3 runners oficiales (`windows-latest`,
  `macos-latest`, `ubuntu-latest`).
- Job `release` (solo en tags) publica GitHub Release con los .exe,
  .dmg, .AppImage, .deb y `latest*.yml` para electron-updater.
- Firma de código deshabilitada (`CSC_IDENTITY_AUTO_DISCOVERY=false`);
  se activará cuando se aporten certs vía secrets del repo.

## 11. Cosas que NO hacer

- No importar `fs`, `child_process`, `path` u otros módulos Node desde
  el renderer.
- No añadir deps ESM-only a `main/` o `preload/` sin comprobar que
  tienen fallback CJS.
- No commitear binarios de `resources/bin/` (el postinstall los trae).
- No meter SQL dinámico concatenando strings sin parametrizar — usar
  siempre `prepare(...).run({ named })`.
- No hacer que una migración dependa de código de runtime (p. ej. leer
  datos desde la app para recomputar); debe ser SQL puro.
- No romper la convención `forward-only` de migraciones; si necesitas
  revertir un cambio, crea otra migración.

## 12. Referencias rápidas

- Tipos compartidos: `src/shared/types.ts`
- Canales IPC: `src/shared/channels.ts`
- Defaults de settings: `src/main/settings.ts`
- Esquema SQL: `src/main/library/migrations/001_initial.sql`
- CSP: `src/main/index.ts` (función `configureSecurity`)
- Plan original (análisis + trade-offs): ver historial de conversación
  o artifact del plan si está disponible.
