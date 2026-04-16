# fmusic

App de escritorio multiplataforma (Windows, macOS y Linux) para **descargar música
de YouTube**, **gestionar una biblioteca local** (playlists, géneros…) y
**escucharla** sin salir de la app.

Construida con **Electron + Vite + React + TypeScript** y apoyada en los
binarios standalone de **yt-dlp** y **FFmpeg** — no requiere Python instalado
en la máquina del usuario.

## Funcionalidades

### Búsqueda y descarga
- 🔎 **Buscar** canciones en YouTube por nombre, con **paginación** ("Cargar más" de 12 en 12) y previsualización de audio inline antes de descargar.
- ⬇️ **Descargar** audio desde URL de YouTube (MP3 / M4A / Opus, calidad configurable) con cola de descargas, progreso en tiempo real y botón para descartar notificaciones terminadas.
- 🔁 **Reanudar** descargas canceladas: volver a pulsar el botón en una descarga cancelada la reactiva.
- ℹ️ **Aviso** cuando se intenta descargar una URL que ya está en la biblioteca.
- 📋 La sección "Otras descargas" aparece por encima de los resultados de búsqueda para mayor visibilidad.

### Biblioteca y playlists
- 📚 **Biblioteca** en SQLite con tabla ordenable, búsqueda y filtro por género.
- 📝 **Playlists** con añadir / quitar / reordenar canciones.
- ♥ **Favoritos**: playlist especial protegida (no se puede eliminar); corazón en el reproductor para añadir o quitar la canción actual al instante.
- 🔄 **Actualización en tiempo real**: abrir una playlist y añadir canciones desde otro punto de la app actualiza la vista sin recargar.

### Reproductor
- 🎧 **Reproducción** integrada con cola, barra de progreso con **seek funcional** (arrastrar la barra lleva al punto exacto sin reiniciar la pista), controles y volumen (Howler.js).
- ⏮⏭ Los botones de pista anterior/siguiente se ocultan cuando no hay pista adyacente, sin desplazar el botón de play.
- 🎵 Metadatos enriquecidos de YouTube: portada, artista, álbum, género, año.

### Sonos
- 📡 **Streaming a Sonos**: descubre dispositivos Sonos en la red local y envía la pista actual a cualquiera de ellos con un clic.
- 🔊 Controles de **play / pausa / siguiente / anterior / volumen / seek** enrutados al Sonos cuando está activo.
- ■ Botón de **parar** por dispositivo individual sin afectar al resto.
- 🌐 Servidor HTTP interno con soporte de **Range requests** para que Sonos pueda buscar en la pista sin descargarla completa.

### Bandeja del sistema y mini reproductor
- 🖥️ **La app se mantiene en segundo plano** cuando se cierra la ventana principal (icono en la bandeja del sistema, sin cerrar realmente el proceso).
- 🎛️ **Mini reproductor flotante** (340 × 96 px, siempre encima): se abre haciendo clic en el icono de la bandeja.
  - Muestra portada, título, artista y controles básicos (anterior / play·pausa / siguiente).
  - **Arrastrable**: se puede mover libremente por la pantalla.
  - Botón **⤢** para recuperar la ventana principal y ocultar el mini reproductor.
- 🗂️ **Menú contextual del tray**: play/pausa, anterior, siguiente, "Abrir fmusic" y "Salir", con el título de la pista actual y tooltip actualizado en tiempo real.

### General
- ⚙️ **Ajustes**: carpeta de descarga, formato/calidad por defecto, estado de dependencias y botón para **actualizar yt-dlp** sin salir de la app.

## Stack

| Capa | Tecnología |
|------|-----------|
| Shell | **Electron 33** con `contextIsolation` |
| Frontend | **React 18 + Vite** + **TypeScript** |
| Bundler | **electron-vite** (main / preload / renderer unificados) |
| Estado | **Zustand** (player, biblioteca, descargas, Sonos) |
| Audio local | **Howler.js** + protocolo `fmusic-media:` con Range requests |
| Base de datos | **better-sqlite3** con migraciones versionadas |
| Descargas | **yt-dlp** + **FFmpeg** (binarios por plataforma, sin Python) |
| Sonos | **@svrooij/sonos** (UPnP / AVTransport SOAP) |
| Distribución | **electron-builder** (`.exe` NSIS, `.dmg` universal, `.AppImage`/`.deb`) |

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

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Electron + Vite en modo desarrollo con DevTools |
| `npm run build` | Compila main, preload y renderer |
| `npm run typecheck` | Comprueba tipos (node + web) |
| `npm run dist:win` | Genera instalable Windows (NSIS) |
| `npm run dist:mac` | Genera instalable macOS (DMG universal) |
| `npm run dist:linux` | Genera instalable Linux (AppImage + deb) |

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

La migración `002_favorites.sql` siembra la playlist "Favoritos" con
`INSERT OR IGNORE`, por lo que es idempotente. Además, `ensureBuiltinPlaylists()`
la garantiza también en cada arranque.

## Estructura del proyecto

```
fmusic/
├─ electron-builder.yml
├─ electron.vite.config.ts
├─ scripts/
│  └─ postinstall.js
├─ resources/bin/                  # yt-dlp + ffmpeg (gitignored)
└─ src/
   ├─ shared/                      # tipos y canales IPC compartidos
   │  ├─ channels.ts
   │  └─ types.ts
   ├─ main/                        # proceso Electron main
   │  ├─ index.ts                  # ventana principal, protocolo fmusic-media:, IPC
   │  ├─ ipc.ts
   │  ├─ tray.ts                   # icono de bandeja + menú contextual
   │  ├─ miniplayer.ts             # ventana flotante mini reproductor
   │  ├─ sonos.ts                  # control UPnP de dispositivos Sonos
   │  ├─ sonos-server.ts           # servidor HTTP interno para streaming a Sonos
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
   │  └─ index.ts                  # contextBridge → window.fmusic
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ App.tsx
         ├─ main.tsx
         ├─ styles.css
         ├─ components/
         │  ├─ Sidebar.tsx
         │  ├─ PlayerBar.tsx       # reproductor con seek, favoritos, Sonos
         │  ├─ TrayBridge.tsx      # sincroniza estado al tray y mini player
         │  └─ SonosPanel.tsx      # panel de dispositivos Sonos
         ├─ pages/
         │  ├─ DownloadPage.tsx
         │  ├─ LibraryPage.tsx
         │  ├─ PlaylistsPage.tsx
         │  ├─ SettingsPage.tsx
         │  └─ MiniPlayerPage.tsx  # UI del mini reproductor flotante
         └─ store/
            ├─ player.ts
            ├─ downloads.ts
            ├─ library.ts
            └─ sonos.ts
```

## Arquitectura IPC (mini reproductor y tray)

```
Renderer principal          Main process              Mini reproductor
─────────────────           ─────────────             ────────────────
TrayBridge
 sendTrayState()    ──►  tray:player-state  ──►  updateTray()
 sendMiniState()    ──►  mini:state-from-main ──►  mini:state  ──►  setState()

MiniPlayerPage
                           mini:command  ◄──  sendMiniCommand()
 expand    ◄── tray.show()   │
 prev/next ◄── tray:command ◄┘
```

El mini reproductor pide estado al arrancar (`request-state`), y el proceso
principal responde con el último estado cacheado para que nunca aparezca vacío.

## Protocolo `fmusic-media:`

Las pistas locales se sirven con un esquema personalizado
(`fmusic-media://track/<id>`) que incluye soporte completo de **Range requests**
(`206 Partial Content`) para que tanto Howler.js como los dispositivos Sonos
puedan buscar en el audio sin necesidad de descargarlo entero.

## Notas importantes

- **yt-dlp se rompe cuando YouTube cambia su player.** Desde Ajustes → "Actualizar
  motor de descarga" se puede re-descargar el binario más reciente sin cerrar
  la app.
- **Deno / runtime JS.** yt-dlp está moviéndose a requerir Deno para resolver
  los retos JS de YouTube. Si ves errores de descarga tras una actualización de
  yt-dlp, instala Deno (`deno --version`) y estará disponible automáticamente.
- **Firma de código.** Sin firmar, macOS mostrará el aviso de Gatekeeper y
  Windows el de SmartScreen. Para distribución profesional considera un
  Developer ID de Apple y un certificado EV de Windows.
- **Uso personal.** Respeta los términos de servicio de YouTube y los derechos
  de autor del material que descargues.

## Licencia

MIT.
