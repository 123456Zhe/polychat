#!/usr/bin/env python3
"""Flet desktop client for PolyChat."""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field
import os
from pathlib import Path

import flet as ft

from chat_api import ApiError, ChatAPI, format_server_time, load_server, save_server


NAVY = "#111827"
NAVY_2 = "#182236"
PAPER = "#F6F7FB"
ACCENT = "#635BFF"
MUTED = "#7D879A"


@dataclass
class ChatState:
    api: ChatAPI
    user: dict | None = None
    rooms: list[dict] = field(default_factory=list)
    room: dict | None = None
    messages: list[dict] = field(default_factory=list)
    last_id: int = 0
    avatar_cache: dict[tuple[int, int], bytes] = field(default_factory=dict)
    avatar_loading: set[tuple[int, int]] = field(default_factory=set)
    active: bool = True


class PolyChatApp:
    def __init__(self, page: ft.Page, server: str | None):
        self.page = page
        self.state = ChatState(ChatAPI(server or os.getenv("POLYCHAT_SERVER") or load_server()))
        self.rooms_view = ft.Column(spacing=4, scroll=ft.ScrollMode.AUTO, expand=True)
        self.messages_view = ft.ListView(expand=True, spacing=14, padding=ft.Padding(28, 22, 28, 22), auto_scroll=True)
        self.room_name = ft.Text("大厅", size=20, weight=ft.FontWeight.W_700, color="#172033")
        self.status = ft.Text("", size=12, color=MUTED)
        self.composer = ft.TextField(
            multiline=True,
            min_lines=1,
            max_lines=5,
            hint_text="输入消息…  支持 Markdown 和 $LaTeX$",
            border=ft.InputBorder.NONE,
            text_size=14,
            expand=True,
            shift_enter=True,
            on_submit=self.send_message,
        )
        self.file_picker = ft.FilePicker()
        self.page.services.append(self.file_picker)

    async def call(self, function, *args):
        return await asyncio.to_thread(function, *args)

    def avatar(self, user: dict, radius: int = 20):
        version = user.get("avatar_updated_at")
        key = (user["user_id"] if "user_id" in user else user["id"], version) if version else None
        if key and key in self.state.avatar_cache:
            return ft.CircleAvatar(radius=radius, foreground_image_src=self.state.avatar_cache[key], bgcolor=ACCENT)
        if key and key not in self.state.avatar_loading:
            self.state.avatar_loading.add(key)
            self.page.run_task(self.load_avatar, key)
        return ft.CircleAvatar(
            radius=radius,
            bgcolor="#8B5CF6",
            color="white",
            content=ft.Text(user["username"][:1].upper(), weight=ft.FontWeight.W_700),
        )

    async def load_avatar(self, key: tuple[int, int]):
        try:
            data = await self.call(self.state.api.avatar, *key)
            self.state.avatar_cache[key] = data
            self.render_messages()
            self.render_profile()
            self.page.update()
        except ApiError:
            pass
        finally:
            self.state.avatar_loading.discard(key)

    def show_toast(self, text: str, error: bool = False):
        self.page.show_dialog(ft.SnackBar(content=ft.Text(text), bgcolor="#B42318" if error else "#172033", duration=3000))

    def configure_page(self):
        self.page.title = "PolyChat"
        self.page.theme_mode = ft.ThemeMode.LIGHT
        self.page.bgcolor = PAPER
        self.page.padding = 0
        self.page.spacing = 0
        self.page.window.width = 1120
        self.page.window.height = 740
        self.page.window.min_width = 760
        self.page.window.min_height = 540

    async def start(self):
        self.configure_page()
        self.show_login()

    def show_login(self):
        server = ft.TextField(label="服务器地址", value=self.state.api.base_url, prefix_icon=ft.Icons.LAN_OUTLINED)
        username = ft.TextField(label="用户名", autofocus=True, prefix_icon=ft.Icons.PERSON_OUTLINE)
        password = ft.TextField(label="密码", password=True, can_reveal_password=True, prefix_icon=ft.Icons.LOCK_OUTLINE, on_submit=lambda _: self.page.run_task(self.authenticate, False, server, username, password))
        feedback = ft.Text(size=12, color="#C62828")

        async def auth(register: bool):
            await self.authenticate(register, server, username, password, feedback)

        card = ft.Container(
            width=420,
            padding=36,
            border_radius=24,
            bgcolor="white",
            shadow=ft.BoxShadow(blur_radius=30, color="#1C254015", offset=ft.Offset(0, 12)),
            content=ft.Column(
                tight=True,
                controls=[
                    ft.Row([ft.Container(ft.Text("P", color="white", weight=ft.FontWeight.W_700, size=22), bgcolor=ACCENT, border_radius=12, width=48, height=48, alignment=ft.Alignment.CENTER), ft.Column([ft.Text("PolyChat", size=24, weight=ft.FontWeight.W_700), ft.Text("连接你的聊天室", color=MUTED, size=12)], spacing=1)], spacing=12),
                    ft.Divider(height=26, color=ft.Colors.TRANSPARENT),
                    server,
                    username,
                    password,
                    feedback,
                    ft.Row([
                        ft.FilledButton("登录", icon=ft.Icons.LOGIN, expand=True, height=44, on_click=lambda _: self.page.run_task(auth, False)),
                        ft.OutlinedButton("注册", expand=True, height=44, on_click=lambda _: self.page.run_task(auth, True)),
                    ], spacing=10),
                ],
            ),
        )
        self.page.clean()
        self.page.add(ft.Container(expand=True, alignment=ft.Alignment.CENTER, bgcolor=PAPER, content=card))
        self.page.update()

    async def authenticate(self, register: bool, server, username, password, feedback=None):
        try:
            self.state.api.set_server(server.value)
            user = await self.call(self.state.api.login, username.value.strip(), password.value, register)
            self.state.user = user
            save_server(self.state.api.base_url)
            await self.load_rooms(select_first=True)
            self.show_chat()
            self.page.run_task(self.poll_loop)
        except ApiError as exc:
            if feedback is not None:
                feedback.value = str(exc)
                self.page.update()
            else:
                self.show_toast(str(exc), error=True)

    def show_chat(self):
        self.page.clean()
        self.render_sidebar()
        self.render_messages()
        content = ft.Row([
            self.sidebar,
            ft.VerticalDivider(width=1, color="#E5E9F0"),
            ft.Column([
                self.header(),
                self.messages_view,
                self.compose_bar(),
            ], expand=True, spacing=0),
        ], expand=True, spacing=0)
        self.page.add(content)
        self.page.update()

    def header(self):
        return ft.Container(
            height=82,
            bgcolor="white",
            padding=ft.Padding(left=28, right=28),
            content=ft.Row([
                ft.Column([self.room_name, ft.Text("消息自动同步 · 支持 Markdown 与 LaTeX", size=11, color=MUTED)], spacing=2),
                ft.Container(expand=True),
                ft.Container(ft.Row([ft.Icon(ft.Icons.CIRCLE, size=9, color="#22C55E"), ft.Text("已连接", size=12, color="#15803D", weight=ft.FontWeight.W_600)], spacing=6), bgcolor="#ECFDF3", padding=ft.Padding(11, 7, 11, 7), border_radius=16),
            ]),
        )

    def render_sidebar(self):
        self.rooms_view.controls.clear()
        for room in self.state.rooms:
            selected = self.state.room and room["id"] == self.state.room["id"]
            self.rooms_view.controls.append(ft.Container(
                padding=ft.Padding(13, 10, 13, 10),
                border_radius=9,
                bgcolor="#2B3A55" if selected else None,
                ink=True,
                on_click=lambda _, room=room: self.page.run_task(self.select_room, room),
                content=ft.Row([ft.Icon(ft.Icons.TAG, size=17, color="#AEBBD0" if not selected else "white"), ft.Text(room["name"], color="white" if selected else "#B6C1D3", size=14, weight=ft.FontWeight.W_600 if selected else ft.FontWeight.W_400)], spacing=8),
            ))
        self.render_profile()
        brand = ft.Row([
            ft.Container(ft.Text("P", color="white", weight=ft.FontWeight.W_700, size=18), width=38, height=38, bgcolor=ACCENT, border_radius=10, alignment=ft.Alignment.CENTER),
            ft.Column([ft.Text("PolyChat", color="white", size=18, weight=ft.FontWeight.W_700), ft.Text("CHAT · MARKDOWN · LATEX", color="#79869D", size=8, weight=ft.FontWeight.W_600)], spacing=2),
        ], spacing=10)
        self.sidebar = ft.Container(
            width=254,
            bgcolor=NAVY,
            padding=ft.Padding(left=14, right=14, top=20, bottom=14),
            content=ft.Column([
                ft.Container(brand, padding=ft.Padding(left=5, bottom=20)),
                ft.Divider(height=1, color="#253047"),
                ft.Row([ft.Text("聊天室", color="#8895AB", size=11, weight=ft.FontWeight.W_700), ft.Container(expand=True), ft.IconButton(ft.Icons.ADD, icon_color="#E3E8F5", bgcolor="#263653", icon_size=18, tooltip="新建聊天室", on_click=self.open_new_room)], alignment=ft.MainAxisAlignment.SPACE_BETWEEN),
                self.rooms_view,
                ft.Divider(height=1, color="#253047"),
                self.profile,
            ], expand=True, spacing=14),
        )

    def render_profile(self):
        user = self.state.user
        self.profile = ft.Container(
            padding=ft.Padding(top=4),
            ink=True,
            on_click=self.choose_avatar,
            content=ft.Row([
                self.avatar(user, 20),
                ft.Column([ft.Text(user["username"], color="white", size=13, weight=ft.FontWeight.W_600), ft.Text("● 在线 · 点击更换头像", color="#4ADE80", size=9)], spacing=2, expand=True),
                ft.Icon(ft.Icons.CHEVRON_RIGHT, color="#8390A7", size=18),
            ], spacing=10),
        )

    async def load_rooms(self, select_first: bool = False):
        rooms = await self.call(self.state.api.rooms)
        current_id = self.state.room["id"] if self.state.room else None
        self.state.rooms = rooms
        self.state.room = next((room for room in rooms if room["id"] == current_id), None)
        if (select_first or self.state.room is None) and rooms:
            self.state.room = rooms[0]
            self.state.messages = []
            self.state.last_id = 0
            messages = await self.call(self.state.api.messages, rooms[0]["id"], 0)
            self.state.messages = messages
            self.state.last_id = messages[-1]["id"] if messages else 0

    async def select_room(self, room):
        if self.state.room and room["id"] == self.state.room["id"]:
            return
        self.state.room = room
        self.state.messages = []
        self.state.last_id = 0
        self.status.value = "正在加载消息…"
        self.room_name.value = f"# {room['name']}"
        self.render_sidebar()
        self.page.update()
        try:
            messages = await self.call(self.state.api.messages, room["id"], 0)
            self.state.messages = messages
            self.state.last_id = messages[-1]["id"] if messages else 0
            self.status.value = ""
            self.render_messages()
            self.render_sidebar()
            self.page.update()
        except ApiError as exc:
            self.show_toast(str(exc), error=True)

    def message_card(self, message):
        mine = message["user_id"] == self.state.user["id"]
        body = ft.Markdown(
            message.get("content") or "",
            extension_set=ft.MarkdownExtensionSet.GITHUB_FLAVORED,
            auto_follow_links=True,
            latex_scale_factor=1.1,
            selectable=True,
        )
        card_controls = [
            ft.Row([
                ft.Text(message["username"], size=13, weight=ft.FontWeight.W_700, color="#1B2740"),
                ft.Text(format_server_time(message["created_at"]), size=10, color="#98A2B3"),
            ], spacing=8),
        ]
        if message.get("content"):
            card_controls.append(body)
        if message.get("attachment_id"):
            size = message.get("attachment_size", 0)
            readable = f"{size / 1024 / 1024:.1f} MB" if size >= 1024 * 1024 else (f"{size / 1024:.1f} KB" if size >= 1024 else f"{size} B")
            card_controls.append(ft.Container(
                ink=True,
                on_click=lambda _, message=message: self.page.run_task(self.download_file, message),
                bgcolor="#EEEDFF",
                border_radius=10,
                padding=10,
                content=ft.Row([ft.Icon(ft.Icons.ATTACH_FILE, color=ACCENT), ft.Column([ft.Text(message["attachment_name"], size=12, weight=ft.FontWeight.W_600), ft.Text(f"{readable} · 点击下载", size=10, color=MUTED)], spacing=1)], spacing=8),
            ))
        return ft.Row([
            self.avatar(message, 19),
            ft.Container(
                content=ft.Column(card_controls, spacing=7, tight=True),
                bgcolor="#FFFFFF" if mine else "#FBFCFE",
                padding=ft.Padding(14, 14, 14, 14),
                border_radius=14,
                border=ft.border.all(1, "#E8EBF1"),
                expand=True,
            ),
        ], vertical_alignment=ft.CrossAxisAlignment.START, spacing=10)

    def render_messages(self):
        self.room_name.value = f"# {self.state.room['name']}" if self.state.room else "# 大厅"
        self.messages_view.controls.clear()
        if not self.state.messages:
            self.messages_view.controls.append(ft.Container(ft.Column([ft.Icon(ft.Icons.FORUM_OUTLINED, size=42, color="#AAB2C2"), ft.Text("这里还没有消息", size=18, weight=ft.FontWeight.W_600), ft.Text("用 Markdown 或 LaTeX 开启话题吧。", color=MUTED)], horizontal_alignment=ft.CrossAxisAlignment.CENTER), alignment=ft.Alignment.CENTER, expand=True))
        else:
            self.messages_view.controls.extend(self.message_card(message) for message in self.state.messages)

    def compose_bar(self):
        return ft.Container(
            bgcolor=PAPER,
            padding=ft.Padding(24, 10, 24, 20),
            content=ft.Column([
                ft.Container(
                    bgcolor="white",
                    border=ft.border.all(1, "#DDE2EA"),
                    border_radius=14,
                    padding=ft.Padding(left=6, right=10, top=4, bottom=4),
                    content=ft.Row([
                        self.composer,
                        ft.IconButton(ft.Icons.ATTACH_FILE, tooltip="发送文件", icon_color="#5E6A80", on_click=self.choose_file),
                        ft.FilledButton("发送", icon=ft.Icons.ARROW_UPWARD, height=42, on_click=self.send_message),
                    ], vertical_alignment=ft.CrossAxisAlignment.END),
                ),
                self.status,
            ], spacing=3),
        )

    async def send_message(self, _=None):
        if not self.state.room or not self.composer.value.strip():
            return
        content = self.composer.value.strip()
        self.composer.value = ""
        self.status.value = "正在发送…"
        self.page.update()
        try:
            message = await self.call(self.state.api.send, self.state.room["id"], content)
            self.state.messages.append(message)
            self.state.last_id = message["id"]
            self.status.value = ""
            self.render_messages()
            self.page.update()
        except ApiError as exc:
            self.composer.value = content
            self.status.value = ""
            self.show_toast(str(exc), error=True)

    async def choose_file(self, _=None):
        files = await self.file_picker.pick_files(dialog_title="选择不超过 10 MB 的文件", allow_multiple=False)
        if not files:
            return
        selected = files[0]
        if not selected.path:
            self.show_toast("当前平台未提供文件路径，无法上传文件", error=True)
            return
        self.status.value = f"正在上传 {selected.name}…"
        self.page.update()
        try:
            message = await self.call(self.state.api.send_file, self.state.room["id"], selected.path, self.composer.value.strip())
            self.composer.value = ""
            self.state.messages.append(message)
            self.state.last_id = message["id"]
            self.status.value = ""
            self.render_messages()
            self.page.update()
        except (ApiError, OSError) as exc:
            self.status.value = ""
            self.show_toast(str(exc), error=True)

    async def choose_avatar(self, _=None):
        files = await self.file_picker.pick_files(dialog_title="选择 2 MB 以内的头像", allow_multiple=False, file_type=ft.FilePickerFileType.CUSTOM, allowed_extensions=["png", "jpg", "jpeg", "webp", "gif"])
        if not files or not files[0].path:
            return
        try:
            self.state.user = await self.call(self.state.api.upload_avatar, files[0].path)
            self.render_sidebar()
            self.page.update()
            self.show_toast("头像已更新")
        except (ApiError, OSError) as exc:
            self.show_toast(str(exc), error=True)

    async def download_file(self, message):
        destination = await self.file_picker.save_file(dialog_title="保存附件", file_name=message["attachment_name"])
        if not destination:
            return
        self.status.value = f"正在下载 {message['attachment_name']}…"
        self.page.update()
        try:
            await self.call(self.state.api.download, message["attachment_id"], destination)
            self.status.value = f"文件已保存到 {destination}"
            self.page.update()
        except ApiError as exc:
            self.status.value = ""
            self.show_toast(str(exc), error=True)

    def open_new_room(self, _=None):
        name = ft.TextField(label="聊天室名称", autofocus=True)

        async def create(_):
            try:
                room = await self.call(self.state.api.create_room, name.value.strip())
                self.page.pop_dialog()
                await self.load_rooms()
                await self.select_room(room)
            except ApiError as exc:
                name.error = str(exc)
                self.page.update()

        self.page.show_dialog(ft.AlertDialog(
            modal=True,
            title=ft.Text("新建聊天室"),
            content=name,
            actions=[ft.TextButton("取消", on_click=lambda _: self.page.pop_dialog()), ft.FilledButton("创建", on_click=lambda _: self.page.run_task(create, _))],
        ))

    async def poll_loop(self):
        while self.state.active:
            await asyncio.sleep(1.8)
            if not self.state.room:
                continue
            try:
                messages = await self.call(self.state.api.messages, self.state.room["id"], self.state.last_id)
                rooms = await self.call(self.state.api.rooms)
                if messages:
                    self.state.messages.extend(messages)
                    self.state.last_id = messages[-1]["id"]
                    self.render_messages()
                if [(room["id"], room["name"]) for room in rooms] != [(room["id"], room["name"]) for room in self.state.rooms]:
                    self.state.rooms = rooms
                    self.state.room = next((room for room in rooms if room["id"] == self.state.room["id"]), self.state.room)
                    self.render_sidebar()
                if messages:
                    self.page.update()
            except ApiError:
                pass


async def main(page: ft.Page):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--server")
    args, _ = parser.parse_known_args()
    app = PolyChatApp(page, args.server)
    await app.start()


if __name__ == "__main__":
    ft.run(main)
