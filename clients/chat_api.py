"""Shared dependency-free PolyChat HTTP client."""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone, tzinfo
import json
import mimetypes
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


class ApiError(Exception):
    pass


CONFIG_PATH = Path.home() / ".config" / "polychat" / "client.json"
DEFAULT_TIMEZONE = timezone(timedelta(hours=8), "UTC+8")


def local_timezone() -> tzinfo:
    """Use the operating system timezone, falling back to UTC+8."""
    try:
        detected = datetime.now().astimezone().tzinfo
        if detected is not None:
            return detected
    except (OSError, OverflowError, ValueError):
        pass
    return DEFAULT_TIMEZONE


def format_server_time(value: str, target_timezone: tzinfo | None = None) -> str:
    """Render the server's SQLite UTC timestamp in the client's timezone."""
    try:
        timestamp = datetime.fromisoformat(str(value).strip().replace(" ", "T"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return timestamp.astimezone(target_timezone or local_timezone()).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OverflowError, OSError):
        return str(value)


def normalize_server(value: str) -> str:
    """Accept an IP, host:port, or full HTTP(S) URL."""
    address = str(value).strip()
    if not address:
        raise ApiError("服务器地址不能为空")
    has_scheme = "://" in address
    parsed = urllib.parse.urlsplit(address if has_scheme else f"http://{address}")
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ApiError("服务器地址格式错误")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ApiError("服务器地址不能包含路径、参数或片段")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ApiError("服务器端口无效") from exc
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    if port is not None:
        host = f"{host}:{port}"
    elif not has_scheme:
        host = f"{host}:3000"
    return f"{parsed.scheme}://{host}"


def load_server(default: str = "http://127.0.0.1:3000") -> str:
    try:
        return normalize_server(json.loads(CONFIG_PATH.read_text(encoding="utf-8"))["server"])
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, ApiError):
        return default


def save_server(server: str):
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps({"server": normalize_server(server)}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


class ChatAPI:
    def __init__(self, base_url: str = "http://127.0.0.1:3000"):
        self.base_url = normalize_server(base_url)
        self.token: str | None = None

    def set_server(self, base_url: str):
        normalized = normalize_server(base_url)
        if normalized != self.base_url:
            self.base_url = normalized
            self.token = None
        return normalized

    def request(self, method: str, path: str, data=None, timeout: int = 8):
        body = json.dumps(data, ensure_ascii=False).encode() if data is not None else None
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(self.base_url + path, body, headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read()).get("error", str(exc))
            except (json.JSONDecodeError, UnicodeDecodeError):
                message = str(exc)
            raise ApiError(message) from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"无法连接服务器：{exc.reason}") from exc

    def login(self, username: str, password: str, register: bool = False):
        result = self.request("POST", "/api/register" if register else "/api/login", {"username": username, "password": password})
        self.token = result["token"]
        return result["user"]

    def rooms(self):
        return self.request("GET", "/api/rooms")["rooms"]

    def create_room(self, name: str):
        return self.request("POST", "/api/rooms", {"name": name})["room"]

    def messages(self, room_id: int, after: int = 0):
        query = urllib.parse.urlencode({"after": after})
        return self.request("GET", f"/api/rooms/{room_id}/messages?{query}")["messages"]

    def send(self, room_id: int, content: str, attachment_id: int | None = None):
        return self.request("POST", f"/api/rooms/{room_id}/messages", {"content": content, "attachment_id": attachment_id})["message"]

    def upload(self, path: str):
        size = os.path.getsize(path)
        if not 0 < size <= 10 * 1024 * 1024:
            raise ApiError("文件需为 1 字节至 10 MB")
        with open(path, "rb") as source:
            encoded = base64.b64encode(source.read()).decode("ascii")
        data = {"name": os.path.basename(path), "type": mimetypes.guess_type(path)[0] or "application/octet-stream", "data": encoded}
        return self.request("POST", "/api/files", data, timeout=60)["file"]

    def send_file(self, room_id: int, path: str, content: str = ""):
        uploaded = self.upload(path)
        return self.send(room_id, content, uploaded["id"])

    def upload_avatar(self, path: str):
        size = os.path.getsize(path)
        mime_type = mimetypes.guess_type(path)[0] or ""
        if mime_type not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
            raise ApiError("只支持 PNG、JPEG、WebP 或 GIF 图片")
        if not 0 < size <= 2 * 1024 * 1024:
            raise ApiError("头像需为 1 字节至 2 MB")
        with open(path, "rb") as source:
            encoded = base64.b64encode(source.read()).decode("ascii")
        return self.request("POST", "/api/me/avatar", {"type": mime_type, "data": encoded}, timeout=30)["user"]

    def download(self, attachment_id: int, destination: str):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        req = urllib.request.Request(f"{self.base_url}/api/files/{attachment_id}", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as response, open(destination, "wb") as target:
                target.write(response.read())
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
            raise ApiError(f"下载失败：{exc}") from exc
        return destination
