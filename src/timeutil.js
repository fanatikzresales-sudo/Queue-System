'use strict';

// All "wall clock" logic uses America/Chicago (Central Time), because the
// Walmart Wednesday queue opens at 8:00 AM Central. Using the Intl API keeps
// DST handling correct without any dependencies.

const ZONE = 'America/Chicago';

function chicagoParts(epochMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const out = {};
  for (const p of dtf.formatToParts(epochMs)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday, // e.g. "Wed"
  };
}

// Convert a Central Time wall-clock moment to a UTC epoch (ms).
// Iterative correction converges in <= 3 steps, including across DST changes.
function epochForChicago(year, month, day, hour, minute, second = 0) {
  const want = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = want;
  for (let i = 0; i < 4; i++) {
    const p = chicagoParts(guess);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = want - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

// Next Wednesday 8:00:00 AM Central at/after `nowEpochMs`.
// If it is Wednesday and before 8:00 AM CT, returns today's 8:00 AM CT.
function nextWednesdayGoLive(nowEpochMs = Date.now(), hour = 8, minute = 0) {
  const DAY = 86400000;
  for (let offset = 0; offset <= 7; offset++) {
    const p = chicagoParts(nowEpochMs + offset * DAY);
    if (p.weekday !== 'Wed') continue;
    const epoch = epochForChicago(p.year, p.month, p.day, hour, minute, 0);
    if (epoch > nowEpochMs) return epoch;
  }
  throw new Error('could not find next Wednesday'); // unreachable
}

function formatCT(epochMs, { withDate = false, withMs = false } = {}) {
  const opts = {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  };
  if (withDate) {
    opts.weekday = 'short';
    opts.month = 'short';
    opts.day = 'numeric';
  }
  let s = new Intl.DateTimeFormat('en-US', opts).format(epochMs);
  if (withMs) {
    const ms = ((epochMs % 1000) + 1000) % 1000;
    s = s.replace(/(:\d{2})(\s?[AP]M)/i, `$1.${String(ms).padStart(3, '0')}$2`);
  }
  return `${s} CT`;
}

function formatTminus(ms) {
  const sign = ms < 0 ? '+' : '-';
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const core = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  return `T${sign}${core}`;
}

module.exports = { ZONE, chicagoParts, epochForChicago, nextWednesdayGoLive, formatCT, formatTminus };
