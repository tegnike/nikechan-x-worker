import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runWorkflow } from './worker.js';

export interface ServerOptions {
  port: number;
  host?: string;
}

export function startServer(options: ServerOptions): void {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        sendJson(res, 200, { ok: true, service: 'nikechan-x-worker' });
        return;
      }
      if (req.method === 'POST' && req.url === '/workflow') {
        const body = await readJsonBody(req);
        const report = await runWorkflow(body);
        sendJson(res, 200, report);
        return;
      }
      sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { error: message });
    }
  });

  server.listen(options.port, options.host ?? '127.0.0.1', () => {
    const address = server.address();
    const label = typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address);
    console.error(`[nikechan-x-worker] listening on ${label}`);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
