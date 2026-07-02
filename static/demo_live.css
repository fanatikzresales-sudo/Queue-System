.live-page header {
  margin-bottom: 1.25rem;
}

.live-badge {
  background: var(--success);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

.live-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-end;
  margin-bottom: 1.25rem;
}

.live-controls .field {
  margin: 0;
  min-width: 220px;
}

.live-controls button {
  width: auto;
  min-width: 180px;
  margin: 0;
}

.live-grid {
  display: grid;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}

@media (min-width: 900px) {
  .live-grid {
    grid-template-columns: 1.2fr 1fr;
  }
}

.live-countdown {
  text-align: center;
  padding: 2rem 1.5rem;
}

.countdown-label {
  color: var(--muted);
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.75rem;
}

.countdown-value {
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  margin-bottom: 0.5rem;
}

.countdown-value.urgent {
  color: var(--warning);
}

.countdown-value.live-now {
  color: var(--success);
  font-size: 2.5rem;
}

.queue-time {
  color: var(--muted);
  font-size: 0.95rem;
  margin-bottom: 1.25rem;
}

.progress-track {
  height: 8px;
  background: #0f1419;
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 0.85rem;
}

.progress-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--accent), var(--success));
  border-radius: 999px;
  transition: width 0.25s linear;
}

.status-line {
  font-size: 0.95rem;
  color: var(--muted);
}

.live-current h2 {
  margin-top: 0;
}

.state-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

.state-item {
  background: #0f1419;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.state-label {
  font-size: 0.78rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.state-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.state-value.ok {
  color: var(--success);
}

.state-value.bad {
  color: var(--danger);
}

.state-value.pending {
  color: var(--warning);
}

.event-feed {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.event {
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  font-size: 0.88rem;
  border-left: 3px solid var(--panel-border);
  background: #0f1419;
  animation: slideIn 0.25s ease-out;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

.event.refresh {
  border-left-color: var(--accent);
}

.event.drop {
  border-left-color: var(--warning);
}

.event.queue-live {
  border-left-color: var(--success);
  background: rgba(46, 204, 113, 0.1);
  font-weight: 700;
}

.event.placeholder {
  color: var(--muted);
  border-left-color: transparent;
}

.event time {
  color: var(--muted);
  font-family: "Consolas", "Monaco", monospace;
  margin-right: 0.5rem;
}

.refresh-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}

.refresh-timeline li {
  padding: 0.5rem 0.65rem;
  background: #0f1419;
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 0.82rem;
  color: var(--muted);
}

.refresh-timeline li.fired {
  border-color: rgba(0, 113, 206, 0.5);
  color: var(--text);
}

.refresh-timeline li.queue-live {
  border-color: var(--success);
  color: var(--success);
  font-weight: 700;
}

tr.drop-done td {
  color: var(--success);
}

tr.drop-active td {
  color: var(--warning);
  font-weight: 600;
}
