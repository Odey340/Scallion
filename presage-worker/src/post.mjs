// POST the payload to the Scallion API. Only numbers leave the laptop; no frames, no video.

export async function postVitals(payload, { apiUrl, token, fetchImpl = fetch } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/vitals`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /vitals -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
