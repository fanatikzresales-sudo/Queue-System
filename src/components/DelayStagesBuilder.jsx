import React from 'react';

const STAGE_COLORS = [
  { bg: 'bg-blue-900/40', border: 'border-blue-600/60', badge: 'bg-blue-700', text: 'text-blue-300', dot: 'bg-blue-400' },
  { bg: 'bg-purple-900/40', border: 'border-purple-600/60', badge: 'bg-purple-700', text: 'text-purple-300', dot: 'bg-purple-400' },
  { bg: 'bg-orange-900/40', border: 'border-orange-600/60', badge: 'bg-orange-700', text: 'text-orange-300', dot: 'bg-orange-400' },
  { bg: 'bg-green-900/40', border: 'border-green-600/60', badge: 'bg-green-700', text: 'text-green-300', dot: 'bg-green-400' },
  { bg: 'bg-pink-900/40', border: 'border-pink-600/60', badge: 'bg-pink-700', text: 'text-pink-300', dot: 'bg-pink-400' },
];

export const STAGE_COLOR_CLASSES = STAGE_COLORS;

const PRESETS = [
  { label: '10s (safe start)', value: 10000 },
  { label: '5s', value: 5000 },
  { label: '3s', value: 3000 },
  { label: '2s', value: 2000 },
  { label: '1.5s (final)', value: 1500 },
  { label: '1s', value: 1000 },
  { label: '500ms', value: 500 },
];

export default function DelayStagesBuilder({ stages, onChange }) {
  const addStage = () => {
    const lastDelay = stages.length ? stages[stages.length - 1].delay : 10000;
    onChange([
      ...stages,
      {
        id: Date.now(),
        name: `Stage ${stages.length + 1}`,
        delay: Math.max(500, Math.floor(lastDelay / 2)),
      },
    ]);
  };

  const removeStage = (id) => {
    if (stages.length <= 1) return;
    onChange(stages.filter((s) => s.id !== id));
  };

  const updateStage = (id, field, value) => {
    onChange(stages.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const formatDelay = (ms) => {
    if (ms >= 1000) return `${ms / 1000}s`;
    return `${ms}ms`;
  };

  return (
    <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-blue-400">⬇</span> Delay Stages
        </h2>
        <button
          onClick={addStage}
          disabled={stages.length >= 5}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          + Add Stage
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-4">
        Define your delay stages from <strong className="text-gray-300">slowest → fastest</strong>.
        Stage 1 runs first (safe/slow), last stage fires when the queue opens.
      </p>

      <div className="space-y-3">
        {stages.map((stage, idx) => {
          const colors = STAGE_COLORS[idx % STAGE_COLORS.length];
          const isLast = idx === stages.length - 1;
          return (
            <div
              key={stage.id}
              className={`rounded-xl p-4 border ${colors.bg} ${colors.border}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                  Stage {idx + 1}
                  {isLast ? ' · FINAL (must hit queue exactly)' : idx === 0 ? ' · START (proxy-safe)' : ''}
                </span>
                {stages.length > 1 && (
                  <button
                    onClick={() => removeStage(stage.id)}
                    className="ml-auto text-gray-500 hover:text-red-400 text-xs transition-colors"
                  >
                    ✕ Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Stage Name</label>
                  <input
                    type="text"
                    value={stage.name}
                    onChange={(e) => updateStage(stage.id, 'name', e.target.value)}
                    className="w-full bg-gray-900/70 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-yellow-400"
                    placeholder="e.g. Safe Start"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Delay — <span className="text-yellow-300 font-bold">{formatDelay(stage.delay)}</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={stage.delay}
                      min={100}
                      max={60000}
                      step={100}
                      onChange={(e) => updateStage(stage.id, 'delay', Math.max(100, Number(e.target.value)))}
                      className="w-full bg-gray-900/70 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-yellow-400"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.value}
                        onClick={() => updateStage(stage.id, 'delay', p.value)}
                        className={`text-xs px-2 py-0.5 rounded ${
                          stage.delay === p.value
                            ? 'bg-yellow-500 text-black font-bold'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        } transition-colors`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 text-xs text-gray-500">
        <span className="text-yellow-500 mt-0.5">ⓘ</span>
        <span>
          The automation stays at Stage 1 delay until the calculated switch time,
          then drops through each stage. The final stage's start time is calculated
          to hit the queue at <em>exactly</em> the right refresh.
        </span>
      </div>
    </div>
  );
}
