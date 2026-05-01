import http from 'node:http';
import type { Duplex } from 'node:stream';
import { getSettings } from './settings.js';
import { registerServicePort, unregisterServicePort } from './network.js';
import { handleRemoteRequest, handleRemoteUpgrade, isRemoteEnabled } from './remote-controller-server.js';
import { handleMobileRequest, isMobileSyncEnabled } from './mobile-server.js';
import { handleSonosRequest } from './sonos-server.js';

let server: http.Server | null = null;
let serverPort = 0;

export function isSonosEnabled(): boolean {
  // We check if the setting is enabled OR if the server is still running.
  // This allows the Sonos speaker to finish its current buffer/request
  // during the split second between the setting change and the server shutdown.
  return getSettings().sonosEnabled || server !== null;
}

export async function startUnifiedServer(): Promise<number> {
  if (server) return serverPort;

  const settings = getSettings();
  const port = settings.localServerPort || 0;

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      // Route to Sonos
      if (url.pathname.startsWith('/track/') && isSonosEnabled()) {
        return handleSonosRequest(req, res);
      }

      // Route to Mobile Sync
      if (url.pathname.startsWith('/download/') && isMobileSyncEnabled()) {
        return handleMobileRequest(req, res);
      }

      // Route to Remote Controller (multiple paths)
      if (
        (url.pathname === '/' ||
          url.pathname === '/remote' ||
          url.pathname.startsWith('/artwork/') ||
          url.pathname.startsWith('/remote-track/')) &&
        isRemoteEnabled()
      ) {
        return handleRemoteRequest(req, res);
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (url.pathname === '/remote-ws' && isRemoteEnabled()) {
        handleRemoteUpgrade(req, socket as Duplex, head);
      } else {
        socket.destroy();
      }
    });

    server.listen(port, '0.0.0.0', () => {
      serverPort = (server!.address() as { port: number }).port;
      registerServicePort('sonos-server', serverPort);
      registerServicePort('mobile-sync', serverPort);
      registerServicePort('remote-controller', serverPort);
      console.log(`[server-manager] Unified server listening on port ${serverPort}`);
      resolve(serverPort);
    });

    server.on('error', (err) => {
      console.error('[server-manager] Server error:', err);
      reject(err);
    });
  });
}

export function stopUnifiedServer(): void {
  if (server) {
    server.close();
    console.log('[server-manager] Unified server stopped');
  }
  server = null;
  serverPort = 0;
  unregisterServicePort('sonos-server');
  unregisterServicePort('mobile-sync');
  unregisterServicePort('remote-controller');
}

export function isUnifiedServerRunning(): boolean {
  return server !== null;
}
