// API 客户端：同源 cookie 会话，与老客户端保持一致。
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body = null, headers = {}, signal = null } = {}) {
  const h = { ...headers };
  if (body !== null && typeof body !== 'string') { body = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(path, { method, headers: h, body, credentials: 'same-origin', signal });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { data = await res.json(); } catch { data = null; } }
  else { data = await res.text(); }
  if (!res.ok) {
    const msg = (data && data.error) || `请求失败 (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

export const auth = {
  me: () => api('/api/me'),
  login: (username, password) => api('/api/login', { method: 'POST', body: { username, password } }),
  register: (username, password) => api('/api/register', { method: 'POST', body: { username, password } }),
  logout: () => api('/api/logout', { method: 'POST' }),
};

export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsDataURL(file);
  });
}

const LEGACY_LIMIT = 10 * 1024 * 1024;

// 上传文件：小文件单次，大文件走分片协议（与服务端 /api/uploads 一致）。
export async function uploadFile(file, onProgress) {
  if (file.size <= LEGACY_LIMIT) {
    const data = await fileToBase64(file);
    const ret = await api('/api/files', { method: 'POST', body: { name: file.name, type: file.type || 'application/octet-stream', data } });
    onProgress && onProgress(1);
    return ret.file;
  }
  const init = await api('/api/uploads', { method: 'POST', body: { name: file.name, type: file.type || 'application/octet-stream', size: file.size } });
  const upload = init.upload;
  let offset = 0;
  while (offset < file.size) {
    const part = file.slice(offset, Math.min(offset + upload.chunk_size, file.size));
    const data = await fileToBase64(part);
    const result = await api(`/api/uploads/${upload.id}/chunks`, { method: 'PUT', body: { offset, data } });
    offset += part.size;
    onProgress && onProgress(offset / file.size);
    if (result.completed) { onProgress && onProgress(1); return result.file; }
  }
  throw new Error('文件上传失败');
}
