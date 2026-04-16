import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { binDir, ytDlpPath } from './paths.js';

function assetName(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'yt-dlp_arm64.exe';
    if (arch === 'ia32' || arch === 'x86') return 'yt-dlp_x86.exe';
    return 'yt-dlp.exe';
  }
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux') {
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    return 'yt-dlp_linux';
  }
  throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
}

function download(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string) => {
      https
        .get(
          currentUrl,
          {
            headers: {
              'User-Agent': 'fmusic-updater',
              Accept: 'application/octet-stream'
            }
          },
          (res) => {
            if (
              res.statusCode &&
              [301, 302, 303, 307, 308].includes(res.statusCode) &&
              res.headers.location
            ) {
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
            file.on('error', (err) => fs.unlink(tmp, () => reject(err)));
          }
        )
        .on('error', reject);
    };
    request(url);
  });
}

/**
 * Re-downloads yt-dlp from the latest GitHub release. Returns the new version string.
 */
export async function updateYtDlp(): Promise<{ path: string }> {
  const dir = binDir();
  fs.mkdirSync(dir, { recursive: true });
  const asset = assetName(process.platform, process.arch);
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
  const destination = ytDlpPath();
  const tmpDestination = path.join(dir, asset);
  await download(url, tmpDestination);
  if (tmpDestination !== destination) {
    fs.renameSync(tmpDestination, destination);
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(destination, 0o755);
  }
  return { path: destination };
}
