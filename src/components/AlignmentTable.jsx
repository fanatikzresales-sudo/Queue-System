import React, { useMemo, useState } from 'react';
import { getNiceAlignments, findAlignmentTimes, formatTime, minuteAlignInterval } from '../utils/calculations';
import { STAGE_COLOR_CLASSES } from './DelayStagesBuilder';

function AlignmentRow({ a, queueMs, isRecommended }) {
  const timeStr = formatTime(a.timeMs);
  const beforeStr =
    a.minutes > 0
      ? `${a.minutes}m ${a.seconds > 0 ? a.seconds + 's' : ''}before`
      : `${a.seconds}s before`;

  return (
    <tr className={`border-b border-gray-700/50 ${isRecommended ? 'bg-yellow-900/20' : 'hover:bg-gray-700/30'}`}>
      <td className="py-2 px-3 text-sm font-mono text-white">
        {timeStr}
        {isRecommended && (
          <span className="ml-2 text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded font-bold">
            RECOMMENDED
          </span>
        )}
      </td>
      <td className="py-2 px-3 text-sm text-gray-300">{beforeStr.replace('before', '').trim()} before queue</td>
      <td className="py-2 px-3 text-sm text-center text-gray-300">{a.cycles.toLocaleString()}</td>
      <td className="py-2 px-3 text-sm text-center">
        {a.isWholeMinute ? (
          <span className="text-green-400 font-bold">✓ Whole min</span>
        ) : a.isHalfMinute ? (
          <span className="text-blue-400">½ min</span>
        ) : a.isWholeSecond ? (
          <span className="text-gray-400">Whole sec</span>
        ) : (
          <span className="text-gray-500 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

function StageAlignmentPanel({ stage, idx, queueMs, windowMs }) {
  const [showAll, setShowAll] = useState(false);
  const colors = STAGE_COLOR_CLASSES[idx % STAGE_COLOR_CLASSES.length];

  const alignments = useMemo(() => {
    if (showAll) return findAlignmentTimes(queueMs, stage.delay, windowMs).slice(0, 60);
    return getNiceAlignments(queueMs, stage.delay, windowMs);
  }, [queueMs, stage.delay, windowMs, showAll]);

  const lcmMs = minuteAlignInterval(stage.delay);
  const minutePattern = lcmMs <= 60000
    ? 'Every minute'
    : lcmMs <= 120000
    ? 'Every 2 minutes'
    : `Every ${Math.round(lcmMs / 60000)} minutes`;

  // Recommend: ≥1 minute before and ≤8 min before, fewest cycles
  const recommended = alignments.find(
    (a) => a.msBeforeQueue >= 60000 && a.msBeforeQueue <= 8 * 60000
  );

  const isLast = true; // This panel is only shown for last stage in schedule view

  return (
    <div className={`rounded-xl border ${colors.border} overflow-hidden`}>
      <div className={`px-4 py-3 ${colors.bg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
          <span className={`font-bold text-sm ${colors.text}`}>
            Stage {idx + 1}: {stage.name} — {stage.delay >= 1000 ? stage.delay / 1000 + 's' : stage.delay + 'ms'} delay
          </span>
        </div>
        <span className="text-xs text-gray-400 bg-gray-900/50 px-2 py-0.5 rounded">
          {minutePattern} alignment
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-800/50 text-xs text-gray-500 uppercase tracking-wider">
              <th className="py-2 px-3 text-left">Switch to this delay at...</th>
              <th className="py-2 px-3 text-left">Time before queue</th>
              <th className="py-2 px-3 text-center">Refreshes until 8 AM</th>
              <th className="py-2 px-3 text-center">Alignment type</th>
            </tr>
          </thead>
          <tbody>
            {alignments.map((a) => (
              <AlignmentRow
                key={a.timeMs}
                a={a}
                queueMs={queueMs}
                isRecommended={recommended && a.timeMs === recommended.timeMs}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-gray-800/30 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          <span className="text-yellow-400">★</span> Recommended switch time is highlighted.
          Start at this exact time and your next refresh hits the queue precisely.
        </p>
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-blue-400 hover:text-blue-300 underline ml-4 whitespace-nowrap"
        >
          {showAll ? 'Show nice times only' : 'Show all times'}
        </button>
      </div>
    </div>
  );
}

export default function AlignmentTable({ stages, queueMs, startMs }) {
  const windowMs = queueMs - startMs;

  return (
    <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
      <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
        <span className="text-green-400">⟳</span> Alignment Times per Delay
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Each table shows the exact moments you can switch to that delay and guarantee a refresh lands
        on the queue start. Start your automation at one of these times — or switch delays at these points.
      </p>
      <div className="space-y-4">
        {stages.map((stage, idx) => (
          <StageAlignmentPanel
            key={stage.id}
            stage={stage}
            idx={idx}
            queueMs={queueMs}
            windowMs={windowMs}
          />
        ))}
      </div>
    </div>
  );
}
