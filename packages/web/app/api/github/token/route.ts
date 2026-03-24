const CLIENT_ID = 'Ov23lizF8BrtxYqz55dr';

export async function POST(req: Request) {
  try {
    const { device_code } = await req.json();
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Byoky-DevHub',
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `GitHub returned ${res.status}: ${text}` }, { status: res.status });
    }
    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
