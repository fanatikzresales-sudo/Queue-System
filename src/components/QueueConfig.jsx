import React from 'react';

export default function QueueConfig({ queueHour, queueMinute, startHour, startMinute, onChange }) {
  const handleQueueTime = (e) => {
    const [h, m] = e.target.value.split(':').map(Number);
    onChange({ queueHour: h, queueMinute: m });
  };

  const handleStartTime = (e) => {
    const [h, m] = e.target.value.split(':').map(Number);
    onChange({ startHour: h, startMinute: m });
  };

  const toInputVal = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  return (
    <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-yellow-400">⚙</span> Queue Configuration
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">
            Queue Goes Live (Central Time)
          </label>
          <input
            type="time"
            value={toInputVal(queueHour, queueMinute)}
            onChange={handleQueueTime}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
          />
          <p className="text-xs text-gray-500 mt-1">Walmart Pokemon queue: every Wednesday 8:00 AM CT</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">
            Automation Start Time (CT)
          </label>
          <input
            type="time"
            value={toInputVal(startHour, startMinute)}
            onChange={handleStartTime}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400"
          />
          <p className="text-xs text-gray-500 mt-1">When you plan to launch the automation</p>
        </div>
      </div>
      <div className="mt-3 px-3 py-2 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
        <p className="text-xs text-yellow-300">
          <span className="font-semibold">How it works:</span> The calculator finds exact switch times so
          that your automation's refresh cycle lands <span className="text-yellow-400 font-bold">precisely</span> on
          the queue start — no early, no late.
        </p>
      </div>
    </div>
  );
}
