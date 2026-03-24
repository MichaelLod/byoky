const CLIENT_ID = 'Ov23lizF8BrtxYqz55dr';

export async function POST() {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'repo' }),
  });
  const data = await res.json();
  return Response.json(data);
}
