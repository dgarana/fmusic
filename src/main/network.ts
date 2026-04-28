import os from 'node:os';

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

export function parseRange(
  rangeHeader: string,
  total: number
): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

export type ServiceName = 'sonos-server' | 'mobile-sync' | 'remote-controller';

const servicePorts = new Map<ServiceName, number>();

export function registerServicePort(name: ServiceName, port: number): void {
  servicePorts.set(name, port);
}

export function unregisterServicePort(name: ServiceName): void {
  servicePorts.set(name, 0);
}

export function getServicePort(name: ServiceName): number {
  return servicePorts.get(name) ?? 0;
}
