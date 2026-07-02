'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { buildPlan, presets, MINUTE } = require('./planner');
const { MockQueue } = require('./mockqueue');
const { nextWednesdayGoLive, formatCT } = require('./timeutil');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// A single shared mock queue for interactive testing from the dashboard.
let liveMock = new MockQueue({ goLiveEpochMs: nextWednesdayGoLive() });

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

// Parse a config coming from query params or JSON body into buildPlan() shape.
function parseConfig(src = {}) {
  const cfg = {};
  if (src.goLiveEpochMs != null) cfg.goLiveEpochMs = Number(src.goLiveEpochMs);
  if (src.leadMs != null) cfg.leadMs = Number(src.leadMs);
  if (src.autoAlignFinal != null) cfg.autoAlignFinal = src.autoAlignFinal === true || src.autoAlignFinal === 'true';
  if (src.finalDelayMinMs != null) cfg.finalDelayMinMs = Number(src.finalDelayMinMs);
  if (src.finalDelayMaxMs != null) cfg.finalDelayMaxMs = Number(src.finalDelayMaxMs);
  if (src.banPerMinWarn != null) cfg.banPerMinWarn = Number(src.banPerMinWarn);
  if (src.banPerMinDanger != null) cfg.banPerMinDanger = Number(src.banPerMinDanger);
  if (Array.isArray(src.phases)) {
    cfg.phases = src.phases.map((p) => ({
      label: p.label,
      startBeforeMs: Number(p.startBeforeMs),
      delayMs: Number(p.delayMs),
    }));
  }
  if (src.preset && presets()[src.preset]) {
    const pre = presets()[src.preset];
    cfg.leadMs = cfg.leadMs ?? pre.leadMs;
    cfg.phases = cfg.phases ?? pre.phases;
  }
  return cfg;
}

// Run a plan against a throwaway mock queue at accelerated time so the user
// can see whether the schedule actually lands a refresh on go-live and whether
// any proxy would have been banned along the way.
function dryRun(cfg) {
  const plan = buildPlan(cfg);
  const goLive = plan.goLive.epochMs;
  const mock = new MockQueue({
    goLiveEpochMs: goLive,
    banBurst: cfg.banBurst ?? 25,
    banWindowMs: cfg.banWindowMs ?? 10000,
    banCooldownMs: cfg.banCooldownMs ?? 60000,
  });
  const proxyId = cfg.proxyId ?? 'sim-proxy';
  for (const fire of plan.fires) mock.refresh(proxyId, fire);
  return { plan, mockReport: mock.report(), sampleHits: mock.hits.slice(-12) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/api/next-golive') {
      const epoch = nextWednesdayGoLive();
      return send(res, 200, { epochMs: epoch, ct: formatCT(epoch, { withDate: true, withMs: true }) });
    }

    if (req.method === 'GET' && pathname === '/api/presets') {
      return send(res, 200, presets());
    }

    if (pathname === '/api/plan') {
      const src = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      const cfg = parseConfig(src);
      return send(res, 200, buildPlan(cfg));
    }

    if (pathname === '/api/dry-run' && req.method === 'POST') {
      const cfg = parseConfig(await readBody(req));
      return send(res, 200, dryRun(cfg));
    }

    // Live mock queue endpoints (point a real bot at these).
    if (pathname === '/api/mock/config' && req.method === 'POST') {
      const body = await readBody(req);
      liveMock = new MockQueue({
        goLiveEpochMs: body.goLiveEpochMs != null ? Number(body.goLiveEpochMs) : nextWednesdayGoLive(),
        banBurst: body.banBurst != null ? Number(body.banBurst) : undefined,
        banWindowMs: body.banWindowMs != null ? Number(body.banWindowMs) : undefined,
        banCooldownMs: body.banCooldownMs != null ? Number(body.banCooldownMs) : undefined,
      });
      return send(res, 200, liveMock.report());
    }

    // The endpoint a refresh bot would hit. ?proxy=ID identifies the proxy.
    if (pathname === '/api/mock/refresh') {
      const proxyId = url.searchParams.get('proxy') || 'default';
      return send(res, 200, liveMock.refresh(proxyId, Date.now()));
    }

    if (pathname === '/api/mock/report' && req.method === 'GET') {
      return send(res, 200, liveMock.report());
    }

    if (pathname === '/api/mock/reset' && req.method === 'POST') {
      liveMock.reset();
      return send(res, 200, { ok: true });
    }

    // Static files.
    if (req.method === 'GET') {
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.join(PUBLIC_DIR, rel);
      if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        const type =
          ext === '.html' ? 'text/html'
          : ext === '.js' ? 'text/javascript'
          : ext === '.css' ? 'text/css'
          : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        return res.end(fs.readFileSync(file));
      }
    }

    return send(res, 404, { error: 'not found', path: pathname });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Walmart queue delay planner running at http://localhost:${PORT}`);
  });
}

module.exports = { server, dryRun, parseConfig, MINUTE };
