'use strict';

// In-memory mock of a Walmart-style SKU/queue endpoint. It lets you point a
// real refresh bot (or the built-in simulator) at it and see:
//   - whether a refresh happened at/after go-live (did you make the queue?)
//   - how each proxy is behaving (requests/min)
//   - when a proxy would get rate-limited / banned for hammering too fast
//
// Nothing here talks to Walmart; it is purely a local timing sandbox.

const { formatCT, formatTminus } = require('./timeutil');

class MockQueue {
  constructor(opts = {}) {
    this.goLiveEpochMs = opts.goLiveEpochMs ?? Date.now();
    // Ban rules: if a proxy makes >= banBurst requests within banWindowMs,
    // it gets temp-banned for banCooldownMs.
    this.banBurst = opts.banBurst ?? 25;
    this.banWindowMs = opts.banWindowMs ?? 10000;
    this.banCooldownMs = opts.banCooldownMs ?? 60000;
    this.minHumanGapMs = opts.minHumanGapMs ?? 250; // faster than this = suspicious
    this.proxies = new Map(); // id -> state
    this.hits = []; // full log
  }

  _proxy(id) {
    if (!this.proxies.has(id)) {
      this.proxies.set(id, {
        id,
        requests: [], // epoch ms
        blocked: 0,
        served: 0,
        bannedUntil: 0,
        firstSeen: null,
        madeQueueAt: null,
      });
    }
    return this.proxies.get(id);
  }

  // Record one refresh. Returns the response the bot would have seen.
  refresh(proxyId = 'default', nowMs = Date.now()) {
    const p = this._proxy(proxyId);
    if (p.firstSeen == null) p.firstSeen = nowMs;

    let status;
    let banned = false;

    if (nowMs < p.bannedUntil) {
      status = 'banned';
      banned = true;
      p.blocked++;
    } else {
      // Count requests in the trailing ban window.
      const windowStart = nowMs - this.banWindowMs;
      const recent = p.requests.filter((t) => t >= windowStart).length;
      if (recent + 1 >= this.banBurst) {
        p.bannedUntil = nowMs + this.banCooldownMs;
        status = 'ban_triggered';
        banned = true;
        p.blocked++;
      } else if (nowMs < this.goLiveEpochMs) {
        status = 'waiting_room'; // queue not open yet
        p.served++;
      } else {
        status = 'queue_open';
        p.served++;
        if (p.madeQueueAt == null) p.madeQueueAt = nowMs;
      }
    }

    p.requests.push(nowMs);
    const entry = {
      proxyId,
      epochMs: nowMs,
      ct: formatCT(nowMs, { withMs: true }),
      tminus: formatTminus(this.goLiveEpochMs - nowMs),
      status,
      banned,
    };
    this.hits.push(entry);
    return entry;
  }

  proxyReport(id) {
    const p = this.proxies.get(id);
    if (!p) return null;
    const rpm = this._recentRpm(p, Date.now());
    return {
      id: p.id,
      totalRequests: p.requests.length,
      served: p.served,
      blocked: p.blocked,
      currentlyBanned: Date.now() < p.bannedUntil,
      bannedUntilCT: p.bannedUntil ? formatCT(p.bannedUntil, { withMs: true }) : null,
      madeQueue: p.madeQueueAt != null,
      madeQueueAtCT: p.madeQueueAt ? formatCT(p.madeQueueAt, { withMs: true }) : null,
      recentRequestsPerMinute: rpm,
    };
  }

  _recentRpm(p, nowMs) {
    const windowStart = nowMs - 60000;
    return p.requests.filter((t) => t >= windowStart).length;
  }

  report() {
    return {
      goLiveCT: formatCT(this.goLiveEpochMs, { withDate: true, withMs: true }),
      totalHits: this.hits.length,
      proxies: [...this.proxies.keys()].map((id) => this.proxyReport(id)),
      rules: {
        banBurst: this.banBurst,
        banWindowMs: this.banWindowMs,
        banCooldownMs: this.banCooldownMs,
      },
    };
  }

  reset() {
    this.proxies.clear();
    this.hits = [];
  }
}

module.exports = { MockQueue };
