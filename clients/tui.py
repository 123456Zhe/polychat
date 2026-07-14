#!/usr/bin/env python3
"""Curses terminal client for PolyChat."""
from __future__ import annotations

import argparse
import curses
import getpass
import textwrap
import time

from chat_api import ApiError, ChatAPI, format_server_time, load_server, local_timezone, save_server


TUI_LOGO = """
        ╭────────╮
        │  ╭───╮ │
        │  │ P │ │
        │  ╰─╮ ╰╮│
        ╰────╰──╯╯
            <◆>
"""


def login(api: ChatAPI):
    print("\n  账号认证\n  ────────")
    mode = input("登录 [L] / 注册 [R]: ").strip().lower()
    username = input("用户名: ").strip()
    password = getpass.getpass("密码: ")
    return api.login(username, password, mode == "r")


def choose_server(initial: str | None = None):
    print(TUI_LOGO)
    print("        PolyChat TUI\n")
    default = initial or load_server()
    while True:
        address = input(f"服务器地址 [{default}]: ").strip() or default
        try:
            return ChatAPI(address)
        except ApiError as exc:
            print(f"地址错误：{exc}")


class TUI:
    def __init__(self, screen, api, user):
        self.screen, self.api, self.user = screen, api, user
        self.timezone = local_timezone()
        self.rooms = api.rooms(); self.room = self.rooms[0]; self.messages = []; self.last_id = 0
        self.input = ""; self.status = "Enter 发送 · ↑↓/PgUp/PgDn 滚动 · /help 查看命令"; self.last_poll = 0; self.last_room_poll = 0
        self.scroll = 0
        self.max_scroll = 0
        self.page_size = 1
        curses.curs_set(1); screen.timeout(100); screen.keypad(True)
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)

    def fetch(self):
        try:
            new = self.api.messages(self.room["id"], self.last_id)
            self.messages.extend(new)
            if new: self.last_id = new[-1]["id"]
        except ApiError as exc: self.status = str(exc)

    def refresh_rooms(self):
        try:
            selected_id = self.room["id"]
            self.rooms = self.api.rooms()
            self.room = next((room for room in self.rooms if room["id"] == selected_id), self.rooms[0])
        except ApiError as exc: self.status = str(exc)

    def draw(self):
        s = self.screen; s.erase(); h, w = s.getmaxyx()
        if h < 8 or w < 35: s.addnstr(0, 0, "终端窗口太小", max(1, w - 1)); s.refresh(); return
        title = f" ◖P◗ PolyChat  #{self.room['name']}  ·  {self.user['username']} "
        s.attron(curses.A_REVERSE); s.addnstr(0, 0, title.ljust(w), w - 1); s.attroff(curses.A_REVERSE)
        lines = []
        for msg in self.messages:
            created_at = format_server_time(msg["created_at"], self.timezone)
            suffix = " · 已编辑" if msg.get("edited_at") else ""
            lines.append((f"{msg['id']} · {msg['username']}  {created_at}{suffix}", curses.A_BOLD))
            if msg.get("reply_to"):
                lines.append((f"  ↳ 回复消息 #{msg['reply_to']}：{msg.get('reply_content') or ''}", curses.A_DIM))
            if msg.get("is_deleted"):
                lines.append(("  [此消息已撤回]", curses.A_DIM)); lines.append(("", curses.A_NORMAL)); continue
            # Markdown/LaTeX source remains intact and readable in text terminals.
            for raw in msg["content"].splitlines() or [""]:
                prefix = "│ " if raw.startswith("> ") else "  "
                clean = raw[2:] if raw.startswith("> ") else raw
                for part in textwrap.wrap(clean, max(10, w - 6), replace_whitespace=False) or [""]:
                    lines.append((prefix + part, curses.A_NORMAL))
            if msg.get("attachment_id"):
                size = msg.get("attachment_size", 0)
                readable = f"{size / 1024:.1f} KB" if size >= 1024 else f"{size} B"
                lines.append((f"  [文件 {msg['attachment_id']}] {msg['attachment_name']} · {readable}", curses.A_UNDERLINE))
            if msg.get("reactions"):
                lines.append(("  " + " ".join(f"{reaction['emoji']} {reaction['count']}" for reaction in msg['reactions']), curses.A_NORMAL))
            lines.append(("", curses.A_NORMAL))

        self.page_size = max(1, h - 4)
        self.max_scroll = max(0, len(lines) - self.page_size)
        self.scroll = min(max(0, self.scroll), self.max_scroll)
        start = max(0, len(lines) - self.page_size - self.scroll)
        visible = lines[start:start + self.page_size]
        for y, (line, attr) in enumerate(visible, 1):
            try: s.addnstr(y, 0, line, w - 3, attr)
            except curses.error: pass

        # The thumb follows the visible slice: top means oldest messages,
        # bottom means the live edge. Keep a one-cell thumb for long histories.
        track_x = w - 2
        for y in range(1, self.page_size + 1):
            try: s.addch(y, track_x, "│", curses.A_DIM)
            except curses.error: pass
        if lines:
            thumb_size = min(self.page_size, max(1, round(self.page_size * self.page_size / len(lines))))
            thumb_top = 0 if not self.max_scroll else round(start / self.max_scroll * (self.page_size - thumb_size))
            for y in range(1 + thumb_top, 1 + thumb_top + thumb_size):
                try: s.addch(y, track_x, "█", curses.A_BOLD)
                except curses.error: pass

        s.hline(h - 3, 0, curses.ACS_HLINE, w - 1)
        s.addnstr(h - 2, 0, "> " + self.input, w - 1)
        s.addnstr(h - 1, 0, self.status, w - 1, curses.A_DIM)
        try: s.move(h - 2, min(w - 2, len(self.input) + 2))
        except curses.error: pass
        s.refresh()

    def command(self, value):
        if value == "/quit": return False
        if value == "/help": self.status = "/rooms /room 编号 /new 名称 /newprivate 名称 /reply ID 内容 /react ID 表情 /edit ID 内容 /retract ID /search 关键词 /invite 用户 [admin] /quit"; return True
        if value == "/rooms": self.status = "  ".join(f"{i + 1}:{r['name']}" for i, r in enumerate(self.rooms)); return True
        if value.startswith("/room "):
            try:
                self.room = self.rooms[int(value.split()[1]) - 1]; self.messages = []; self.last_id = 0; self.scroll = 0; self.fetch(); self.status = f"已进入 #{self.room['name']}"
            except (ValueError, IndexError): self.status = "房间编号无效"
            return True
        if value.startswith("/new "):
            try: self.api.create_room(value[5:].strip()); self.refresh_rooms(); self.status = "聊天室已创建"
            except ApiError as exc: self.status = str(exc)
            return True
        if value.startswith("/newprivate "):
            try: self.api.create_room(value[12:].strip(), True); self.refresh_rooms(); self.status = "私有聊天室已创建"
            except ApiError as exc: self.status = str(exc)
            return True
        if value.startswith("/reply "):
            try:
                _, message_id, reply = value.split(maxsplit=2)
                self.api.send(self.room["id"], reply, reply_to=int(message_id)); self.fetch(); self.status = "回复已发送"
            except (ValueError, ApiError) as exc: self.status = f"用法: /reply 消息ID 内容 · {exc}"
            return True
        if value.startswith("/react "):
            try:
                _, message_id, emoji = value.split(maxsplit=2)
                self.api.react(int(message_id), emoji); self.messages = self.api.messages(self.room["id"], 0); self.last_id = self.messages[-1]["id"] if self.messages else 0; self.status = "表情已更新"
            except (ValueError, ApiError) as exc: self.status = f"用法: /react 消息ID 表情 · {exc}"
            return True
        if value.startswith("/edit "):
            try:
                _, message_id, text = value.split(maxsplit=2)
                self.api.edit_message(int(message_id), text); self.messages = self.api.messages(self.room["id"], 0); self.last_id = self.messages[-1]["id"] if self.messages else 0; self.status = "消息已编辑"
            except (ValueError, ApiError) as exc: self.status = f"用法: /edit 消息ID 新内容 · {exc}"
            return True
        if value.startswith("/retract "):
            try:
                self.api.retract_message(int(value.split(maxsplit=1)[1])); self.messages = self.api.messages(self.room["id"], 0); self.last_id = self.messages[-1]["id"] if self.messages else 0; self.status = "消息已撤回"
            except (ValueError, IndexError, ApiError) as exc: self.status = f"用法: /retract 消息ID · {exc}"
            return True
        if value.startswith("/search "):
            try:
                found = self.api.search(value[8:].strip(), self.room["id"])
                self.status = " · ".join(f"#{m['id']} {m['username']}: {m['content'][:30]}" for m in found[:3]) or "未找到消息"
            except ApiError as exc: self.status = str(exc)
            return True
        if value.startswith("/invite "):
            try:
                parts = value.split()
                self.api.invite_member(self.room["id"], parts[1], "admin" if len(parts) > 2 and parts[2] == "admin" else "member"); self.status = "成员已添加"
            except (IndexError, ApiError) as exc: self.status = f"用法: /invite 用户名 [admin] · {exc}"
            return True
        if value.startswith("/sendfile "):
            try: self.api.send_file(self.room["id"], value[10:].strip()); self.fetch(); self.status = "文件已发送"
            except (ApiError, OSError) as exc: self.status = str(exc)
            return True
        if value.startswith("/avatar "):
            try: self.user = self.api.upload_avatar(value[8:].strip()); self.status = "头像已更新（图片可在 Web 中查看）"
            except (ApiError, OSError) as exc: self.status = str(exc)
            return True
        if value.startswith("/getfile "):
            try:
                _, file_id, destination = value.split(maxsplit=2)
                self.api.download(int(file_id), destination); self.status = f"已下载到 {destination}"
            except (ValueError, ApiError, OSError) as exc: self.status = f"用法: /getfile ID 保存路径 · {exc}"
            return True
        if value == "/clear": self.messages = []; self.scroll = 0; self.status = "屏幕已清空"; return True
        try: self.api.send(self.room["id"], value); self.fetch(); self.status = "已发送"
        except ApiError as exc: self.status = str(exc)
        return True

    def run(self):
        while True:
            if time.monotonic() - self.last_poll > 1.5: self.fetch(); self.last_poll = time.monotonic()
            if time.monotonic() - self.last_room_poll > 3: self.refresh_rooms(); self.last_room_poll = time.monotonic()
            self.draw()
            try: key = self.screen.get_wch()
            except curses.error: continue
            if key == curses.KEY_RESIZE: continue
            if key == curses.KEY_UP: self.scroll = min(self.max_scroll, self.scroll + 1)
            elif key == curses.KEY_DOWN: self.scroll = max(0, self.scroll - 1)
            elif key == curses.KEY_PPAGE: self.scroll = min(self.max_scroll, self.scroll + self.page_size)
            elif key == curses.KEY_NPAGE: self.scroll = max(0, self.scroll - self.page_size)
            elif key == curses.KEY_HOME: self.scroll = self.max_scroll
            elif key == curses.KEY_END: self.scroll = 0
            elif key == curses.KEY_MOUSE:
                try:
                    _, _, _, _, state = curses.getmouse()
                    if state & getattr(curses, "BUTTON4_PRESSED", 0): self.scroll = min(self.max_scroll, self.scroll + 3)
                    elif state & getattr(curses, "BUTTON5_PRESSED", 0): self.scroll = max(0, self.scroll - 3)
                except curses.error: pass
            elif key in ("\n", "\r", curses.KEY_ENTER):
                value, self.input = self.input.strip(), ""
                if value and not self.command(value): break
            elif key in (curses.KEY_BACKSPACE, "\b", "\x7f"): self.input = self.input[:-1]
            elif isinstance(key, str) and key.isprintable(): self.input += key


def main():
    parser = argparse.ArgumentParser(description="PolyChat TUI client")
    parser.add_argument("--server", help="交互提示中的初始服务器地址")
    args = parser.parse_args(); api = choose_server(args.server)
    try:
        user = login(api); save_server(api.base_url)
        curses.wrapper(lambda screen: TUI(screen, api, user).run())
    except (ApiError, KeyboardInterrupt) as exc: print(f"\n{exc}")


if __name__ == "__main__": main()
