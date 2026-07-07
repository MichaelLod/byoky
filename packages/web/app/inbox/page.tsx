'use client';

import { useCallback, useEffect, useState } from 'react';

// Content-Security-Policy injected into rendered HTML email bodies: blocks
// remote images (open/tracking pixels), remote scripts, styles, and frames.
// Combined with the sandboxed iframe (no allow-scripts / allow-same-origin),
// untrusted email HTML can neither run code nor phone home.
const EMAIL_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

interface InboxItem {
  id: string;
  from: string;
  subject: string | null;
  created_at: string;
}

interface Attachment {
  id: string;
  filename: string | null;
  content_type: string;
  size: number;
}

interface FullEmail extends InboxItem {
  to: string | string[];
  text: string | null;
  html: string | null;
  attachments: Attachment[];
}

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function InboxPage() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [secret, setSecret] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [items, setItems] = useState<InboxItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [email, setEmail] = useState<FullEmail | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  const [replyTo, setReplyTo] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState('');

  // Auth is a same-origin httpOnly cookie, sent automatically. The page
  // can't read it, so we probe the API: 200 = signed in, 401 = show login.
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const res = await fetch('/api/inbox/list?limit=50');
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load inbox');
      setItems(data.items ?? []);
      setAuthed(true);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList().finally(() => setChecking(false));
  }, [loadList]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoggingIn(true);
    setLoginError('');
    try {
      const res = await fetch('/api/inbox/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        setLoginError('That secret was rejected.');
        return;
      }
      setSecret('');
      await loadList();
    } catch {
      setLoginError('Login failed. Try again.');
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/inbox/logout', { method: 'POST' });
    } catch {
      // ignore — clear client state regardless
    }
    setAuthed(false);
    setItems([]);
    setSelectedId(null);
    setEmail(null);
  }

  async function openEmail(id: string) {
    setSelectedId(id);
    setEmail(null);
    setShowHtml(false);
    setSendStatus('');
    setEmailLoading(true);
    try {
      const res = await fetch(`/api/inbox/${id}`);
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load email');
      const full: FullEmail = data.email;
      setEmail(full);
      setReplyTo(extractEmail(full.from));
      setReplySubject(/^re:/i.test(full.subject ?? '') ? (full.subject ?? '') : `Re: ${full.subject ?? ''}`);
      setReplyBody('');
    } catch (e) {
      setSendStatus(e instanceof Error ? e.message : 'Failed to load email');
    } finally {
      setEmailLoading(false);
    }
  }

  async function sendReply() {
    if (!replyTo.trim() || !replySubject.trim() || !replyBody.trim()) {
      setSendStatus('Fill in recipient, subject, and message.');
      return;
    }
    setSending(true);
    setSendStatus('');
    try {
      const res = await fetch('/api/inbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: replyTo,
          subject: replySubject,
          body: replyBody,
          replyToEmailId: selectedId,
        }),
      });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      setSendStatus('Sent ✓');
      setReplyBody('');
    } catch (e) {
      setSendStatus(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  if (checking) {
    return (
      <main style={{ maxWidth: 400, margin: '0 auto', padding: '120px 20px', fontFamily: 'system-ui', color: '#888' }}>
        Loading…
      </main>
    );
  }

  if (!authed) {
    return (
      <main style={{ maxWidth: 400, margin: '0 auto', padding: '120px 20px 80px', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 22 }}>hi@byoky.com — Inbox</h1>
        <p style={{ color: '#888', fontSize: 14, marginTop: 4 }}>Admins only.</p>
        <form onSubmit={login} style={{ marginTop: 24 }}>
          <input
            type="password"
            placeholder="Inbox secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            style={{ width: '100%', padding: '10px 12px', fontSize: 16, borderRadius: 8, border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
          {loginError && <p style={{ color: '#e11d48', fontSize: 13, marginTop: 8 }}>{loginError}</p>}
          <button
            type="submit"
            disabled={loggingIn}
            style={{ marginTop: 12, padding: '10px 24px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, opacity: loggingIn ? 0.7 : 1 }}
          >
            {loggingIn ? 'Signing in…' : 'Open inbox'}
          </button>
        </form>
      </main>
    );
  }

  const bodyHtml = email?.html;
  const bodyText = email?.text;

  return (
    <div className="bx-root" style={{ fontFamily: 'system-ui' }}>
      <style>{`
        .bx-root { display: flex; flex-direction: column; height: 100dvh; color: #111; background: #fff; }
        .bx-top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #eee; flex: 0 0 auto; }
        .bx-top h1 { font-size: 16px; margin: 0; }
        .bx-top .spacer { flex: 1; }
        .bx-btn { padding: 6px 12px; font-size: 13px; border: 1px solid #ddd; background: #fafafa; border-radius: 6px; cursor: pointer; color: #333; }
        .bx-btn:hover { background: #f0f0f0; }
        .bx-panes { display: flex; flex: 1; min-height: 0; }
        .bx-list { width: 340px; border-right: 1px solid #eee; overflow-y: auto; flex: 0 0 auto; }
        .bx-detail { flex: 1; overflow-y: auto; min-width: 0; }
        .bx-row { padding: 12px 16px; border-bottom: 1px solid #f2f2f2; cursor: pointer; }
        .bx-row:hover { background: #f7fafa; }
        .bx-row.active { background: #ecfdf9; }
        .bx-row .from { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bx-row .subj { font-size: 13px; color: #444; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bx-row .date { font-size: 11px; color: #999; margin-top: 2px; }
        .bx-back { display: none; }
        .bx-detail-inner { padding: 20px; max-width: 760px; }
        .bx-meta { font-size: 13px; color: #555; }
        .bx-subject { font-size: 20px; margin: 4px 0 12px; }
        .bx-body { border-top: 1px solid #eee; padding-top: 16px; margin-top: 8px; }
        .bx-body pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 14px; line-height: 1.55; margin: 0; }
        .bx-iframe { width: 100%; height: 60vh; border: 1px solid #eee; border-radius: 8px; background: #fff; }
        .bx-reply { border-top: 1px solid #eee; margin-top: 24px; padding-top: 16px; }
        .bx-reply input, .bx-reply textarea { width: 100%; box-sizing: border-box; padding: 9px 11px; font-size: 15px; border: 1px solid #ccc; border-radius: 8px; margin-bottom: 8px; font-family: inherit; }
        .bx-reply textarea { min-height: 140px; resize: vertical; }
        .bx-send { padding: 9px 20px; background: #0d9488; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 15px; }
        .bx-send:disabled { opacity: 0.6; cursor: default; }
        .bx-empty { color: #999; padding: 40px 20px; text-align: center; }
        .bx-att { display: inline-block; font-size: 12px; background: #f1f5f5; border: 1px solid #e2e8e8; border-radius: 6px; padding: 3px 8px; margin: 2px 6px 2px 0; color: #444; }
        @media (max-width: 720px) {
          .bx-list { width: 100%; }
          .bx-panes .bx-detail { display: none; }
          .bx-panes.sel .bx-list { display: none; }
          .bx-panes.sel .bx-detail { display: block; }
          .bx-back { display: inline-block; margin-bottom: 12px; }
        }
      `}</style>

      <div className="bx-top">
        <h1>hi@byoky.com</h1>
        <span className="spacer" />
        <button className="bx-btn" onClick={loadList} disabled={listLoading}>
          {listLoading ? 'Loading…' : 'Refresh'}
        </button>
        <button className="bx-btn" onClick={logout}>Sign out</button>
      </div>

      <div className={`bx-panes${selectedId ? ' sel' : ''}`}>
        <div className="bx-list">
          {listError && <div className="bx-empty" style={{ color: '#e11d48' }}>{listError}</div>}
          {!listError && items.length === 0 && !listLoading && <div className="bx-empty">No messages yet.</div>}
          {items.map((it) => (
            <div
              key={it.id}
              className={`bx-row${it.id === selectedId ? ' active' : ''}`}
              onClick={() => openEmail(it.id)}
            >
              <div className="from">{it.from}</div>
              <div className="subj">{it.subject || '(no subject)'}</div>
              <div className="date">{formatDate(it.created_at)}</div>
            </div>
          ))}
        </div>

        <div className="bx-detail">
          {!selectedId && <div className="bx-empty">Select a message to read it.</div>}
          {selectedId && emailLoading && <div className="bx-empty">Loading…</div>}
          {selectedId && email && (
            <div className="bx-detail-inner">
              <button className="bx-btn bx-back" onClick={() => setSelectedId(null)}>← Back</button>
              <div className="bx-meta"><strong>{email.from}</strong></div>
              <div className="bx-meta">{formatDate(email.created_at)}</div>
              <h2 className="bx-subject">{email.subject || '(no subject)'}</h2>

              {email.attachments.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {email.attachments.map((a) => (
                    <span key={a.id} className="bx-att">📎 {a.filename || '(unnamed)'} · {formatSize(a.size)}</span>
                  ))}
                </div>
              )}

              <div className="bx-body">
                {bodyText && !showHtml && <pre>{bodyText}</pre>}
                {(!bodyText || showHtml) && bodyHtml && (
                  <iframe
                    className="bx-iframe"
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="${EMAIL_CSP}"><base target="_blank">${bodyHtml}`}
                    title="Email body"
                  />
                )}
                {!bodyText && !bodyHtml && <pre style={{ color: '#999' }}>(no body)</pre>}
                {bodyText && bodyHtml && (
                  <button
                    className="bx-btn"
                    style={{ marginTop: 10 }}
                    onClick={() => setShowHtml((v) => !v)}
                  >
                    {showHtml ? 'View plain text' : 'View HTML'}
                  </button>
                )}
              </div>

              <div className="bx-reply">
                <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="To" />
                <input value={replySubject} onChange={(e) => setReplySubject(e.target.value)} placeholder="Subject" />
                <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Reply from hi@byoky.com…" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="bx-send" onClick={sendReply} disabled={sending}>
                    {sending ? 'Sending…' : 'Send reply'}
                  </button>
                  {sendStatus && (
                    <span style={{ fontSize: 13, color: sendStatus.includes('✓') ? '#0d9488' : '#e11d48' }}>
                      {sendStatus}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
