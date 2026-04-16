# fmusic

App de escritorio multiplataforma (Windows, macOS y Linux) para **descargar música
de YouTube**, **gestionar una biblioteca local** (playlists, géneros…) y
**escucharla** sin salir de la app.

Construida con **Electron + Vite + React + TypeScript** y apoyada en los
binarios standalone de **yt-dlp** y **FFmpeg** — no requiere Python instalado
en la máquina del usuario.

## Funcionalidades

- 🔎 **Buscar** canciones en YouTube por nombre y previsualizarlas (iframe).
- ⬇️ **Descargar** audio desde una URL de YouTube (MP3 / M4A / Opus, calidad
  configurable) con una cola de descargas y progreso en tiempo real.
- 📚 **Biblioteca** en SQLite con tabla ordenable, búsqueda y filtro por género.
- 🎧 **Reproducción** integrada con cola, barra de progreso, controles y
  volumen (Howler.js).
- 📝 **Playlists** con añadir/quitar/reordenar.
- ⚙️ **Ajustes**: carpeta de descarga, formato/calidad por defecto, estado de
  dependencias y botón para **actualizar yt-dlp** sin salir de la app.

## Stack

- **Electron 33** — main + preload + renderer con `contextIsolation` activo.
- **React 18 + Vite** — renderer.
- **TypeScript** — en todos los procesos.
- **electron-vite** — bundling unificado de main/preload/renderer.
- **electron-builder** — instaladores `.exe` (NSIS), `.dmg` (universal) y
  `.AppImage` + `.deb`.
- **better-sqlite3** — biblioteca con migraciones versionadas.
- **Zustand** — estado del renderer (player, biblioteca, descargas).
- **Howler.js** — capa de audio.
- **yt-dlp** y **FFmpeg** — empaquetados como binarios por plataforma.

## Puesta en marcha

```bash
npm install
npm run dev
```

`npm install` lanza `scripts/postinstall.js` que descarga `yt-dlp` (plataforma
actual) desde el release más reciente y copia `ffmpeg-static` a
`resources/bin/`.

### Saltarse la descarga de binarios (por ejemplo en CI de typecheck)

```bash
FMUSIC_SKIP_BINARIES=1 npm install
```

### Compilación cruzada

Para preparar binarios para otra plataforma antes de empaquetar:

```bash
FMUSIC_TARGET_PLATFORM=linux FMUSIC_TARGET_ARCH=x64 npm run postinstall
```

## Comandos

- `npm run dev` — Electron + Vite en modo desarrollo con DevTools.
- `npm run build` — compila main, preload y renderer.
- `npm run typecheck` — comprueba tipos (node + web).
- `npm run dist:win` / `dist:mac` / `dist:linux` — genera el instalable.

## Migraciones de la base de datos

Al arrancar, la app aplica todas las migraciones con versión mayor que
`PRAGMA user_version`. Las migraciones viven en
`src/main/library/migrations/` y se registran estáticamente en
`src/main/library/migrations/index.ts` (importadas como strings `?raw`, lo que
permite empaquetarlas sin copiar archivos sueltos).

Para añadir una migración:

1. Crea `src/main/library/migrations/NNN_descripcion.sql`.
2. Impórtala y añádela al array de `migrations/index.ts`.

Cada migración se ejecuta en una transacción y se registra en la tabla
`schema_history`. Antes de aplicar migraciones sobre una base existente se hace
un backup automático en `<userData>/backups/library-<timestamp>.sqlite`.

## Estructura del proyecto

```
fmusic/
├─ electron-builder.yml
├─ electron.vite.config.ts
├─ scripts/
│  └─ postinstall.js
├─ resources/bin/                # yt-dlp + ffmpeg (gitignored)
└─ src/
   ├─ shared/                    # tipos y canales IPC compartidos
   ├─ main/                      # proceso Electron main
   │  ├─ index.ts
   │  ├─ ipc.ts
   │  ├─ paths.ts
   │  ├─ settings.ts
   │  ├─ download-manager.ts
   │  ├─ ytdlp.ts
   │  ├─ updater.ts
   │  └─ library/
   │     ├─ db.ts
   │     ├─ tracks-repo.ts
   │     ├─ playlists-repo.ts
   │     └─ migrations/
   ├─ preload/
   │  └─ index.ts                # contextBridge -> window.fmusic
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ App.tsx
         ├─ main.tsx
         ├─ styles.css
         ├─ components/ (Sidebar, PlayerBar)
         ├─ pages/     (Download, Library, Playlists, Settings)
         └─ store/     (player, downloads, library — Zustand)
```

## Notas importantes

- **yt-dlp se rompe cuando YouTube cambia su player.** Desde Ajustes → "Actualizar
  motor de descarga" se puede re-descargar el binario más reciente sin cerrar
  la app.
- **Deno / runtime JS.** yt-dlp está moviéndose a requerir Deno para resolver
  los retos JS de YouTube. Si ves errores de descarga tras una actualización de
  yt-dlp, instala Deno (`deno --version`) y estará disponible para yt-dlp de
  forma automática.
- **Firma de código.** Sin firmar, macOS mostrará el aviso de Gatekeeper y
  Windows el de SmartScreen. Para distribución profesional considera un
  Developer ID de Apple y un certificado EV de Windows.
- **Uso personal.** Respeta los términos de servicio de YouTube y los derechos
  de autor del material que descargues.

## Licencia

MIT.
