import React, { useState, useEffect, useMemo } from 'react';
import {
  dateToCtMs,
  isAligned,
  buildSchedule,
  formatTime,
  formatDuration,
  getNiceAlignments,
} from '../utils/calculations';

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00.000';
  const totalMs = Math.max(0, ms);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = Math.floor(totalMs % 1000);
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}.${String(millis).padStart(3, '0')}`;
}

export default function LiveDashboard({ stages, queueMs, startMs }) {
  const [nowMs, setNowMs] = useState(() => dateToCtMs(new Date()));

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(dateToCtMs(new Date()));
    }, 50);
    return () => clearInterval(id);
  }, []);

  const schedule = useMemo(
    () => buildSchedule(queueMs, stages, startMs),
    [queueMs, stages, startMs]
  );

  const msUntilQueue = queueMs - nowMs;
  const queuePassed = msUntilQueue <= 0;

  // Determine current recommended stage
  const currentEntry = useMemo(() => {
    if (queuePassed) return null;
    // Find which schedule entry we're currently in
    return (
      schedule.find(
        (e) => nowMs >= e.startMs && nowMs < e.endMs
      ) ?? (nowMs < schedule[0]?.startMs ? { stage: stages[0], isBeforeSchedule: true } : null)
    );
  }, [schedule, nowMs, queuePassed, stages]);

  const nextSwitchEntry = useMemo(() => {
    if (queuePassed) return null;
    const idx = schedule.findIndex((e) => nowMs >= e.startMs && nowMs < e.endMs);
    if (idx === -1) return null;
    return schedule[idx + 1] ?? null;
  }, [schedule, nowMs, queuePassed]);

  // Check alignment with last stage
  const lastStage = stages[stages.length - 1];
  const aligned = isAligned(queueMs, nowMs, lastStage.delay);
  const finalAlignments = useMemo(
    () => getNiceAlignments(queueMs, lastStage.delay, 15 * 60 * 1000).slice(0, 3),
    [queueMs, lastStage.delay]
  );

  // Next alignment time for the current stage
  const activeDelay = currentEntry?.stage?.delay ?? lastStage.delay;

  // Time until next switch
  const msUntilSwitch = nextSwitchEntry ? nextSwitchEntry.startMs - nowMs : null;

  const statusColor = queuePassed
    ? 'border-green-500 shadow-green-500/30'
    : aligned
    ? 'border-yellow-400 shadow-yellow-400/30'
    : 'border-blue-500 shadow-blue-500/30';

  return (
    <div className={`bg-gray-900 rounded-2xl border-2 shadow-xl p-5 ${statusColor} transition-colors duration-500`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-red-400 animate-pulse">●</span> Live Dashboard
        </h2>
        <span className="text-xs text-gray-400 font-mono">{formatTime(nowMs)}</span>
      </div>

      {queuePassed ? (
        <div className="text-center py-6">
          <div className="text-5xl mb-2">🎉</div>
          <div className="text-2xl font-black text-green-400">Queue is LIVE!</div>
          <div className="text-gray-400 text-sm mt-1">The Walmart queue has opened — good luck!</div>
        </div>
      ) : (
        <>
          {/* Big countdown */}
          <div className="text-center mb-5">
            <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Time Until Queue</div>
            <div className="font-black text-5xl tracking-tight font-mono text-white">
              {formatCountdown(msUntilQueue)}
            </div>
            {msUntilQueue < 3600000 && (
              <div className="text-xs text-gray-500 mt-1">
                {Math.floor(msUntilQueue / 60000)} minutes {Math.floor((msUntilQueue % 60000) / 1000)} seconds
              </div>
            )}
          </div>

          {/* Current delay recommendation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Use This Delay RIGHT NOW</div>
              {currentEntry ? (
                <>
                  <div className="text-3xl font-black text-yellow-400">
                    {activeDelay >= 1000 ? activeDelay / 1000 + 's' : activeDelay + 'ms'}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{currentEntry.stage?.name ?? 'Starting delay'}</div>
                </>
              ) : nowMs < (schedule[0]?.startMs ?? 0) ? (
                <>
                  <div className="text-xl font-bold text-gray-400">Not started yet</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Start automation at {formatTime(schedule[0]?.startMs ?? startMs)}
                  </div>
                </>
              ) : (
                <div className="text-gray-400 text-sm">No active stage</div>
              )}
            </div>

            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Next Delay Drop</div>
              {nextSwitchEntry ? (
                <>
                  <div className="text-3xl font-black text-blue-400">
                    {nextSwitchEntry.stage.delay >= 1000
                      ? nextSwitchEntry.stage.delay / 1000 + 's'
                      : nextSwitchEntry.stage.delay + 'ms'}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    in{' '}
                    <span className="text-white font-bold">
                      {formatCountdown(msUntilSwitch)}
                    </span>{' '}
                    at {formatTime(nextSwitchEntry.startMs)}
                  </div>
                </>
              ) : (
                <div className="text-gray-400 text-sm">Already on final delay</div>
              )}
            </div>
          </div>

          {/* Alignment status */}
          <div
            className={`rounded-xl p-3 border text-sm ${
              aligned
                ? 'bg-yellow-900/30 border-yellow-600/50 text-yellow-300'
                : 'bg-gray-800/50 border-gray-700 text-gray-400'
            }`}
          >
            {aligned ? (
              <span>
                <strong>✓ ALIGNED!</strong> Your{' '}
                {lastStage.delay >= 1000 ? lastStage.delay / 1000 + 's' : lastStage.delay + 'ms'} refresh cycle is
                synced to hit the queue at 8:00:00 AM exactly.
              </span>
            ) : (
              <span>
                Switch to{' '}
                <strong className="text-white">
                  {lastStage.delay >= 1000 ? lastStage.delay / 1000 + 's' : lastStage.delay + 'ms'}
                </strong>{' '}
                delay at one of these times to align with the queue:{' '}
                {finalAlignments.slice(0, 2).map((a) => (
                  <span key={a.timeMs} className="inline-block mx-1 font-mono text-blue-300">
                    {formatTime(a.timeMs, true)}
                  </span>
                ))}
              </span>
            )}
          </div>

          {/* Stage timeline mini */}
          {schedule.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-gray-500 mb-2">Today's schedule:</div>
              <div className="flex gap-1 flex-wrap">
                {schedule.map((e, idx) => {
                  const isActive = nowMs >= e.startMs && nowMs < e.endMs;
                  const isPast = nowMs >= e.endMs;
                  const delayLabel =
                    e.stage.delay >= 1000 ? e.stage.delay / 1000 + 's' : e.stage.delay + 'ms';
                  return (
                    <div
                      key={e.stage.id}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-mono border transition-all ${
                        isActive
                          ? 'bg-yellow-500 text-black border-yellow-400 font-bold shadow-lg shadow-yellow-500/30'
                          : isPast
                          ? 'bg-gray-700/30 border-gray-700 text-gray-500 line-through'
                          : 'bg-gray-700/50 border-gray-600 text-gray-300'
                      }`}
                    >
                      {delayLabel} → {formatTime(e.endMs, false)}
                      {isActive && ' ← NOW'}
                    </div>
                  );
                })}
                <div className="text-xs px-2.5 py-1.5 rounded-lg font-mono border border-yellow-600/50 bg-yellow-900/20 text-yellow-400 animate-pulse">
                  8:00 AM 🎯
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
