// P2P 大文件直传引擎：WebRTC DataChannel（simple-peer）+ IndexedDB 本地存储。
// 信令（offer/answer/ICE）经由现有 /ws 连接由 App.vue 转发（sendSignal / signal），
// 文件字节不经过服务器。帧协议：JSON header（含元数据与 sha256）→ 二进制块 → JSON done。
import SimplePeer from 'simple-peer';

const CHUNK_SIZE = 64 * 1024; // 每块 64KB，跨浏览器安全（Firefox 数据通道单帧上限较低）
const MAX_BUFFERED = 4 * 1024 * 1024; // 发送缓冲阈值，超过则等待，避免压垮慢速接收端
const DEFAULT_CONNECT_TIMEOUT = 30000;
const IDLE_TIMEOUT = 120000; // 传输过程中超过 2 分钟无进展视为失败

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('polychat-p2p', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function p2pSaveFile(transferId, blob, meta) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id: transferId, blob, meta });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function p2pGetFile(transferId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files', 'readonly').objectStore('files').get(transferId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function p2pListFiles() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files', 'readonly').objectStore('files').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function p2pDeleteFile(transferId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(transferId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function sha256Of(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function makePeer(initiator, iceServers, wrtc) {
  return new SimplePeer({
    initiator,
    trickle: true,
    config: { iceServers },
    channelConfig: { ordered: true },
    ...(wrtc ? { wrtc } : {}),
  });
}

function progressThrottle(onProgress, everyMs = 50) {
  let last = 0;
  return ratio => {
    const now = Date.now();
    if (now - last < everyMs && ratio < 1) return;
    last = now;
    onProgress(ratio);
  };
}

// 解析控制帧（header / done）。浏览器文本帧以 string 到达，wrtc 等环境文本帧可能以 Buffer 到达，
// 因此统一对文本形式尝试 JSON.parse；二进制块几乎不可能恰为合法 JSON 且长度远超控制帧。
function parseControlFrame(data) {
  if (data.length > 4096) return null;
  try {
    const frame = JSON.parse(typeof data === 'string' ? data : String(data));
    if (frame && frame.v === 1 && (frame.t === 'header' || frame.t === 'done')) return frame;
  } catch { /* 二进制块或非控制帧 */ }
  return null;
}

// ---------- 发送端 ----------
// opts: { transferId, file, iceServers, sendSignal, connectTimeout, onProgress, onState, onError, wrtc }
// 返回 { signal(data), cancel() }；建立连接后自动分块发送。
export function createSender(opts) {
  const { transferId, file, iceServers, sendSignal, connectTimeout = DEFAULT_CONNECT_TIMEOUT, onProgress = () => {}, onState = () => {}, onError, wrtc } = opts;
  let peer = null;
  let done = false;
  let sentBytes = 0;
  let connectTimer = null;
  let idleTimer = null;

  const report = ratio => { onProgress(Math.max(0, Math.min(1, ratio))); };
  const throttled = progressThrottle(report);

  function fail(reason) {
    if (done) return;
    done = true;
    clearTimeout(connectTimer);
    clearTimeout(idleTimer);
    try { peer?.destroy(); } catch { /* already closed */ }
    onState('failed');
    onError(reason || '连接已关闭');
  }

  peer = makePeer(true, iceServers, wrtc);
  peer.on('signal', data => sendSignal(data));
  peer.on('connect', () => {
    clearTimeout(connectTimer);
    onState('connected');
    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        const sha256 = await sha256Of(buffer);
        if (done) return;
        peer.send(JSON.stringify({ v: 1, t: 'header', name: file.name, size: file.size, mime: file.type || 'application/octet-stream', sha256 }));
        let offset = 0;
        while (offset < file.size) {
          const chunk = new Uint8Array(buffer, offset, Math.min(CHUNK_SIZE, file.size - offset));
          while (peer.channel?.bufferedAmount > MAX_BUFFERED) await new Promise(resolve => setTimeout(resolve, 50));
          if (done) return;
          peer.send(chunk);
          offset += chunk.byteLength;
          sentBytes = offset;
          throttled(offset / file.size);
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => fail('传输长时间无进展'), IDLE_TIMEOUT);
        }
        if (done) return;
        peer.send(JSON.stringify({ v: 1, t: 'done', sha256 }));
        report(1);
        onState('sent');
      } catch (error) {
        fail(error?.message || '文件读取失败');
      }
    })();
  });
  peer.on('error', error => fail(error?.message || 'P2P 连接错误'));
  peer.on('close', () => { if (!done && sentBytes < file.size) fail('连接已关闭'); });
  connectTimer = setTimeout(() => fail('连接超时，已回退服务器上传'), connectTimeout);

  return {
    signal(data) { if (!done) peer?.signal(data); },
    cancel() { fail('已取消'); },
  };
}

// ---------- 接收端 ----------
// opts: { transferId, iceServers, sendSignal, connectTimeout, onProgress, onState, onComplete, onError, wrtc }
// 返回 { signal(data), cancel() }；首个 signal（offer）到达时创建 Peer。
export function createReceiver(opts) {
  const { transferId, iceServers, sendSignal, connectTimeout = DEFAULT_CONNECT_TIMEOUT, onProgress = () => {}, onState = () => {}, onComplete, onError, wrtc } = opts;
  let peer = null;
  let done = false;
  let header = null;
  let parts = [];
  let received = 0;
  let connectTimer = null;
  let idleTimer = null;

  const throttled = progressThrottle(onProgress);

  function fail(reason) {
    if (done) return;
    done = true;
    clearTimeout(connectTimer);
    clearTimeout(idleTimer);
    try { peer?.destroy(); } catch { /* already closed */ }
    onState('failed');
    onError(reason || '连接已关闭');
  }

  async function finalize() {
    if (!header || !parts.length) return;
    const blob = new Blob(parts, { type: header.mime });
    parts = [];
    try {
      const sha256 = await sha256Of(await blob.arrayBuffer());
      if (sha256 !== header.sha256) return fail('SHA-256 校验失败，文件可能损坏');
      await p2pSaveFile(transferId, blob, { name: header.name, mime: header.mime, size: header.size, sha256 });
      if (done) return;
      done = true;
      clearTimeout(connectTimer);
      clearTimeout(idleTimer);
      onState('received');
      onComplete({ blob, sha256, name: header.name, size: header.size });
    } catch (error) {
      fail(error?.message || '文件保存失败');
    }
  }

  function ensurePeer() {
    if (peer) return;
    connectTimer = setTimeout(() => fail('连接超时'), connectTimeout);
    peer = makePeer(false, iceServers, wrtc);
    peer.on('signal', data => sendSignal(data));
    peer.on('connect', () => { clearTimeout(connectTimer); onState('connected'); });
    peer.on('data', data => {
      if (done) return;
      const frame = parseControlFrame(data);
      if (frame) {
        if (frame.t === 'header') {
          header = frame;
          parts = [];
          received = 0;
        } else if (frame.t === 'done') {
          void finalize();
        }
        return;
      }
      if (!header) return;
      parts.push(data);
      received += data.byteLength;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail('传输长时间无进展'), IDLE_TIMEOUT);
      throttled(received / header.size);
    });
    peer.on('error', error => fail(error?.message || 'P2P 连接错误'));
    peer.on('close', () => { if (!done) fail('连接已关闭'); });
  }

  return {
    signal(data) { ensurePeer(); if (!done) peer?.signal(data); },
    cancel() { fail('已取消'); },
  };
}
