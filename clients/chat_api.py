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

    def request_bytes(self, path: str, timeout: int = 30) -> bytes:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        req = urllib.request.Request(self.base_url + path, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read()
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

    def create_room(self, name: str, is_private: bool = False):
        return self.request("POST", "/api/rooms", {"name": name, "is_private": is_private})["room"]

    def messages(self, room_id: int, after: int = 0):
        query = urllib.parse.urlencode({"after": after})
        return self.request("GET", f"/api/rooms/{room_id}/messages?{query}")["messages"]

    def send(self, room_id: int, content: str, attachment_id: int | None = None, reply_to: int | None = None):
        return self.request("POST", f"/api/rooms/{room_id}/messages", {"content": content, "attachment_id": attachment_id, "reply_to": reply_to})["message"]

    def edit_message(self, message_id: int, content: str):
        return self.request("PUT", f"/api/messages/{int(message_id)}", {"content": content})["message"]

    def retract_message(self, message_id: int):
        return self.request("DELETE", f"/api/messages/{int(message_id)}")["message"]

    def react(self, message_id: int, emoji: str):
        return self.request("POST", f"/api/messages/{int(message_id)}/reactions", {"emoji": emoji})["reactions"]

    def search(self, query: str, room_id: int | None = None):
        params = {"q": query}
        if room_id is not None:
            params["room_id"] = int(room_id)
        return self.request("GET", "/api/search?" + urllib.parse.urlencode(params))["messages"]

    def room_members(self, room_id: int):
        return self.request("GET", f"/api/rooms/{int(room_id)}/members")["members"]

    def invite_member(self, room_id: int, username: str, role: str = "member"):
        return self.request("POST", f"/api/rooms/{int(room_id)}/members", {"username": username, "role": role})["member"]

    def remove_member(self, room_id: int, user_id: int):
        return self.request("DELETE", f"/api/rooms/{int(room_id)}/members/{int(user_id)}")

    def update_room(self, room_id: int, name: str):
        return self.request("PUT", f"/api/rooms/{int(room_id)}", {"name": name})["room"]

    def delete_room(self, room_id: int):
        return self.request("DELETE", f"/api/rooms/{int(room_id)}")

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
        with open(path, "rb") as source:
            header = source.read(16)
        signatures = (
            (b"\x89PNG\r\n\x1a\n", "image/png"),
            (b"\xff\xd8\xff", "image/jpeg"),
            (b"GIF87a", "image/gif"),
            (b"GIF89a", "image/gif"),
        )
        mime_type = next((mime for signature, mime in signatures if header.startswith(signature)), "")
        if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
            mime_type = "image/webp"
        if mime_type not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
            raise ApiError("只支持 PNG、JPEG、WebP 或 GIF 图片")
        if not 0 < size <= 2 * 1024 * 1024:
            raise ApiError("头像需为 1 字节至 2 MB")
        with open(path, "rb") as source:
            encoded = base64.b64encode(source.read()).decode("ascii")
        return self.request("POST", "/api/me/avatar", {"type": mime_type, "data": encoded}, timeout=30)["user"]

    def avatar(self, user_id: int, version=None):
        query = urllib.parse.urlencode({"v": version}) if version is not None else ""
        return self.request_bytes(f"/api/users/{int(user_id)}/avatar" + (f"?{query}" if query else ""))

    def download(self, attachment_id: int, destination: str):
        target = Path(destination)
        partial = target.with_name(target.name + ".part")
        try:
            partial.write_bytes(self.request_bytes(f"/api/files/{int(attachment_id)}", timeout=60))
            partial.replace(target)
        except (ApiError, OSError, ValueError) as exc:
            try:
                partial.unlink(missing_ok=True)
            except OSError:
                pass
            raise ApiError(f"下载失败：{exc}") from exc
        return str(target)

    def export_data(self, destination: str):
        target = Path(destination)
        try:
            data = self.request_bytes("/api/me/export", timeout=120)
            target.write_bytes(data)
        except (ApiError, OSError) as exc:
            raise ApiError(f"导出失败：{exc}") from exc
        return str(target)

    def delete_account(self, password: str):
        return self.request("DELETE", "/api/me", {"password": password})

    def health(self):
        return self.request("GET", "/api/health")

    def announcement(self, room_id: int, content: str = None):
        if content is None:
            return self.request("DELETE", f"/api/rooms/{int(room_id)}/announcement")
        return self.request("PUT", f"/api/rooms/{int(room_id)}/announcement", {"content": content})

    def invite_codes(self, room_id: int):
        return self.request("GET", f"/api/rooms/{int(room_id)}/invite-codes")["codes"]

    def create_invite_code(self, room_id: int, max_uses=None, duration_hours=None):
        return self.request("POST", f"/api/rooms/{int(room_id)}/invite-codes", {"max_uses": max_uses, "duration_hours": duration_hours})["code"]

    def delete_invite_code(self, room_id: int, code_id: int):
        return self.request("DELETE", f"/api/rooms/{int(room_id)}/invite-codes/{int(code_id)}")

    def join_by_code(self, code: str):
        return self.request("POST", f"/api/invite/{code}")

    def search_users(self, query: str):
        return self.request("GET", "/api/users/search?" + urllib.parse.urlencode({"q": query}))["users"]

    def friends(self):
        return self.request("GET", "/api/friends")

    def friend_request(self, username: str):
        return self.request("POST", "/api/friends/request", {"username": username})["friend"]

    def friend_accept(self, user_id: int):
        return self.request("POST", f"/api/friends/{int(user_id)}/accept")["friend"]

    def friend_decline(self, user_id: int):
        return self.request("POST", f"/api/friends/{int(user_id)}/decline")

    def friend_remove(self, user_id: int):
        return self.request("DELETE", f"/api/friends/{int(user_id)}")

    def dm_conversations(self):
        return self.request("GET", "/api/dm/conversations")["conversations"]

    def create_dm(self, username: str):
        return self.request("POST", "/api/dm/conversations", {"username": username})["conversation"]

    def dm_messages(self, conv_id: int, after: int = 0, before: int = 0):
        params = {"after": after}
        if before:
            params["before"] = before
        return self.request("GET", f"/api/dm/conversations/{int(conv_id)}/messages?" + urllib.parse.urlencode(params))["messages"]

    def send_dm(self, conv_id: int, content: str, attachment_id: int | None = None, reply_to: int | None = None):
        return self.request("POST", f"/api/dm/conversations/{int(conv_id)}/messages", {"content": content, "attachment_id": attachment_id, "reply_to": reply_to})["message"]

    def edit_dm(self, message_id: int, content: str):
        return self.request("PUT", f"/api/dm/messages/{int(message_id)}", {"content": content})["message"]

    def retract_dm(self, message_id: int):
        return self.request("DELETE", f"/api/dm/messages/{int(message_id)}")

    def react_dm(self, message_id: int, emoji: str):
        return self.request("POST", f"/api/dm/messages/{int(message_id)}/reactions", {"emoji": emoji})["reactions"]

    def mark_dm_read(self, conv_id: int, message_id: int):
        return self.request("POST", f"/api/dm/conversations/{int(conv_id)}/read", {"message_id": message_id})
