const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const electronPath = path.join(
  rootDir,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);
const outputDir = path.join(rootDir, 'docs', 'screenshots');
const userDataDir = path.join(rootDir, '.tmp', 'readme-screenshots-userdata');

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const child = spawn(electronPath, ['.'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    FMUSIC_SCREENSHOT_MODE: '1',
    FMUSIC_SCREENSHOT_OUTPUT_DIR: outputDir,
    FMUSIC_SCREENSHOT_USER_DATA_DIR: userDataDir
  }
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
