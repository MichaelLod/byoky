'use client';

import { useState } from 'react';

export default function SubmitPage() {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    url: '',
    icon: '',
    description: '',
    category: 'other',
    providers: '',
    authorName: '',
    authorEmail: '',
    authorWebsite: '',
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  function updateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    setError('');

    try {
      const res = await fetch('/api/marketplace/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          url: form.url,
          icon: form.icon || '/icon.png',
          description: form.description,
          category: form.category,
          providers: form.providers.split(',').map((p) => p.trim()).filter(Boolean),
          author: {
            name: form.authorName,
            email: form.authorEmail,
            ...(form.authorWebsite ? { website: form.authorWebsite } : {}),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Submission failed');
      }

      setStatus('success');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <main style={{ maxWidth: 600, margin: '0 auto', padding: '60px 20px', fontFamily: 'system-ui' }}>
        <h1>Submitted!</h1>
        <p style={{ color: '#666', marginTop: 12 }}>
          Your app has been submitted for review. We&apos;ll notify you at{' '}
          <strong>{form.authorEmail}</strong> when it&apos;s approved.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui' }}>
      <h1>Submit Your App</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>
        Submit your app to the Byoky Marketplace. Apps must use HTTPS and the @byoky/sdk for all LLM access.
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>App Name *</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: updateSlug(e.target.value) })}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Slug</label>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>App URL (https://) *</label>
          <input
            type="url"
            required
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://myapp.com"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Description *</label>
          <textarea
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', resize: 'vertical' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Category</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          >
            <option value="chat">Chat</option>
            <option value="coding">Coding</option>
            <option value="trading">Trading</option>
            <option value="productivity">Productivity</option>
            <option value="research">Research</option>
            <option value="creative">Creative</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Providers (comma-separated) *</label>
          <input
            type="text"
            required
            value={form.providers}
            onChange={(e) => setForm({ ...form, providers: e.target.value })}
            placeholder="anthropic, openai, gemini"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid #eee' }} />

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Author Name *</label>
          <input
            type="text"
            required
            value={form.authorName}
            onChange={(e) => setForm({ ...form, authorName: e.target.value })}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Author Email *</label>
          <input
            type="email"
            required
            value={form.authorEmail}
            onChange={(e) => setForm({ ...form, authorEmail: e.target.value })}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Website (optional)</label>
          <input
            type="url"
            value={form.authorWebsite}
            onChange={(e) => setForm({ ...form, authorWebsite: e.target.value })}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
          />
        </div>

        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}

        <button
          type="submit"
          disabled={status === 'loading'}
          style={{
            width: '100%',
            padding: '12px',
            background: '#0ea5e9',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {status === 'loading' ? 'Submitting...' : 'Submit for Review'}
        </button>
      </form>
    </main>
  );
}
