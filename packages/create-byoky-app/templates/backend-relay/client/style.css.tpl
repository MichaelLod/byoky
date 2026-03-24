*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #0a0a0a;
  --bg-secondary: #141414;
  --bg-tertiary: #1e1e1e;
  --text: #e0e0e0;
  --text-muted: #888;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --border: #2a2a2a;
  --success: #4ade80;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 48px 24px;
}

#app {
  width: 100%;
  max-width: 640px;
}

h1 {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 8px;
}

.subtitle {
  color: var(--text-muted);
  margin-bottom: 32px;
}

button {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 24px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

button:hover {
  background: var(--accent-hover);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
}

.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.card h2 {
  font-size: 1.1rem;
  margin-bottom: 12px;
}

textarea {
  width: 100%;
  background: var(--bg-tertiary);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-size: 0.95rem;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
  outline: none;
  margin-bottom: 12px;
}

.response-box {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  margin-top: 12px;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
  color: var(--text-muted);
}

.error {
  color: #f87171;
  font-size: 0.9rem;
  margin-top: 12px;
}

.info {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 8px;
}
