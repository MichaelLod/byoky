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
  --user-bg: #1a1a2e;
  --assistant-bg: #141414;
}

html,
body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-inter), system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
