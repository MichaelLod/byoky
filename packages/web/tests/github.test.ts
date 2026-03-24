import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startDeviceFlow,
  pollForToken,
  getUser,
  createRepo,
  pushFiles,
} from '../app/dev/github';

/* ─── Helpers ────────────────────────────────────── */

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* ─── startDeviceFlow ────────────────────────────── */

describe('startDeviceFlow', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns device flow data on success', async () => {
    const data = {
      device_code: 'abc123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      interval: 5,
      expires_in: 900,
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(data));

    const result = await startDeviceFlow();
    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith('/api/github/device-code', { method: 'POST' });
  });

  it('throws on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Bad request' }, 400));
    await expect(startDeviceFlow()).rejects.toThrow('Bad request');
  });

  it('throws on error field in response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'rate_limited' }));
    await expect(startDeviceFlow()).rejects.toThrow('rate_limited');
  });
});

/* ─── pollForToken ───────────────────────────────── */

describe('pollForToken', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns token after pending then success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_abc123' }));

    const token = await pollForToken('device123', 0.01);
    expect(token).toBe('gho_abc123');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('handles slow_down by increasing interval', async () => {
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(jsonResponse({ error: 'slow_down' }));
      return Promise.resolve(jsonResponse({ access_token: 'gho_token' }));
    });

    const token = await pollForToken('device123', 0.01);
    expect(token).toBe('gho_token');
    expect(callCount).toBe(2);
  }, 15000);

  it('throws on expired_token', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'expired_token' })),
    );
    await expect(pollForToken('device123', 0.01)).rejects.toThrow('Code expired');
  });

  it('throws on access_denied', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'access_denied' })),
    );
    await expect(pollForToken('device123', 0.01)).rejects.toThrow('Access denied');
  });

  it('aborts on signal', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'authorization_pending' }));
    const controller = new AbortController();

    const promise = pollForToken('device123', 60, controller.signal);
    // Abort immediately
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('throws on unknown error with description', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'server_error', error_description: 'Something broke' })),
    );
    await expect(pollForToken('device123', 0.01)).rejects.toThrow('Something broke');
  });
});

/* ─── getUser ────────────────────────────────────── */

describe('getUser', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns user data on success', async () => {
    const user = { login: 'testuser', avatar_url: 'https://example.com/avatar.png' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(user));

    const result = await getUser('gho_token');
    expect(result).toEqual(user);

    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.github.com/user');
    expect((opts?.headers as Record<string, string>)['Authorization']).toBe('Bearer gho_token');
  });

  it('throws on 401', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ message: 'Bad credentials' }, 401),
    );
    await expect(getUser('bad_token')).rejects.toThrow('GitHub user fetch failed (401): Bad credentials');
  });
});

/* ─── createRepo ─────────────────────────────────── */

describe('createRepo', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('creates a public repo', async () => {
    const repo = { full_name: 'user/my-app', html_url: 'https://github.com/user/my-app', default_branch: 'main' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(repo, 201));

    const result = await createRepo('gho_token', 'my-app');
    expect(result).toEqual(repo);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.name).toBe('my-app');
    expect(body.private).toBe(false);
    expect(body.auto_init).toBe(true);
  });

  it('creates a private repo', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ full_name: 'u/r', html_url: '', default_branch: 'main' }, 201));

    await createRepo('gho_token', 'my-app', true);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.private).toBe(true);
  });

  it('throws on name conflict', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ message: 'Repository creation failed.' }, 422),
    );
    await expect(createRepo('gho_token', 'existing')).rejects.toThrow('Repository creation failed.');
  });
});

/* ─── pushFiles ──────────────────────────────────── */

describe('pushFiles', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('pushes files through the full Git Data API flow', async () => {
    const files = {
      'package.json': '{}',
      'src/index.ts': 'console.log("hi")',
    };

    vi.mocked(fetch)
      // 1. Get HEAD ref
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'parent-sha' } }))
      // 2. Create blob for package.json
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-sha-1' }, 201))
      // 3. Create blob for src/index.ts
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-sha-2' }, 201))
      // 4. Create tree
      .mockResolvedValueOnce(jsonResponse({ sha: 'tree-sha' }, 201))
      // 5. Create commit
      .mockResolvedValueOnce(jsonResponse({ sha: 'commit-sha' }, 201))
      // 6. Update ref
      .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/main' }));

    const progress = vi.fn();
    await pushFiles('gho_token', 'user', 'repo', files, progress);

    // Verify calls
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(6);

    // GET ref
    expect(calls[0][0]).toBe('https://api.github.com/repos/user/repo/git/ref/heads/main');

    // POST blobs
    expect(calls[1][0]).toBe('https://api.github.com/repos/user/repo/git/blobs');
    expect(calls[2][0]).toBe('https://api.github.com/repos/user/repo/git/blobs');

    // POST tree
    expect(calls[3][0]).toBe('https://api.github.com/repos/user/repo/git/trees');

    // POST commit with parent
    const commitBody = JSON.parse(calls[4][1]?.body as string);
    expect(commitBody.parents).toEqual(['parent-sha']);
    expect(commitBody.tree).toBe('tree-sha');

    // PATCH ref
    expect(calls[5][0]).toBe('https://api.github.com/repos/user/repo/git/refs/heads/main');
    expect(calls[5][1]?.method).toBe('PATCH');

    // Progress callbacks: get ref + 2 blobs + tree + commit + update ref = 6
    expect(progress).toHaveBeenCalledTimes(6);
    expect(progress).toHaveBeenLastCalledWith(6, 6);
  });

  it('retries HEAD ref fetch on failure', async () => {
    vi.mocked(fetch)
      // Fail twice, succeed third
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'sha' } }))
      // Then succeed for the rest
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob' }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: 'tree' }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: 'commit' }, 201))
      .mockResolvedValueOnce(jsonResponse({ ref: 'ok' }));

    await pushFiles('gho_token', 'user', 'repo', { 'a.txt': 'hi' });
    // 3 ref attempts + blob + tree + commit + update = 7
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it('throws on blob creation failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'sha' } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Conflict' }, 409));

    await expect(pushFiles('gho_token', 'user', 'repo', { 'a.txt': 'x' }))
      .rejects.toThrow('Failed to create blob for a.txt');
  });
});
