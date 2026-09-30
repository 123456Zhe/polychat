export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}

export async function readBody(req, maxLength = 70_000) {
  let raw = '';
  let tooLarge = false;
  for await (const chunk of req) {
    if (tooLarge) continue;
    raw += chunk;
    if (raw.length > maxLength) tooLarge = true;
  }
  if (tooLarge) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('JSON 格式错误'), { status: 400 }); }
}
