"""Shared dependency-free PolyChat HTTP client."""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import urllib.error
import urllib.parse
import urllib.request


class ApiError(Exception):
    pass


class ChatAPI:
    def __init__(self, base_url: str = "http://127.0.0.1:3000"):
        self.base_url = base_url.rstrip("/")
        self.token: str | None = None

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

    def download(self, attachment_id: int, destination: str):
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        req = urllib.request.Request(f"{self.base_url}/api/files/{attachment_id}", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as response, open(destination, "wb") as target:
                target.write(response.read())
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
            raise ApiError(f"下载失败：{exc}") from exc
        return destination
