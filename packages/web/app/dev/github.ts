export interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface RepoInfo {
  full_name: string;
  html_url: string;
  default_branch: string;
}

export async function startDeviceFlow(): Promise<DeviceFlowResponse> {
  const res = await fetch('/api/github/device-code', { method: 'POST' });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Device flow failed (${res.status})`);
  return data;
}

export async function pollForToken(
  deviceCode: string,
  interval: number,
  signal?: AbortSignal,
): Promise<string> {
  let wait = interval;
  while (true) {
    await new Promise((resolve, reject) => {
      const id = setTimeout(resolve, wait * 1000);
      signal?.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    const res = await fetch('/api/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
      signal,
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    if (data.error === 'slow_down') { wait += 5; continue; }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'expired_token') throw new Error('Code expired — please try again');
    if (data.error === 'access_denied') throw new Error('Access denied');
    throw new Error(data.error_description || data.error || 'Unknown error');
  }
}

export async function getUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Byoky-DevHub',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub user fetch failed (${res.status}): ${(err as Record<string, string>).message || 'unknown'}`);
  }
  return res.json();
}

export async function createRepo(
  token: string,
  name: string,
  isPrivate = false,
): Promise<RepoInfo> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Failed to create repo (${res.status})`);
  }
  return res.json();
}

export async function pushFiles(
  token: string,
  owner: string,
  repo: string,
  files: Record<string, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const entries = Object.entries(files);
  const total = entries.length + 4; // get ref + blobs + tree + commit + update ref
  let done = 0;

  // Get current HEAD commit (repo was created with auto_init: true)
  // Retry a few times since GitHub may not have the initial commit ready yet
  let parentSha = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
    const refRes = await fetch(`${base}/git/ref/heads/main`, { headers });
    if (refRes.ok) {
      const refData = await refRes.json();
      parentSha = refData.object.sha;
      break;
    }
    if (attempt === 4) throw new Error('Failed to get repo HEAD ref — repo may still be initializing');
  }
  onProgress?.(++done, total);

  // Create blobs
  const tree = await Promise.all(
    entries.map(async ([path, content]) => {
      const res = await fetch(`${base}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content, encoding: 'utf-8' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Failed to create blob for ${path} (${res.status}): ${(err as Record<string, string>).message || ''}`);
      }
      const { sha } = await res.json();
      onProgress?.(++done, total);
      return { path, sha, mode: '100644' as const, type: 'blob' as const };
    }),
  );

  // Create tree
  const treeRes = await fetch(`${base}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tree }),
  });
  if (!treeRes.ok) throw new Error('Failed to create tree');
  const { sha: treeSha } = await treeRes.json();
  onProgress?.(++done, total);

  // Create commit with parent
  const commitRes = await fetch(`${base}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: 'Initial commit from Byoky Developer Hub',
      tree: treeSha,
      parents: [parentSha],
    }),
  });
  if (!commitRes.ok) throw new Error('Failed to create commit');
  const { sha: commitSha } = await commitRes.json();
  onProgress?.(++done, total);

  // Update main branch ref
  const updateRes = await fetch(`${base}/git/refs/heads/main`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: commitSha }),
  });
  if (!updateRes.ok) throw new Error('Failed to update branch ref');
  onProgress?.(++done, total);
}
