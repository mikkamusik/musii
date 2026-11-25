import type { Response } from 'express';

const clients = new Set<Response>();

export function addClient(res: Response) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function emit(type: string, data: unknown) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}

setInterval(() => {
  for (const c of clients) {
    try {
      c.write(': ping\n\n');
    } catch {
      clients.delete(c);
    }
  }
}, 25_000).unref();
