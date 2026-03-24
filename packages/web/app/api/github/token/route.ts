const CLIENT_ID = 'Ov23lizF8BrtxYqz55dr';

export async function POST(req: Request) {
  const { device_code } = await req.json();
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = await res.json();
  return Response.json(data);
}
