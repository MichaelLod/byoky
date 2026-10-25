export const postStyles = `
.blog-post-layout {
  max-width: 760px;
  margin: 0 auto;
  padding: 132px 20px 80px;
}

.blog-post-back {
  display: inline-block;
  font-family: var(--font-code);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
  text-decoration: none;
  margin-bottom: 32px;
  transition: color 0.15s;
}

.blog-post-back:hover {
  color: var(--phosphor);
}

.blog-post-header {
  margin-bottom: 48px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--seam);
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
  background: var(--violet-soft);
  color: var(--lilac);
  letter-spacing: 0.04em;
}

.blog-post-header h1 {
  font-size: 38px;
  line-height: 1.1;
  color: var(--bone);
  margin-bottom: 16px;
}

.blog-post-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--dim);
  font-family: var(--font-code);
}

.blog-post-dot {
  opacity: 0.5;
}

.blog-post-hero {
  margin: 0 0 40px;
  overflow: hidden;
  border: 1px solid var(--seam);
  background: var(--ash);
}

.blog-post-hero img {
  width: 100%;
  height: auto;
  display: block;
}

.blog-post-body {
  font-size: 16px;
  line-height: 1.75;
  color: var(--fog);
}

.blog-post-body p {
  margin-bottom: 18px;
}

.blog-post-body h2 {
  font-size: 24px;
  margin-top: 44px;
  margin-bottom: 16px;
  color: var(--bone);
}

.blog-post-body h3 {
  font-size: 18px;
  margin-top: 32px;
  margin-bottom: 12px;
  color: var(--bone);
}

.blog-post-body a {
  color: var(--phosphor);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--seam-strong);
  transition: text-decoration-color 0.15s;
}

.blog-post-body a:hover {
  text-decoration-color: var(--violet);
}

.blog-post-body code {
  background: var(--ash);
  padding: 2px 6px;
  font-size: 13px;
  color: var(--phosphor);
  font-family: var(--font-code);
}

.blog-post-body pre {
  background: var(--ink);
  border: 1px solid var(--seam);
  padding: 18px 22px;
  margin: 20px 0;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.7;
}

.blog-post-body pre code {
  background: none;
  padding: 0;
  color: var(--bone);
  font-size: inherit;
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
  color: var(--dim);
}

.blog-post-body em {
  color: var(--bone);
  font-style: italic;
}

.blog-post-body strong {
  color: var(--bone);
  font-weight: 600;
}

.blog-post-table-wrap {
  margin: 20px 0 24px;
  overflow-x: auto;
  border: 1px solid var(--seam);
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
  border-bottom: 1px solid var(--seam);
}

.blog-post-body th {
  background: var(--ash);
  font-family: var(--font-code);
  font-weight: 500;
  color: var(--fog);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.blog-post-body tr:last-child td {
  border-bottom: none;
}

.blog-cta {
  margin: 32px 0;
  padding: 28px 30px;
  border: 1px solid var(--seam-strong);
  background: var(--crypt);
}

.blog-cta-label {
  display: inline-block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--phosphor);
  margin-bottom: 10px;
  font-family: var(--font-code);
}

.blog-cta h3 {
  font-size: 22px;
  margin: 0 0 10px;
  color: var(--bone);
}

.blog-cta p {
  font-size: 15px;
  color: var(--fog);
  line-height: 1.6;
  margin: 0 0 18px;
}

.blog-cta-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 20px;
  background: var(--violet);
  color: #FFFFFF !important;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none !important;
  transition: background 0.15s;
}

.blog-cta-button:hover {
  background: var(--violet-hover);
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
