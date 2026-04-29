#!/usr/bin/env node

const endpoint = process.env.FMUSIC_MCP_URL || 'http://127.0.0.1:37654/mcp';
let buffer = Buffer.alloc(0);

function writeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message }
  });
}

function tryReadMessage() {
  const separator = buffer.indexOf('\r\n\r\n');
  if (separator < 0) return null;

  const header = buffer.subarray(0, separator).toString('utf8');
  const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
  if (!match) {
    buffer = buffer.subarray(separator + 4);
    return { error: 'Missing Content-Length header.' };
  }

  const length = Number(match[1]);
  const bodyStart = separator + 4;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) return null;

  const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
  buffer = buffer.subarray(bodyEnd);

  try {
    return { message: JSON.parse(body) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function forward(message) {
  const id = message && typeof message === 'object' ? message.id : null;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (response.status === 204) return;

    const text = await response.text();
    if (!response.ok) {
      writeError(id, -32603, `FMusic MCP HTTP ${response.status}: ${text}`);
      return;
    }

    if (text.trim()) {
      writeMessage(JSON.parse(text));
    }
  } catch (err) {
    writeError(
      id,
      -32603,
      `Could not reach FMusic MCP at ${endpoint}. Is FMusic running and MCP enabled? ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const next = tryReadMessage();
    if (!next) break;
    if (next.error) {
      writeError(null, -32700, next.error);
    } else {
      void forward(next.message);
    }
  }
});

process.stdin.resume();
