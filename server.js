/**
 * Mock Walmart Wednesday queue server + static host for the planner UI.
 *
 * Zero dependencies — run with: node server.js
 *
 * What it gives you:
 *   - Serves the planner UI at http://localhost:3000
 *   - A fake "item page" endpoint you can point any automation at:
 *         GET /api/queue/<sku>
 *     Before go-live it responds like a waiting room; at go-live it "opens"
 *     and hands out queue positions in arrival order — exactly why landing a
 *     refresh at 8:00:00.000 matters.
 *   - Every hit is logged with millisecond precision and its offset from
 *     go-live, so you can measure precisely when your automation's refreshes
 *     actually landed:  GET /api/hits
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zonedWallTimeToEpoch, nextWednesday } from './public/planner.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const QUEUE_TZ = 'America/Chicago';
const MAX_HITS = 5000;

/* ----------------------------- mock queue state --------------------------- */

const state = {
  // Default go-live: next Wednesday 8:00 PM Central. Change it from the UI or
  // POST /api/config for quick tests (e.g. two minutes from now).
  goLiveEpochMs: zonedWallTimeToEpoch(nextWednesday(QUEUE_TZ), '20:00', QUEUE_TZ),
  hits: [],
  positions: new Map(), // sku -> next queue position to hand out
};

function resetQueue() {
  state.hits = [];
  state.positions = new Map();
}

/* --------------------------------- helpers -------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/* -------------------------------- API routes ------------------------------ */

async function handleApi(req, res, url) {
  const now = Date.now();

  // GET /api/config — current mock go-live + server clock (for drift checks).
  if (url.pathname === '/api/config' && req.method === 'GET') {
    return sendJSON(res, 200, {
      goLiveEpochMs: state.goLiveEpochMs,
      timeZone: QUEUE_TZ,
      serverNow: now,
    });
  }

  // POST /api/config { goLiveEpochMs } — move the mock go-live (clears hits).
  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return sendJSON(res, 400, { error: 'invalid JSON' });
    }
    const t = Number(body.goLiveEpochMs);
    if (!Number.isFinite(t)) return sendJSON(res, 400, { error: 'goLiveEpochMs must be a number (epoch ms)' });
    state.goLiveEpochMs = t;
    resetQueue();
    return sendJSON(res, 200, { goLiveEpochMs: state.goLiveEpochMs, timeZone: QUEUE_TZ, serverNow: Date.now() });
  }

  // GET /api/queue/<sku> — the fake item/queue page. Point your automation here.
  if (url.pathname.startsWith('/api/queue/') && req.method === 'GET') {
    const sku = decodeURIComponent(url.pathname.slice('/api/queue/'.length)) || 'unknown';
    const offsetMs = now - state.goLiveEpochMs;
    const live = offsetMs >= 0;

    let position = null;
    if (live) {
      position = (state.positions.get(sku) || 0) + 1;
      state.positions.set(sku, position);
    }

    state.hits.push({ sku, epochMs: now, offsetMs, live, position });
    if (state.hits.length > MAX_HITS) state.hits.splice(0, state.hits.length - MAX_HITS);

    if (!live) {
      return sendJSON(res, 200, {
        sku,
        state: 'waiting_room',
        live: false,
        message: 'This item is not yet available. The queue has not opened.',
        msUntilLive: -offsetMs,
        goLiveEpochMs: state.goLiveEpochMs,
        serverNow: now,
      });
    }
    return sendJSON(res, 200, {
      sku,
      state: 'queue_open',
      live: true,
      message: `Queue is open — you are number ${position} in line for ${sku}.`,
      position,
      joinedAtOffsetMs: offsetMs,
      goLiveEpochMs: state.goLiveEpochMs,
      serverNow: now,
    });
  }

  // GET /api/hits[?sku=...] — the timing log.
  if (url.pathname === '/api/hits' && req.method === 'GET') {
    const sku = url.searchParams.get('sku');
    const hits = sku ? state.hits.filter((h) => h.sku === sku) : state.hits;
    return sendJSON(res, 200, { goLiveEpochMs: state.goLiveEpochMs, serverNow: now, count: hits.length, hits });
  }

  // DELETE /api/hits — clear the log and queue positions.
  if (url.pathname === '/api/hits' && req.method === 'DELETE') {
    resetQueue();
    return sendJSON(res, 200, { cleared: true });
  }

  return sendJSON(res, 404, { error: 'not found' });
}

/* ------------------------------- static files ----------------------------- */

async function handleStatic(req, res, url) {
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  path = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, path);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

/* ---------------------------------- server -------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await handleStatic(req, res, url);
    }
  } catch (err) {
    sendJSON(res, 500, { error: String(err && err.message) });
  }
});

server.listen(PORT, () => {
  console.log(`Queue timer running at  http://localhost:${PORT}`);
  console.log(`Mock queue endpoint:    http://localhost:${PORT}/api/queue/<sku>`);
  console.log(
    `Mock go-live currently: ${new Date(state.goLiveEpochMs).toLocaleString('en-US', {
      timeZone: QUEUE_TZ,
    })} Central`
  );
});
