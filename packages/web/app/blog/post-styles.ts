export const postStyles = `
.blog-post-layout {
  --blog-bg: var(--bg);
  --blog-bg-card: var(--bg-card);
  --blog-bg-elevated: var(--bg-elevated);
  --blog-border: var(--border);
  --blog-text: var(--text);
  --blog-text-secondary: var(--text-secondary);
  --blog-text-muted: var(--text-muted);

  max-width: 760px;
  margin: 0 auto;
  padding: 120px 20px 80px;
}

.blog-post-back {
  display: inline-block;
  font-size: 13px;
  color: var(--blog-text-muted);
  text-decoration: none;
  margin-bottom: 32px;
  transition: color 0.15s;
}

.blog-post-back:hover {
  color: var(--teal);
}

.blog-post-header {
  margin-bottom: 48px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--blog-border);
}

.blog-post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.blog-post-tag {
  font-size: 11px;
  font-family: var(--font-code);
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 79, 0, 0.1);
  color: var(--teal);
  letter-spacing: 0.02em;
}

.blog-post-header h1 {
  font-size: 38px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--blog-text);
  margin-bottom: 16px;
}

.blog-post-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--blog-text-muted);
  font-family: var(--font-code);
}

.blog-post-dot {
  opacity: 0.5;
}

.blog-post-hero {
  margin: 0 0 40px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--blog-border);
  background: var(--bg-surface);
  box-shadow: 0 20px 60px -30px rgba(255, 79, 0, 0.35);
}

.blog-post-hero img {
  width: 100%;
  height: auto;
  display: block;
}

.blog-post-body {
  font-size: 16px;
  line-height: 1.75;
  color: var(--blog-text);
}

.blog-post-body p {
  margin-bottom: 18px;
}

.blog-post-body h2 {
  font-size: 24px;
  font-weight: 700;
  margin-top: 44px;
  margin-bottom: 16px;
  color: var(--blog-text);
  letter-spacing: -0.01em;
}

.blog-post-body h3 {
  font-size: 18px;
  font-weight: 600;
  margin-top: 32px;
  margin-bottom: 12px;
  color: var(--blog-text);
}

.blog-post-body a {
  color: var(--teal);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(125, 211, 252, 0.4);
  transition: text-decoration-color 0.15s;
}

.blog-post-body a:hover {
  text-decoration-color: var(--teal);
}

.blog-post-body code {
  background: #1a1a2e;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 13px;
  color: #e2e2ec;
  font-family: var(--font-code);
}

.blog-post-body pre {
  background: #1a1a2e;
  border: 1px solid var(--blog-border);
  border-radius: 10px;
  padding: 18px 22px;
  margin: 20px 0;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.7;
}

.blog-post-body pre code {
  background: none;
  padding: 0;
  color: #e2e2ec;
  font-size: inherit;
}

.blog-post-table-wrap {
  background: #1a1a2e;
  border-radius: 10px;
  overflow: hidden;
  margin: 20px 0;
  border: none;
}

.blog-post-body table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  border: none;
}

.blog-post-body th {
  text-align: left;
  padding: 10px 16px;
  color: #a1a1b5;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: #121220;
  border: none;
}

.blog-post-body td {
  padding: 8px 16px;
  color: #e2e2ec;
  border-top: 1px solid rgba(255,255,255,0.05);
  border-left: none;
  border-right: none;
  border-bottom: none;
}

.blog-post-body tr:first-child td {
  border-top: none;
}

.blog-post-body ol,
.blog-post-body ul {
  margin: 12px 0 20px;
  padding-left: 22px;
}

.blog-post-body li {
  margin-bottom: 8px;
}

.blog-post-body li::marker {
  color: var(--blog-text-muted);
}

.blog-post-body em {
  color: var(--blog-text);
  font-style: italic;
}

.blog-post-body strong {
  color: var(--blog-text);
  font-weight: 600;
}

.blog-post-table-wrap {
  margin: 20px 0 24px;
  overflow-x: auto;
  border: 1px solid var(--blog-border);
  border-radius: 10px;
}

.blog-post-body table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.blog-post-body th,
.blog-post-body td {
  text-align: left;
  padding: 10px 16px;
  border-bottom: 1px solid var(--blog-border);
}

.blog-post-body th {
  background: var(--blog-bg-elevated);
  font-weight: 600;
  color: var(--blog-text);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.blog-post-body tr:last-child td {
  border-bottom: none;
}

.blog-cta {
  margin: 32px 0;
  padding: 28px 30px;
  border-radius: 14px;
  border: 1px solid var(--teal-dark);
  background:
    linear-gradient(140deg, rgba(255, 79, 0, 0.10), rgba(255, 79, 0, 0.02) 60%),
    var(--blog-bg-card);
  position: relative;
  overflow: hidden;
}

.blog-cta::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 0% 0%, rgba(125, 211, 252, 0.15), transparent 55%);
  pointer-events: none;
}

.blog-cta > * {
  position: relative;
}

.blog-cta-label {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--teal);
  margin-bottom: 10px;
  font-family: var(--font-code);
}

.blog-cta h3 {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 10px;
  color: var(--blog-text);
  letter-spacing: -0.01em;
}

.blog-cta p {
  font-size: 15px;
  color: var(--blog-text-secondary);
  line-height: 1.6;
  margin: 0 0 18px;
}

.blog-cta-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 20px;
  border-radius: 8px;
  background: var(--teal);
  color: #fff !important;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none !important;
  transition: background 0.15s, transform 0.15s;
}

.blog-cta-button:hover {
  background: var(--teal);
  transform: translateY(-1px);
}

@media (max-width: 768px) {
  .blog-post-header h1 {
    font-size: 28px;
  }
  .blog-post-body h2 {
    font-size: 21px;
  }
}
`;
