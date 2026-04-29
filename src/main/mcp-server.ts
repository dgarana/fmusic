import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSettings } from './settings.js';
import { getTrack, listTracks } from './library/tracks-repo.js';
import { listPlaylists } from './library/playlists-repo.js';
import {
  dispatchRemoteControllerCommand,
  getRemoteControllerSnapshot
} from './remote-controller-server.js';
import type {
  McpServerInfo,
  RemoteControllerCommand,
  TrackQuery
} from '../shared/types.js';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

let server: http.Server | null = null;
let serverPort = 0;

const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false
};

const tools: McpTool[] = [
  {
    name: 'player_get_state',
    description: 'Return the current FMusic player state, including the active track, position, volume, downloads, and Sonos status.',
    inputSchema: emptySchema
  },
  {
    name: 'player_play',
    description: 'Start playback if FMusic is currently paused.',
    inputSchema: emptySchema
  },
  {
    name: 'player_pause',
    description: 'Pause playback if FMusic is currently playing.',
    inputSchema: emptySchema
  },
  {
    name: 'player_toggle_play',
    description: 'Toggle play/pause in FMusic.',
    inputSchema: emptySchema
  },
  {
    name: 'player_next',
    description: 'Skip to the next queued track.',
    inputSchema: emptySchema
  },
  {
    name: 'player_previous',
    description: 'Skip to the previous queued track.',
    inputSchema: emptySchema
  },
  {
    name: 'player_seek',
    description: 'Seek the current track to an absolute position in seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', minimum: 0 }
      },
      required: ['seconds'],
      additionalProperties: false
    }
  },
  {
    name: 'player_set_volume',
    description: 'Set FMusic volume. The value must be between 0 and 1.',
    inputSchema: {
      type: 'object',
      properties: {
        volume: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['volume'],
      additionalProperties: false
    }
  },
  {
    name: 'library_search',
    description: 'Search the local FMusic library.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        genre: { type: 'string' },
        playlistId: { type: 'number' },
        limit: { type: 'number', minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'library_get_track',
    description: 'Get one local library track by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'library_list_playlists',
    description: 'List local FMusic playlists.',
    inputSchema: emptySchema
  },
  {
    name: 'library_play_track',
    description: 'Play a local library track by id. Optionally pass queueTrackIds to set the queue context.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'number' },
        queueTrackIds: {
          type: 'array',
          items: { type: 'number' }
        }
      },
      required: ['trackId'],
      additionalProperties: false
    }
  }
];

function mcpUrl(): string | null {
  if (!server) return null;
  return `http://127.0.0.1:${serverPort}/mcp`;
}

export function getMcpServerInfo(): McpServerInfo {
  const enabled = getSettings().mcpServerEnabled;
  return {
    enabled,
    running: server !== null,
    url: enabled ? mcpUrl() : null
  };
}

export async function startMcpServer(): Promise<number> {
  if (server) return serverPort;
  if (!getSettings().mcpServerEnabled) return 0;

  const port = getSettings().mcpServerPort;
  if (!port || port < 1 || port > 65535) {
    console.warn('[mcp] MCP server not started: no valid port configured');
    return 0;
  }
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      void handleRequest(req, res).catch((err) => {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
        });
      });
    });
    server.on('error', (err) => {
      server = null;
      serverPort = 0;
      reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      serverPort = (server!.address() as { port: number }).port;
      console.log(`[mcp] FMusic MCP server listening on http://127.0.0.1:${serverPort}/mcp`);
      resolve(serverPort);
    });
  });
}

export function stopMcpServer(): void {
  if (server) {
    server.close();
    console.log('[mcp] FMusic MCP server stopped');
  }
  server = null;
  serverPort = 0;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (url.pathname !== '/mcp') {
    sendText(res, 404, 'Not Found');
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, getMcpServerInfo());
    return;
  }
  if (req.method !== 'POST') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const request = await readJson(req);
  if (Array.isArray(request)) {
    const responses = await Promise.all(request.map((item) => handleRpc(item)));
    sendJson(res, 200, responses.filter(Boolean));
    return;
  }

  const response = await handleRpc(request);
  if (!response) {
    res.writeHead(204);
    res.end();
    return;
  }
  sendJson(res, 200, response);
}

async function handleRpc(value: unknown): Promise<unknown> {
  const request = value as JsonRpcRequest;
  const id = request?.id ?? null;
  try {
    switch (request.method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'fmusic',
            version: '0.1.0'
          }
        });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools });
      case 'tools/call':
        return rpcResult(id, await callTool(request.params));
      default:
        return rpcError(id, -32601, `Unknown MCP method: ${request.method ?? 'missing'}`);
    }
  } catch (err) {
    return rpcError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

async function callTool(params: unknown): Promise<unknown> {
  const record = params as { name?: string; arguments?: Record<string, unknown> };
  const args = record.arguments ?? {};
  let data: unknown;

  switch (record.name) {
    case 'player_get_state':
      data = getRemoteControllerSnapshot();
      break;
    case 'player_play':
      if (!getRemoteControllerSnapshot()?.isPlaying) dispatchCommand({ type: 'toggle-play' });
      data = { ok: true };
      break;
    case 'player_pause':
      if (getRemoteControllerSnapshot()?.isPlaying) dispatchCommand({ type: 'toggle-play' });
      data = { ok: true };
      break;
    case 'player_toggle_play':
      dispatchCommand({ type: 'toggle-play' });
      data = { ok: true };
      break;
    case 'player_next':
      dispatchCommand({ type: 'next' });
      data = { ok: true };
      break;
    case 'player_previous':
      dispatchCommand({ type: 'prev' });
      data = { ok: true };
      break;
    case 'player_seek':
      dispatchCommand({ type: 'seek', seconds: numberArg(args, 'seconds', 0) });
      data = { ok: true };
      break;
    case 'player_set_volume':
      dispatchCommand({ type: 'volume', volume: Math.min(1, Math.max(0, numberArg(args, 'volume', 1))) });
      data = { ok: true };
      break;
    case 'library_search':
      data = listTracks(normalizeTrackQuery(args));
      break;
    case 'library_get_track':
      data = getTrack(numberArg(args, 'id'));
      break;
    case 'library_list_playlists':
      data = listPlaylists();
      break;
    case 'library_play_track': {
      const command: RemoteControllerCommand = {
        type: 'play-track',
        trackId: numberArg(args, 'trackId')
      };
      const queueTrackIds = numberArrayArg(args.queueTrackIds);
      if (queueTrackIds.length > 0) command.queueTrackIds = queueTrackIds;
      dispatchCommand(command);
      data = { ok: true };
      break;
    }
    default:
      throw new Error(`Unknown MCP tool: ${record.name ?? 'missing'}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function dispatchCommand(command: RemoteControllerCommand): void {
  if (!dispatchRemoteControllerCommand(command)) {
    throw new Error('FMusic renderer is not ready to receive player commands yet.');
  }
}

function normalizeTrackQuery(args: Record<string, unknown>): TrackQuery {
  const query: TrackQuery = {
    sortBy: 'downloadedAt',
    sortDir: 'desc',
    limit: Math.min(200, Math.max(1, Math.floor(numberArg(args, 'limit', 50))))
  };
  if (typeof args.search === 'string' && args.search.trim()) query.search = args.search.trim();
  if (typeof args.genre === 'string' && args.genre.trim()) query.genre = args.genre.trim();
  if (typeof args.playlistId === 'number' && Number.isFinite(args.playlistId)) {
    query.playlistId = Math.floor(args.playlistId);
  }
  return query;
}

function numberArg(args: Record<string, unknown>, key: string, fallback?: number): number {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing numeric argument: ${key}`);
}

function numberArrayArg(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function rpcResult(id: JsonRpcId, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'http://127.0.0.1'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
