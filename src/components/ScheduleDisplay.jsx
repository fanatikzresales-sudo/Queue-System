import React, { useMemo } from 'react';
import { buildSchedule, getNiceAlignments, formatTime, formatDuration } from '../utils/calculations';
import { STAGE_COLOR_CLASSES } from './DelayStagesBuilder';

export default function ScheduleDisplay({ stages, queueMs, startMs }) {
  const schedule = useMemo(
    () => buildSchedule(queueMs, stages, startMs),
    [queueMs, stages, startMs]
  );

  if (!schedule.length) {
    return (
      <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
        <p className="text-gray-400 text-sm">Configure stages to see schedule.</p>
      </div>
    );
  }

  // Find the final stage alignment options (for info row)
  const lastStage = stages[stages.length - 1];
  const finalAlignments = useMemo(
    () => getNiceAlignments(queueMs, lastStage.delay, 10 * 60 * 1000).slice(0, 6),
    [queueMs, lastStage.delay]
  );

  return (
    <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
      <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
        <span className="text-yellow-400">📋</span> Recommended Schedule
      </h2>
      <p className="text-xs text-gray-400 mb-5">
        Based on your stages and start time. Follow this timeline on queue day.
      </p>

      {/* Timeline */}
      <div className="relative">
        {schedule.map((entry, idx) => {
          const colors = STAGE_COLOR_CLASSES[idx % STAGE_COLOR_CLASSES.length];
          const duration = entry.endMs - entry.startMs;
          const isLast = idx === schedule.length - 1;
          const delayLabel =
            entry.stage.delay >= 1000
              ? `${entry.stage.delay / 1000}s`
              : `${entry.stage.delay}ms`;

          return (
            <div key={entry.stage.id} className="flex gap-4 mb-1">
              {/* Timeline line */}
              <div className="flex flex-col items-center w-8 shrink-0">
                <div className={`w-3.5 h-3.5 rounded-full border-2 z-10 ${colors.dot} border-gray-800 shrink-0`} />
                {!isLast && <div className="w-0.5 bg-gray-600 flex-1 my-1" />}
              </div>

              {/* Content */}
              <div className={`flex-1 rounded-xl border p-4 mb-3 ${colors.bg} ${colors.border}`}>
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div>
                    <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                      Stage {idx + 1}: {entry.stage.name}
                    </span>
                    <div className="text-white font-bold text-base mt-0.5">
                      {formatTime(entry.startMs, true)}
                      <span className="text-gray-400 font-normal text-sm mx-2">→</span>
                      {isLast ? (
                        <span className="text-yellow-400">8:00:00 AM CT (Queue!)</span>
                      ) : (
                        formatTime(entry.endMs, true)
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-white">{delayLabel}</div>
                    <div className="text-xs text-gray-400">refresh delay</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-300">
                  <span>
                    ⏱ Duration: <strong className="text-white">{formatDuration(duration)}</strong>
                  </span>
                  {entry.switchAt && (
                    <span>
                      🔄 Cycles to queue:{' '}
                      <strong className="text-white">{entry.switchAt.cycles.toLocaleString()}</strong>
                    </span>
                  )}
                  <span className={`${isLast ? 'text-yellow-300' : 'text-gray-400'}`}>
                    {entry.note}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Queue goes live marker */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center w-8 shrink-0">
            <div className="w-4 h-4 rounded-full bg-yellow-400 border-2 border-yellow-300 shadow-lg shadow-yellow-400/50 z-10 shrink-0 animate-pulse" />
          </div>
          <div className="flex-1 rounded-xl border border-yellow-500/60 bg-yellow-900/30 p-4 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-yellow-400 font-black text-sm uppercase tracking-wider">🎯 QUEUE GOES LIVE</div>
                <div className="text-white font-bold text-lg mt-0.5">8:00:00 AM CT — Your refresh hits NOW</div>
              </div>
              <div className="text-yellow-400 text-3xl">🏆</div>
            </div>
          </div>
        </div>
      </div>

      {/* Alternative final-stage options */}
      <div className="mt-4 border-t border-gray-700 pt-4">
        <p className="text-xs font-semibold text-gray-300 mb-2">
          Alternative final-stage switch times for {lastStage.delay >= 1000 ? lastStage.delay / 1000 + 's' : lastStage.delay + 'ms'} delay:
        </p>
        <div className="flex flex-wrap gap-2">
          {finalAlignments.map((a) => {
            const isRec = a.msBeforeQueue >= 60000 && a.msBeforeQueue <= 8 * 60 * 1000;
            const label = a.minutes > 0
              ? `${a.minutes}m${a.seconds ? ' ' + a.seconds + 's' : ''} before`
              : `${a.seconds}s before`;
            return (
              <div
                key={a.timeMs}
                className={`text-xs px-3 py-1.5 rounded-lg font-mono border ${
                  isRec
                    ? 'bg-yellow-900/40 border-yellow-600 text-yellow-300'
                    : 'bg-gray-700/50 border-gray-600 text-gray-300'
                }`}
              >
                <span className="font-bold">{formatTime(a.timeMs, true)}</span>
                <span className="ml-1 opacity-70">({label}, {a.cycles} cycles)</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
