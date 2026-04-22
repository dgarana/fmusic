// Downloads yt-dlp and copies ffmpeg-static into resources/bin/.
// This script runs after `npm install` and after a fresh clone.
//
// Controlled via env vars (useful for cross-compilation builds):
//   FMUSIC_TARGET_PLATFORM = win32 | darwin | linux
//   FMUSIC_TARGET_ARCH     = x64 | arm64
//   FMUSIC_SKIP_BINARIES   = 1          -> skip everything (useful in CI lints)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

if (process.env.FMUSIC_SKIP_BINARIES === '1') {
  console.log('[postinstall] FMUSIC_SKIP_BINARIES=1 -> skipping binary setup.');
  process.exit(0);
}

const targetPlatform = process.env.FMUSIC_TARGET_PLATFORM || process.platform;
const targetArch = process.env.FMUSIC_TARGET_ARCH || process.arch;

const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'resources', 'bin');
fs.mkdirSync(binDir, { recursive: true });

// ---------- yt-dlp ----------

// Map (platform, arch) -> release asset filename on github.com/yt-dlp/yt-dlp.
function ytDlpAssetName(platform, arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'yt-dlp_arm64.exe';
    if (arch === 'ia32' || arch === 'x86') return 'yt-dlp_x86.exe';
    return 'yt-dlp.exe';
  }
  if (platform === 'darwin') {
    return 'yt-dlp_macos';
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    return 'yt-dlp_linux';
  }
  throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
}

function ytDlpLocalName(platform) {
  return platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https
        .get(
          currentUrl,
          {
            headers: {
              'User-Agent': 'fmusic-postinstall',
              Accept: 'application/octet-stream'
            }
          },
          (res) => {
            if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
              res.resume();
              return request(res.headers.location);
            }
            if (res.statusCode !== 200) {
              reject(new Error(`GET ${currentUrl} -> HTTP ${res.statusCode}`));
              res.resume();
              return;
            }
            const tmp = destination + '.part';
            const file = fs.createWriteStream(tmp);
            res.pipe(file);
            file.on('finish', () => {
              file.close(() => {
                fs.renameSync(tmp, destination);
                resolve();
              });
            });
            file.on('error', (err) => {
              fs.unlink(tmp, () => reject(err));
            });
          }
        )
        .on('error', reject);
    };
    request(url);
  });
}

async function ensureYtDlp() {
  const asset = ytDlpAssetName(targetPlatform, targetArch);
  const localName = ytDlpLocalName(targetPlatform);
  const dest = path.join(binDir, localName);

  if (fs.existsSync(dest)) {
    console.log(`[postinstall] yt-dlp already present at ${dest}`);
    return;
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  console.log(`[postinstall] Downloading yt-dlp asset ${asset} -> ${dest}`);
  await download(url, dest);

  if (targetPlatform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  console.log('[postinstall] yt-dlp installed.');
}

// ---------- ffmpeg ----------

function copyFfmpeg() {
  let ffmpegStaticPath;
  try {
    ffmpegStaticPath = require('ffmpeg-static');
  } catch (err) {
    console.warn('[postinstall] ffmpeg-static not installed yet; skipping ffmpeg copy.');
    return;
  }
  if (!ffmpegStaticPath || !fs.existsSync(ffmpegStaticPath)) {
    console.warn('[postinstall] ffmpeg-static did not resolve a valid binary path; skipping.');
    return;
  }
  const destName = targetPlatform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dest = path.join(binDir, destName);
  fs.copyFileSync(ffmpegStaticPath, dest);
  if (targetPlatform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  console.log(`[postinstall] ffmpeg copied to ${dest}`);
}

// ---------- ffprobe ----------

// yt-dlp's audio post-processing (`-x`) invokes ffprobe to identify the
// source codec. `ffmpeg-static` ships only ffmpeg, so without this extra
// step yt-dlp fails with:
//   ERROR: Postprocessing: unable to obtain file audio codec with ffprobe
// We pull the right ffprobe binary for the target (platform, arch) and drop it
// next to ffmpeg so `--ffmpeg-location <dir>` finds both.
function resolveFfprobeSource() {
  const filename = targetPlatform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const archDir =
    targetArch === 'x86' ? 'ia32' : targetArch === 'amd64' ? 'x64' : targetArch;

  try {
    const installerPackage = `@ffprobe-installer/${targetPlatform}-${archDir}`;
    const installerPath = require.resolve(`${installerPackage}/${filename}`);
    if (fs.existsSync(installerPath)) return installerPath;
  } catch (err) {
    // Fall through to ffprobe-static. This keeps FMUSIC_TARGET_* cross-builds
    // working when npm only installed optional dependencies for the host.
  }

  let ffprobeStatic;
  try {
    ffprobeStatic = require('ffprobe-static');
  } catch (err) {
    return null;
  }

  // Prefer the package's explicit target tree over `.path`, which resolves
  // for the host process and can be stale after changing FMUSIC_TARGET_*.
  const candidate = path.join(
    path.dirname(require.resolve('ffprobe-static/package.json')),
    'bin',
    targetPlatform,
    archDir,
    filename
  );
  if (fs.existsSync(candidate)) return candidate;

  const resolved = ffprobeStatic && ffprobeStatic.path;
  return resolved && fs.existsSync(resolved) ? resolved : null;
}

function copyFfprobe() {
  const src = resolveFfprobeSource();
  if (!src) {
    console.warn(
      '[postinstall] ffprobe did not resolve a valid binary for ' +
        `${targetPlatform}/${targetArch}; yt-dlp post-processing may fail.`
    );
    return;
  }
  const destName = targetPlatform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const dest = path.join(binDir, destName);
  fs.copyFileSync(src, dest);
  if (targetPlatform !== 'win32') {
    fs.chmodSync(dest, 0o755);
  }
  console.log(`[postinstall] ffprobe copied to ${dest}`);
}

// ---------- entry ----------

(async () => {
  try {
    await ensureYtDlp();
    copyFfmpeg();
    copyFfprobe();
    console.log('[postinstall] Binary setup complete.');
  } catch (err) {
    console.error('[postinstall] Failed:', err);
    // Do not fail the install; the app can offer to re-download from Settings.
    process.exitCode = 0;
  }
})();
