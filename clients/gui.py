#!/usr/bin/env python3
"""Flet desktop client for PolyChat."""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field
import os
from pathlib import Path
import re
import sys

import flet as ft

from chat_api import ApiError, ChatAPI, format_server_time, load_server, save_server


NAVY = "#111827"
NAVY_2 = "#182236"
PAPER = "#F6F7FB"
ACCENT = "#635BFF"
MUTED = "#7D879A"
INLINE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def bundled_path(relative_path: str) -> str:
    """Locate an asset in source runs and in the PyInstaller bundle."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return str(base / relative_path)


APP_ICON = bundled_path("assets/polychat-icon.png")


def flet_markdown(source: str) -> str:
    """Normalize common dollar-delimited LaTeX before Flet renders Markdown.

    ``flutter_markdown_plus_latex`` registers both ``$`` and ``$$`` as inline
    delimiters.  Its parser can choose the single-dollar rule for a ``$$...$$``
    expression, leaving a dollar sign in the TeX passed to ``Math.tex``.  The
    latter then reports ``Can't use function '$' in math mode``.  Its escaped
    delimiters (``\\(...)`` and ``\\[...\\]``) do not have that ambiguity.
    Keep fenced and inline code untouched so examples are displayed literally.
    """
    code_parts = re.split(r"(```[\s\S]*?```|`[^`\n]*`)", source)

    def normalize(part: str) -> str:
        # Handle double dollars first; otherwise the single-dollar expression
        # would consume one dollar at each end of a display formula.
        part = re.sub(
            r"(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$",
            lambda match: "\\[\n" + match.group(1).strip() + "\n\\]",
            part,
        )
        return re.sub(
            r"(?<!\\)\$([^$\n]+?)(?<!\\)\$",
            lambda match: "\\(" + match.group(1).strip() + "\\)",
            part,
        )

    return "".join(part if index % 2 else normalize(part) for index, part in enumerate(code_parts))


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
    image_cache: dict[int, bytes] = field(default_factory=dict)
    image_loading: set[int] = field(default_factory=set)
    image_failed: set[int] = field(default_factory=set)
    reply_to: dict | None = None
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
        self.clipboard = ft.Clipboard()
        self.page.services.extend([self.file_picker, self.clipboard])

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

    def message_image(self, message: dict) -> ft.Control:
        """Return an inline image, loading it with the chat authorization token."""
        attachment_id = message["attachment_id"]
        if attachment_id in self.state.image_cache:
            return ft.Container(
                content=ft.Row(
                    [ft.Image(src=self.state.image_cache[attachment_id], fit=ft.BoxFit.NONE, border_radius=10)],
                    scroll=ft.ScrollMode.AUTO,
                ),
                border=ft.Border.all(1, "#E1E4EC"),
                border_radius=11,
                clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
            )
        if attachment_id in self.state.image_failed:
            return ft.Text("图片加载失败", size=12, color="#B42318")
        if attachment_id not in self.state.image_loading:
            self.state.image_loading.add(attachment_id)
            self.page.run_task(self.load_message_image, attachment_id)
        return ft.Row([ft.ProgressRing(width=16, height=16, stroke_width=2), ft.Text("正在加载图片…", size=12, color=MUTED)], spacing=8)

    async def load_message_image(self, attachment_id: int):
        try:
            self.state.image_cache[attachment_id] = await self.call(
                self.state.api.request_bytes, f"/api/files/{attachment_id}?inline=1", 60
            )
            self.render_messages()
            self.page.update()
        except ApiError:
            self.state.image_failed.add(attachment_id)
            self.render_messages()
            self.page.update()
        finally:
            self.state.image_loading.discard(attachment_id)

    def show_toast(self, text: str, error: bool = False):
        self.page.show_dialog(ft.SnackBar(content=ft.Text(text), bgcolor="#B42318" if error else "#172033", duration=3000))

    def configure_page(self):
        self.page.title = "PolyChat"
        self.page.window.icon = APP_ICON
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
                    ft.Row([ft.Image(src=APP_ICON, width=48, height=48, border_radius=12), ft.Column([ft.Text("PolyChat", size=24, weight=ft.FontWeight.W_700), ft.Text("连接你的聊天室", color=MUTED, size=12)], spacing=1)], spacing=12),
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
                ft.IconButton(ft.Icons.SEARCH, tooltip="搜索消息", on_click=self.open_search),
                ft.IconButton(ft.Icons.PEOPLE_OUTLINE, tooltip="邀请私有房间成员", on_click=lambda _: self.page.run_task(self.open_members, _)),
                ft.IconButton(ft.Icons.SETTINGS_OUTLINED, tooltip="房间设置", on_click=self.open_room_settings),
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
        content = ft.Row([
            self.avatar(user, 20),
            ft.Column([ft.Text(user["username"], color="white", size=13, weight=ft.FontWeight.W_600), ft.Text("● 在线 · 点击管理账号", color="#4ADE80", size=9)], spacing=2, expand=True),
            ft.Icon(ft.Icons.CHEVRON_RIGHT, color="#8390A7", size=18),
        ], spacing=10)
        if hasattr(self, "profile"):
            self.profile.content = content
        else:
            self.profile = ft.Container(padding=ft.Padding(top=4), ink=True, on_click=self.open_profile_menu, content=content)

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
            flet_markdown(message.get("content") or ""),
            extension_set=ft.MarkdownExtensionSet.GITHUB_FLAVORED,
            auto_follow_links=True,
            latex_scale_factor=1.1,
            selectable=True,
        )
        card_controls = [
            ft.Row([
                ft.Text(message["username"], size=13, weight=ft.FontWeight.W_700, color="#1B2740"),
                ft.Text(format_server_time(message["created_at"]), size=10, color="#98A2B3"),
                ft.Container(expand=True),
                ft.IconButton(ft.Icons.REPLY_OUTLINED, icon_size=15, icon_color="#7D879A", tooltip="回复", on_click=lambda _, message=message: self.start_reply(message)),
                ft.IconButton(ft.Icons.CONTENT_COPY_OUTLINED, icon_size=15, icon_color="#7D879A", tooltip="复制 Markdown", on_click=lambda _, message=message: self.page.run_task(self.copy_markdown, message)),
                *([ft.IconButton(ft.Icons.EDIT_OUTLINED, icon_size=15, tooltip="编辑", on_click=lambda _, message=message: self.open_edit(message)), ft.IconButton(ft.Icons.UNDO_OUTLINED, icon_size=15, tooltip="撤回", on_click=lambda _, message=message: self.page.run_task(self.retract_message, message))] if mine else []),
            ], spacing=8),
        ]
        if message.get("reply_to"):
            card_controls.append(ft.Container(content=ft.Text(f"↳ 回复 {message.get('reply_username') or '消息'}：{message.get('reply_content') or '已撤回'}", size=11, color=MUTED, max_lines=1, overflow=ft.TextOverflow.ELLIPSIS), bgcolor="#F1F3F8", padding=7, border_radius=7))
        if message.get("is_deleted"):
            card_controls.append(ft.Text("此消息已撤回", italic=True, color=MUTED))
            return ft.Row([self.avatar(message, 19), ft.Container(content=ft.Column(card_controls, spacing=7, tight=True), bgcolor="#FFFFFF", padding=14, border_radius=14, border=ft.Border.all(1, "#E8EBF1"), expand=True)], vertical_alignment=ft.CrossAxisAlignment.START, spacing=10)
        if message.get("content"):
            card_controls.append(body)
        if message.get("attachment_id"):
            size = message.get("attachment_size", 0)
            readable = f"{size / 1024 / 1024:.1f} MB" if size >= 1024 * 1024 else (f"{size / 1024:.1f} KB" if size >= 1024 else f"{size} B")
            if message.get("attachment_type") in INLINE_IMAGE_TYPES:
                card_controls.extend([
                    self.message_image(message),
                    ft.Row([
                        ft.Text(f"{message['attachment_name']} · {readable}", size=10, color=MUTED, expand=True),
                        ft.TextButton("下载原图", on_click=lambda _, message=message: self.page.run_task(self.download_file, message)),
                    ], spacing=4),
                ])
            else:
                card_controls.append(ft.Container(
                    ink=True,
                    on_click=lambda _, message=message: self.page.run_task(self.download_file, message),
                    bgcolor="#EEEDFF",
                    border_radius=10,
                    padding=10,
                    content=ft.Row([ft.Icon(ft.Icons.ATTACH_FILE, color=ACCENT), ft.Column([ft.Text(message["attachment_name"], size=12, weight=ft.FontWeight.W_600), ft.Text(f"{readable} · 点击下载", size=10, color=MUTED)], spacing=1)], spacing=8),
                ))
        reaction_controls = [ft.TextButton(f"{item['emoji']} {item['count']}", on_click=lambda _, emoji=item['emoji'], message=message: self.page.run_task(self.react_message, message, emoji)) for item in message.get("reactions", [])]
        reaction_controls.extend(ft.IconButton(ft.Icons.ADD_REACTION_OUTLINED, icon_size=16, tooltip="添加表情", on_click=lambda _, message=message: self.open_reaction(message)) for _ in [0])
        card_controls.append(ft.Row(reaction_controls, spacing=2, wrap=True))
        return ft.Row([
            self.avatar(message, 19),
            ft.Container(
                content=ft.Column(card_controls, spacing=7, tight=True),
                bgcolor="#FFFFFF" if mine else "#FBFCFE",
                padding=ft.Padding(14, 14, 14, 14),
                border_radius=14,
                border=ft.Border.all(1, "#E8EBF1"),
                expand=True,
            ),
        ], vertical_alignment=ft.CrossAxisAlignment.START, spacing=10)

    async def copy_markdown(self, message: dict):
        try:
            await self.clipboard.set(message.get("content") or "")
            self.show_toast("已复制完整 Markdown")
        except Exception:
            self.show_toast("复制失败，请检查系统剪贴板权限", error=True)

    def render_messages(self):
        self.room_name.value = f"# {self.state.room['name']}" if self.state.room else "# 大厅"
        self.messages_view.controls.clear()
        if self.state.room and self.state.room.get("announcement"):
            announcement = self.state.room["announcement"]
            announcer = self.state.room.get("announcement_username", "管理员")
            self.messages_view.controls.append(ft.Container(
                bgcolor="#FEF3C7", border=ft.Border.all(1, "#FDE68A"), border_radius=10,
                padding=12, margin=ft.Margin(0, 0, 0, 12),
                content=ft.Column([
                    ft.Row([ft.Icon(ft.Icons.CAMPAIGN_OUTLINED, color="#92400E", size=16), ft.Text("公告", size=12, weight=ft.FontWeight.W_700, color="#92400E"), ft.Text(f"by {announcer}", size=10, color="#B45309")], spacing=6),
                    ft.Markdown(flet_markdown(announcement), extension_set=ft.MarkdownExtensionSet.GITHUB_FLAVORED, selectable=True),
                ], spacing=6, tight=True)
            ))
        if not self.state.messages:
            self.messages_view.controls.append(ft.Container(ft.Column([ft.Icon(ft.Icons.FORUM_OUTLINED, size=42, color="#AAB2C2"), ft.Text("这里还没有消息", size=18, weight=ft.FontWeight.W_600), ft.Text("用 Markdown 或 LaTeX 开启话题吧。", color=MUTED)], horizontal_alignment=ft.CrossAxisAlignment.CENTER), alignment=ft.Alignment.CENTER, expand=True))
        else:
            self.messages_view.controls.extend(self.message_card(message) for message in self.state.messages)

    def compose_bar(self):
        return ft.Container(
            bgcolor=PAPER,
            padding=ft.Padding(24, 10, 24, 20),
            content=ft.Column([
                ft.Container(content=ft.Text(f"↳ 回复 {self.state.reply_to['username']}：{self.state.reply_to.get('content', '')[:70]}", size=11), bgcolor="#EEF1F7", padding=7, border_radius=7, visible=self.state.reply_to is not None),
                ft.Container(
                    bgcolor="white",
                    border=ft.Border.all(1, "#DDE2EA"),
                    border_radius=14,
                    padding=ft.Padding(left=6, right=10, top=4, bottom=4),
                    content=ft.Row([
                        self.composer,
                        ft.IconButton(ft.Icons.INSERT_EMOTICON_OUTLINED, tooltip="插入表情", icon_color="#5E6A80", on_click=self.open_emoji),
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
            message = await self.call(self.state.api.send, self.state.room["id"], content, None, self.state.reply_to["id"] if self.state.reply_to else None)
            self.state.messages.append(message)
            self.state.last_id = message["id"]
            self.status.value = ""
            self.state.reply_to = None
            self.render_messages()
            self.page.update()
        except ApiError as exc:
            self.composer.value = content
            self.status.value = ""
            self.show_toast(str(exc), error=True)

    async def choose_file(self, _=None):
        files = await self.file_picker.pick_files(dialog_title="选择文件（支持多选）", allow_multiple=True)
        if not files:
            return
        self.status.value = f"正在上传 {len(files)} 个文件…"
        self.page.update()
        try:
            for i, selected in enumerate(files):
                if not selected.path:
                    continue
                self.status.value = f"正在上传 {selected.name} ({i + 1}/{len(files)})…"
                self.page.update()
                message = await self.call(self.state.api.send_file, self.state.room["id"], selected.path, self.composer.value.strip() if i == 0 else "")
                self.state.messages.append(message)
                self.state.last_id = message["id"]
            self.composer.value = ""
            self.status.value = ""
            self.render_messages()
            self.page.update()
        except (ApiError, OSError) as exc:
            self.status.value = ""
            self.show_toast(str(exc), error=True)

    def open_profile_menu(self, _=None):
        def change_avatar(_):
            self.page.pop_dialog()
            self.page.run_task(self.choose_avatar)

        def export_data(_):
            self.page.pop_dialog()
            self.page.run_task(self.export_user_data)

        def delete_account(_):
            self.page.pop_dialog()
            self.page.run_task(self.confirm_delete_account)

        self.page.show_dialog(ft.AlertDialog(
            title=ft.Text("账号管理"),
            content=ft.Column([
                ft.ListTile(title=ft.Text("更换头像"), leading=ft.Icon(ft.Icons.PERSON_OUTLINED), on_click=change_avatar),
                ft.ListTile(title=ft.Text("导出聊天记录"), leading=ft.Icon(ft.Icons.DOWNLOAD_OUTLINED), on_click=export_data),
                ft.ListTile(title=ft.Text("删除账号"), leading=ft.Icon(ft.Icons.DELETE_OUTLINE, color="#B42318"), on_click=delete_account),
            ], tight=True),
            actions=[ft.TextButton("关闭", on_click=lambda _: self.page.pop_dialog())],
        ))

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

    async def export_user_data(self, _=None):
        destination = await self.file_picker.save_file(dialog_title="导出聊天记录", file_name=f"polychat-export.json")
        if not destination:
            return
        self.status.value = "正在导出聊天记录…"
        self.page.update()
        try:
            path = await self.call(self.state.api.export_data, destination)
            self.status.value = f"聊天记录已导出到 {path}"
            self.page.update()
        except ApiError as exc:
            self.status.value = ""
            self.show_toast(str(exc), error=True)

    async def confirm_delete_account(self, _=None):
        password = ft.TextField(label="输入密码确认", password=True, can_reveal_password=True, autofocus=True)

        async def confirm(_):
            try:
                await self.call(self.state.api.delete_account, password.value)
                self.page.pop_dialog()
                self.show_toast("账号已删除")
                self.state.user = None
                self.show_login()
            except ApiError as exc:
                password.error_text = str(exc)
                self.page.update()

        self.page.show_dialog(ft.AlertDialog(
            title=ft.Text("删除账号"),
            content=ft.Column([
                ft.Text("此操作不可恢复，所有消息和文件将被永久删除。", color="#B42318"),
                password,
            ], tight=True),
            actions=[ft.TextButton("取消", on_click=lambda _: self.page.pop_dialog()), ft.FilledButton("确认删除", bgcolor="#B42318", on_click=lambda _: self.page.run_task(confirm, _))],
        ))

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

    def start_reply(self, message):
        self.state.reply_to = message
        self.show_toast(f"正在回复 {message['username']}")
        self.page.update()

    def open_emoji(self, _=None):
        emojis = "😀 😃 😂 😊 😍 😎 🤔 😭 😡 👍 👎 🙏 👏 🎉 ❤️ 🔥 ✅ 👀 💯 🥳 🤖 👻 🐱 🐶 🌈 🍕 ☕ 🎮 🚀 💻 📌".split()
        self.page.show_dialog(ft.AlertDialog(title=ft.Text("EmojiAll 常用表情"), content=ft.Row([ft.TextButton(emoji, on_click=lambda _, emoji=emoji: self.insert_emoji(emoji)) for emoji in emojis], wrap=True, width=440), actions=[ft.TextButton("关闭", on_click=lambda _: self.page.pop_dialog())]))

    def insert_emoji(self, emoji):
        self.composer.value = (self.composer.value or "") + emoji
        self.page.pop_dialog()
        self.page.update()

    def open_edit(self, message):
        field = ft.TextField(value=message.get("content") or "", multiline=True, min_lines=4, autofocus=True)
        async def save(_):
            try:
                updated = await self.call(self.state.api.edit_message, message["id"], field.value)
                message.update(updated)
                self.page.pop_dialog(); self.render_messages(); self.page.update()
            except ApiError as exc:
                field.error_text = str(exc); self.page.update()
        self.page.show_dialog(ft.AlertDialog(title=ft.Text("编辑消息"), content=field, actions=[ft.TextButton("取消", on_click=lambda _: self.page.pop_dialog()), ft.FilledButton("保存", on_click=lambda _: self.page.run_task(save, _))]))

    async def retract_message(self, message):
        try:
            await self.call(self.state.api.retract_message, message["id"])
            message["content"] = ""; message["attachment_id"] = None; message["is_deleted"] = True
            self.render_messages(); self.page.update()
        except ApiError as exc:
            self.show_toast(str(exc), error=True)

    def open_reaction(self, message):
        emojis = "👍 ❤️ 😂 🎉 😮 👀 🔥 ✅ 💯".split()
        self.page.show_dialog(ft.AlertDialog(title=ft.Text("选择表情"), content=ft.Row([ft.TextButton(emoji, on_click=lambda _, emoji=emoji: self.page.run_task(self.react_message, message, emoji)) for emoji in emojis]), actions=[ft.TextButton("关闭", on_click=lambda _: self.page.pop_dialog())]))

    async def react_message(self, message, emoji):
        try:
            message["reactions"] = await self.call(self.state.api.react, message["id"], emoji)
            if getattr(self.page, "dialog", None): self.page.pop_dialog()
            self.render_messages(); self.page.update()
        except ApiError as exc:
            self.show_toast(str(exc), error=True)

    def open_search(self, _=None):
        query, results = ft.TextField(label="关键词", autofocus=True), ft.Column(scroll=ft.ScrollMode.AUTO, height=260)
        async def search(_):
            try:
                matches = await self.call(self.state.api.search, query.value)
                results.controls = [ft.Text(f"#{item['room_name']} · {item['username']}\n{item['content']}", size=12) for item in matches] or [ft.Text("没有结果")]
                self.page.update()
            except ApiError as exc: self.show_toast(str(exc), error=True)
        self.page.show_dialog(ft.AlertDialog(title=ft.Text("搜索消息"), content=ft.Column([query, results], tight=True, width=480), actions=[ft.FilledButton("搜索", on_click=lambda _: self.page.run_task(search, _)), ft.TextButton("关闭", on_click=lambda _: self.page.pop_dialog())]))

    async def open_members(self, _=None):
        if not self.state.room: return
        username = ft.TextField(label="邀请用户名", autofocus=True)
        codes_list = ft.Column(spacing=4)

        async def load_codes():
            try:
                codes = await self.call(self.state.api.invite_codes, self.state.room["id"])
                codes_list.controls.clear()
                if codes:
                    for c in codes:
                        code_text = f"{c['code']} · {c['use_count']}次使用"
                        if c.get("expires_at"):
                            code_text += f" · 过期 {c['expires_at']}"
                        codes_list.controls.append(ft.Row([
                            ft.Text(code_text, size=11, expand=True),
                            ft.TextButton("复制", on_click=lambda _, code=c["code"]: self.page.run_task(self.copy_invite, code)),
                            ft.TextButton("删除", on_click=lambda _, cid=c["id"]: self.page.run_task(self.delete_invite_code, cid)),
                        ], spacing=4))
                else:
                    codes_list.controls.append(ft.Text("暂无邀请码", size=11, color=MUTED))
            except ApiError:
                pass

        async def invite(_):
            try:
                await self.call(self.state.api.invite_member, self.state.room["id"], username.value)
                username.value = ""; self.page.update(); self.show_toast("成员已邀请")
            except ApiError as exc: username.error_text = str(exc); self.page.update()

        async def create_code(_):
            try:
                await self.call(self.state.api.create_invite_code, self.state.room["id"])
                self.show_toast("邀请码已创建"); await load_codes(); self.page.update()
            except ApiError as exc: self.show_toast(str(exc), error=True)

        await load_codes()
        content = ft.Column([
            username,
            ft.Row([ft.TextButton("取消", on_click=lambda _: self.page.pop_dialog()), ft.FilledButton("邀请", on_click=lambda _: self.page.run_task(invite, _))]),
            ft.Divider(),
            ft.Row([ft.Text("邀请码", size=12, weight=ft.FontWeight.W_700), ft.Container(expand=True), ft.OutlinedButton("创建邀请码", on_click=lambda _: self.page.run_task(create_code, _))]),
            codes_list,
        ], tight=True, scroll=ft.ScrollMode.AUTO)
        self.page.show_dialog(ft.AlertDialog(title=ft.Text("私有房间成员"), content=content, actions=[ft.TextButton("关闭", on_click=lambda _: self.page.pop_dialog())]))

    async def copy_invite(self, code):
        try:
            link = f"{self.state.api.base_url}/#/invite/{code}"
            await self.clipboard.set(link)
            self.show_toast("邀请链接已复制")
        except Exception:
            self.show_toast("复制失败", error=True)

    async def delete_invite_code(self, code_id):
        try:
            await self.call(self.state.api.delete_invite_code, self.state.room["id"], code_id)
            self.show_toast("邀请码已删除")
        except ApiError as exc:
            self.show_toast(str(exc), error=True)

    def open_room_settings(self, _=None):
        if not self.state.room:
            return
        name = ft.TextField(label="聊天室名称", value=self.state.room["name"], autofocus=True)
        async def save(_):
            try:
                updated = await self.call(self.state.api.update_room, self.state.room["id"], name.value)
                self.state.room = updated; await self.load_rooms(); self.page.pop_dialog(); self.render_sidebar(); self.render_messages(); self.page.update()
            except ApiError as exc: name.error_text = str(exc); self.page.update()
        async def delete(_):
            try:
                await self.call(self.state.api.delete_room, self.state.room["id"])
                self.page.pop_dialog(); await self.load_rooms(select_first=True); self.render_sidebar(); self.render_messages(); self.page.update()
            except ApiError as exc: name.error_text = str(exc); self.page.update()
        self.page.show_dialog(ft.AlertDialog(title=ft.Text("房间设置"), content=name, actions=[ft.TextButton("取消", on_click=lambda _: self.page.pop_dialog()), ft.TextButton("删除房间", on_click=lambda _: self.page.run_task(delete, _)), ft.FilledButton("保存", on_click=lambda _: self.page.run_task(save, _))]))

    def open_new_room(self, _=None):
        name = ft.TextField(label="聊天室名称", autofocus=True)
        private = ft.Checkbox(label="私有聊天室（仅邀请成员可见）")

        async def create(_):
            try:
                room = await self.call(self.state.api.create_room, name.value.strip(), private.value)
                self.page.pop_dialog()
                await self.load_rooms()
                await self.select_room(room)
            except ApiError as exc:
                name.error = str(exc)
                self.page.update()

        self.page.show_dialog(ft.AlertDialog(
            modal=True,
            title=ft.Text("新建聊天室"),
            content=ft.Column([name, private], tight=True),
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
