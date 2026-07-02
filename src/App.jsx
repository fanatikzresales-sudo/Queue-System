import React, { useState, useMemo } from 'react';
import QueueConfig from './components/QueueConfig';
import DelayStagesBuilder from './components/DelayStagesBuilder';
import AlignmentTable from './components/AlignmentTable';
import ScheduleDisplay from './components/ScheduleDisplay';
import LiveDashboard from './components/LiveDashboard';

const DEFAULT_STAGES = [
  { id: 1, name: 'Safe Start', delay: 10000 },
  { id: 2, name: 'Mid Ramp', delay: 3000 },
  { id: 3, name: 'Final Push', delay: 1500 },
];

export default function App() {
  const [queueHour, setQueueHour] = useState(8);
  const [queueMinute, setQueueMinute] = useState(0);
  const [startHour, setStartHour] = useState(7);
  const [startMinute, setStartMinute] = useState(30);
  const [stages, setStages] = useState(DEFAULT_STAGES);

  const handleConfigChange = ({ queueHour: qh, queueMinute: qm, startHour: sh, startMinute: sm }) => {
    if (qh !== undefined) setQueueHour(qh);
    if (qm !== undefined) setQueueMinute(qm);
    if (sh !== undefined) setStartHour(sh);
    if (sm !== undefined) setStartMinute(sm);
  };

  const queueMs = useMemo(
    () => (queueHour * 60 + queueMinute) * 60 * 1000,
    [queueHour, queueMinute]
  );

  const startMs = useMemo(
    () => (startHour * 60 + startMinute) * 60 * 1000,
    [startHour, startMinute]
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-yellow-500 flex items-center justify-center text-black font-black text-sm">W</div>
            <div>
              <h1 className="text-base font-black text-white leading-tight">Walmart Queue Timer</h1>
              <p className="text-xs text-gray-400">Pokemon card queue synchronization calculator</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
            Live · Wednesday 8:00 AM CT
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Live Dashboard — always visible at top */}
        <LiveDashboard stages={stages} queueMs={queueMs} startMs={startMs} />

        {/* Config row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <QueueConfig
            queueHour={queueHour}
            queueMinute={queueMinute}
            startHour={startHour}
            startMinute={startMinute}
            onChange={handleConfigChange}
          />
          <DelayStagesBuilder stages={stages} onChange={setStages} />
        </div>

        {/* Schedule */}
        <ScheduleDisplay stages={stages} queueMs={queueMs} startMs={startMs} />

        {/* Alignment tables */}
        <AlignmentTable stages={stages} queueMs={queueMs} startMs={startMs} />

        {/* Explainer */}
        <div className="bg-gray-800/50 rounded-2xl p-5 border border-gray-700 text-sm text-gray-300 space-y-3">
          <h3 className="font-bold text-white text-base">How to use this tool</h3>
          <ol className="space-y-2 list-decimal list-inside">
            <li>
              <strong className="text-white">Set your queue time</strong> — default is 8:00 AM CT (Walmart's Pokemon Wednesday).
            </li>
            <li>
              <strong className="text-white">Set your start time</strong> — when you plan to launch your automation (e.g., 7:30 AM).
            </li>
            <li>
              <strong className="text-white">Configure delay stages</strong> — Stage 1 is your safe/slow delay to avoid proxy bans.
              The last stage is your final fast delay that must land exactly on the queue.
            </li>
            <li>
              <strong className="text-white">Follow the schedule</strong> — the Recommended Schedule shows exactly when to switch
              each delay so that your final stage refreshes land precisely at 8:00:00 AM.
            </li>
            <li>
              <strong className="text-white">Watch the Live Dashboard</strong> — it shows what delay to use RIGHT NOW, counts down to the
              queue, and tells you when to drop to the next stage. A yellow border means you're aligned!
            </li>
          </ol>
          <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/40 rounded-lg">
            <p className="text-xs text-blue-300">
              <strong>Example:</strong> With a 1,500ms final delay, the next whole-minute alignment before 8:00 AM is 7:57:00 AM
              (exactly 120 cycles × 1,500ms = 180,000ms = 3 minutes). Switch to 1,500ms at 7:57:00 AM and refresh 120 will fire at
              exactly 8:00:00:000 AM.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 mt-8 py-4 text-center text-xs text-gray-600">
        Walmart Queue Timer · All times in Central Time (CT) · Built for Pokemon Wednesday drops
      </footer>
    </div>
  );
}
