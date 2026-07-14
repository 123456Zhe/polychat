#!/usr/bin/env python3
"""Tkinter desktop client for PolyChat."""
from __future__ import annotations

import argparse
from io import BytesIO
import queue
import re
import threading
import time
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

from PIL import Image, ImageDraw, ImageOps, ImageTk

try:
    from matplotlib.font_manager import FontProperties
    from matplotlib.mathtext import math_to_image
except ImportError:  # Source runs remain usable before optional GUI dependencies are installed.
    FontProperties = None
    math_to_image = None

from chat_api import ApiError, ChatAPI, format_server_time, load_server, save_server


INLINE_MARKDOWN = re.compile(
    r"(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|"
    r"\[[^\]\n]+\]\(https?://[^\s)]+\)|\$[^$\n]+\$|(?<!\*)\*[^*\n]+\*(?!\*))"
)
BLOCK_MARKDOWN = re.compile(r"```([^\n`]*)\n([\s\S]*?)```|\$\$([\s\S]*?)\$\$")


class PolyChatGUI(tk.Tk):
    def __init__(self, server: str | None = None):
        super().__init__()
        self.title("PolyChat")
        for icon_path in (Path(__file__).resolve().parent / "polychat-icon.png", Path(__file__).resolve().parent.parent / "assets" / "polychat-icon.png"):
            if icon_path.exists():
                try:
                    self.app_icon = tk.PhotoImage(file=icon_path); self.iconphoto(True, self.app_icon)
                except tk.TclError: pass
                break
        self.geometry("1000x680")
        self.minsize(720, 480)
        self.api = ChatAPI(server or load_server())
        self.events = queue.Queue()
        self.room = None
        self.last_id = 0
        self.last_room_poll = 0
        self.running = True
        self.message_images = []
        self.avatar_photo = None
        self.link_counter = 0
        self.transfer_active = False
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.configure(bg="#f5f7fb")
        self._styles()
        self.show_login()
        self.after(100, self.process_events)

    def _styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Accent.TButton", background="#635bff", foreground="white", padding=9, borderwidth=0)
        style.map("Accent.TButton", background=[("active", "#5148ed")])
        style.configure("Quiet.TButton", background="#222d42", foreground="#d9e0ed", padding=8, borderwidth=0)
        style.map("Quiet.TButton", background=[("active", "#303d55")], foreground=[("active", "white")])
        style.configure("Side.TFrame", background="#111827")
        style.configure("Side.TLabel", background="#111827", foreground="#e7eaf1")

    def clear(self):
        for child in self.winfo_children():
            child.destroy()

    def show_login(self):
        self.clear()
        wrap = ttk.Frame(self, padding=42)
        wrap.place(relx=.5, rely=.5, anchor="center", width=420)
        ttk.Label(wrap, text="PolyChat", font=("sans", 26, "bold")).pack(anchor="w")
        ttk.Label(wrap, text="登录你的持久化账号", foreground="#778196").pack(anchor="w", pady=(2, 18))
        ttk.Label(wrap, text="服务器地址").pack(anchor="w")
        self.server_entry = ttk.Entry(wrap, font=("sans", 12)); self.server_entry.insert(0, self.api.base_url)
        self.server_entry.pack(fill="x", pady=(5, 12), ipady=5)
        ttk.Label(wrap, text="用户名").pack(anchor="w")
        self.username = ttk.Entry(wrap, font=("sans", 12)); self.username.pack(fill="x", pady=(5, 14), ipady=5)
        ttk.Label(wrap, text="密码").pack(anchor="w")
        self.password = ttk.Entry(wrap, show="•", font=("sans", 12)); self.password.pack(fill="x", pady=(5, 16), ipady=5)
        self.auth_status = ttk.Label(wrap, text="", foreground="#d43d51"); self.auth_status.pack(anchor="w")
        row = ttk.Frame(wrap); row.pack(fill="x", pady=(8, 0))
        ttk.Button(row, text="登录", style="Accent.TButton", command=lambda: self.authenticate(False)).pack(side="left", expand=True, fill="x", padx=(0, 4))
        ttk.Button(row, text="注册", command=lambda: self.authenticate(True)).pack(side="left", expand=True, fill="x", padx=(4, 0), ipady=8)
        self.password.bind("<Return>", lambda _: self.authenticate(False)); self.username.focus()

    def authenticate(self, register: bool):
        try:
            self.api.set_server(self.server_entry.get())
        except ApiError as exc:
            self.auth_status.config(text=str(exc)); return
        save_server(self.api.base_url)
        self.auth_status.config(text="正在连接…")
        self.background("auth", self.api.login, self.username.get(), self.password.get(), register)

    def show_chat(self, user):
        self.clear(); self.user = user
        side = ttk.Frame(self, style="Side.TFrame", width=225); side.pack(side="left", fill="y"); side.pack_propagate(False)
        ttk.Label(side, text="  P  PolyChat", style="Side.TLabel", font=("sans", 16, "bold"), padding=(14, 18)).pack(fill="x")
        title = ttk.Frame(side, style="Side.TFrame"); title.pack(fill="x", padx=12, pady=(12, 5))
        ttk.Label(title, text="聊天室", style="Side.TLabel").pack(side="left")
        ttk.Button(title, text="＋", width=3, command=self.new_room).pack(side="right")
        self.room_list = tk.Listbox(side, bg="#111827", fg="#aeb8ca", selectbackground="#28344a", selectforeground="white", borderwidth=0, highlightthickness=0, font=("sans", 12), activestyle="none")
        self.room_list.pack(fill="both", expand=True, padx=8); self.room_list.bind("<<ListboxSelect>>", self.select_room)
        profile = ttk.Frame(side, style="Side.TFrame", padding=(12, 10)); profile.pack(fill="x")
        self.avatar_label = tk.Label(profile, text=user["username"][:1].upper(), width=3, height=1,
                                     bg="#635bff", fg="white", font=("sans", 14, "bold"), cursor="hand2")
        self.avatar_label.pack(side="left", padx=(0, 9)); self.avatar_label.bind("<Button-1>", lambda _: self.change_avatar())
        profile_text = ttk.Frame(profile, style="Side.TFrame"); profile_text.pack(side="left", fill="x", expand=True)
        ttk.Label(profile_text, text=user["username"], style="Side.TLabel", font=("sans", 11, "bold")).pack(anchor="w")
        ttk.Label(profile_text, text="● 在线 · 点击头像更换", style="Side.TLabel", foreground="#43c98b", font=("sans", 8)).pack(anchor="w")
        main = ttk.Frame(self); main.pack(side="left", fill="both", expand=True)
        self.room_title = ttk.Label(main, text="# 大厅", font=("sans", 16, "bold"), padding=(20, 16)); self.room_title.pack(fill="x")
        history_wrap = ttk.Frame(main)
        self.history = tk.Text(history_wrap, wrap="word", bg="white", fg="#30394b", borderwidth=0, padx=24, pady=15,
                               state="disabled", font=("sans", 11), spacing2=2, cursor="arrow")
        history_scroll = ttk.Scrollbar(history_wrap, command=self.history.yview)
        self.history.configure(yscrollcommand=history_scroll.set)
        self.history.pack(side="left", fill="both", expand=True); history_scroll.pack(side="right", fill="y")
        self.history.tag_config("name", font=("sans", 11, "bold"), foreground="#3d4760")
        self.history.tag_config("time", font=("sans", 9), foreground="#99a3b5")
        self.history.tag_config("h1", font=("sans", 18, "bold"), spacing1=8, spacing3=5)
        self.history.tag_config("h2", font=("sans", 15, "bold"), spacing1=7, spacing3=4)
        self.history.tag_config("h3", font=("sans", 12, "bold"), spacing1=6, spacing3=3)
        self.history.tag_config("bold", font=("sans", 11, "bold")); self.history.tag_config("italic", font=("sans", 11, "italic"))
        self.history.tag_config("strike", overstrike=True)
        self.history.tag_config("code", font=("monospace", 10), background="#eef0f4")
        self.history.tag_config("codeblock", font=("monospace", 10), foreground="#e6edf7", background="#182132",
                                lmargin1=14, lmargin2=14, rmargin=14, spacing1=6, spacing3=6)
        self.history.tag_config("quote", foreground="#6d7690", background="#f8f8ff", lmargin1=18, lmargin2=18, rmargin=12)
        self.history.tag_config("list", lmargin1=18, lmargin2=32)
        self.history.tag_config("link", foreground="#635bff", underline=True)
        self.history.tag_config("attachment", foreground="#5148ed", background="#f2f1ff", underline=True,
                                lmargin1=14, lmargin2=14, spacing1=5, spacing3=5)
        self.history.tag_config("formula_fallback", font=("serif", 12, "italic"), foreground="#4b5270")
        compose = ttk.Frame(main, padding=(18, 10, 18, 16)); compose.pack(side="bottom", fill="x")
        self.input = tk.Text(compose, height=3, wrap="word", font=("sans", 11), padx=10, pady=8, highlightthickness=1, highlightbackground="#dfe3eb", relief="flat")
        ttk.Button(compose, text="发送 ↑", style="Accent.TButton", command=self.send).pack(side="right", padx=(7, 0), fill="y")
        ttk.Button(compose, text="文件", command=self.send_file).pack(side="right", padx=(9, 0), fill="y")
        self.input.pack(side="left", fill="x", expand=True); self.input.bind("<Return>", self.on_enter)
        self.chat_status = ttk.Label(main, text="", foreground="#778196", padding=(18, 3, 18, 3)); self.chat_status.pack(side="bottom", fill="x")
        history_wrap.pack(fill="both", expand=True)
        self.last_room_poll = time.monotonic()
        self.background("rooms", self.api.rooms)
        if user.get("avatar_updated_at"):
            self.background("avatar_image", self.api.avatar, user["id"], user["avatar_updated_at"])

    def new_room(self):
        name = simpledialog.askstring("新建聊天室", "聊天室名称：", parent=self)
        if name: self.background("created", self.api.create_room, name)

    def select_room(self, _=None):
        selection = self.room_list.curselection()
        if not selection: return
        self.room = self.rooms[selection[0]]; self.last_id = 0
        self.room_title.config(text=f"# {self.room['name']}")
        self.history.config(state="normal"); self.history.delete("1.0", "end"); self.history.config(state="disabled")
        self.message_images.clear()
        self.background("messages", self.api.messages, self.room["id"], 0)

    def on_enter(self, event):
        if event.state & 0x1: return
        self.send(); return "break"

    def send(self):
        content = self.input.get("1.0", "end").strip()
        if content and self.room:
            self.input.delete("1.0", "end"); self.background("sent", self.api.send, self.room["id"], content)

    def send_file(self):
        if not self.room or self.transfer_active: return
        path = filedialog.askopenfilename(title="选择不超过 10 MB 的文件", parent=self)
        if not path: return
        content = self.input.get("1.0", "end").strip(); self.input.delete("1.0", "end")
        self.transfer_active = True
        self.chat_status.config(text=f"正在上传 {Path(path).name}…")
        self.background("sent", self.api.send_file, self.room["id"], path, content)

    def change_avatar(self):
        path = filedialog.askopenfilename(
            title="选择 2 MB 以内的头像",
            filetypes=[("图片", ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif")), ("所有文件", "*")],
            parent=self,
        )
        if path:
            self.chat_status.config(text=f"正在上传头像 {Path(path).name}…")
            self.background("avatar", self.api.upload_avatar, path)

    def _insert_formula(self, source: str, display: bool = False):
        expression = source.strip()
        if not expression:
            return
        if math_to_image is None or FontProperties is None:
            self.history.insert("end", f"${'$' if display else ''}{expression}${'$' if display else ''}", "formula_fallback")
            return
        try:
            output = BytesIO()
            math_to_image(f"${expression}$", output, prop=FontProperties(size=16 if display else 12),
                          dpi=150, format="png", color="#30394b")
            output.seek(0)
            image = Image.open(output).convert("RGBA")
            photo = ImageTk.PhotoImage(image)
            self.message_images.append(photo)
            if display:
                self.history.insert("end", "\n")
            self.history.image_create("end", image=photo, padx=3, pady=4)
            if display:
                self.history.insert("end", "\n")
        except Exception:
            delimiter = "$$" if display else "$"
            self.history.insert("end", f"{delimiter}{expression}{delimiter}", "formula_fallback")

    def _insert_link(self, label: str, url: str):
        self.link_counter += 1
        tag = f"link-{self.link_counter}"
        self.history.insert("end", label, ("link", tag))
        self.history.tag_bind(tag, "<Button-1>", lambda _, target=url: webbrowser.open(target))
        self.history.tag_bind(tag, "<Enter>", lambda _: self.history.config(cursor="hand2"))
        self.history.tag_bind(tag, "<Leave>", lambda _: self.history.config(cursor="arrow"))

    def _insert_inline_markdown(self, text: str, base_tag: str | None = None):
        position = 0
        for match in INLINE_MARKDOWN.finditer(text):
            if match.start() > position:
                self.history.insert("end", text[position:match.start()], base_tag)
            token = match.group(0)
            if token.startswith("`"):
                self.history.insert("end", token[1:-1], "code")
            elif token.startswith(("**", "__")):
                self.history.insert("end", token[2:-2], "bold")
            elif token.startswith("~~"):
                self.history.insert("end", token[2:-2], "strike")
            elif token.startswith("$"):
                self._insert_formula(token[1:-1])
            elif token.startswith("["):
                link = re.fullmatch(r"\[([^]]+)]\((https?://[^\s)]+)\)", token)
                if link:
                    self._insert_link(link.group(1), link.group(2))
                else:
                    self.history.insert("end", token, base_tag)
            else:
                self.history.insert("end", token[1:-1], "italic")
            position = match.end()
        if position < len(text):
            self.history.insert("end", text[position:], base_tag)

    def _insert_markdown_lines(self, source: str):
        for line in source.splitlines(keepends=True):
            text = line.rstrip("\r\n")
            suffix = "\n" if line.endswith(("\n", "\r")) else ""
            heading = re.match(r"^(#{1,3})\s+(.+)$", text)
            bullet = re.match(r"^\s*[-*+]\s+(.+)$", text)
            numbered = re.match(r"^\s*(\d+)\.\s+(.+)$", text)
            if heading:
                self._insert_inline_markdown(heading.group(2), f"h{len(heading.group(1))}")
            elif text.startswith("> "):
                self.history.insert("end", "│ ", "quote")
                self._insert_inline_markdown(text[2:], "quote")
            elif bullet:
                self.history.insert("end", "• ", "list")
                self._insert_inline_markdown(bullet.group(1), "list")
            elif numbered:
                self.history.insert("end", f"{numbered.group(1)}. ", "list")
                self._insert_inline_markdown(numbered.group(2), "list")
            else:
                self._insert_inline_markdown(text)
            if suffix:
                self.history.insert("end", suffix)

    def _insert_markdown(self, source: str):
        position = 0
        for match in BLOCK_MARKDOWN.finditer(source):
            self._insert_markdown_lines(source[position:match.start()])
            if match.group(2) is not None:
                language = match.group(1).strip()
                if language:
                    self.history.insert("end", f"{language}\n", ("codeblock", "time"))
                self.history.insert("end", match.group(2).rstrip("\n") + "\n", "codeblock")
            else:
                self._insert_formula(match.group(3), display=True)
            position = match.end()
        self._insert_markdown_lines(source[position:])

    def _download_attachment(self, message):
        destination = filedialog.asksaveasfilename(
            title="保存附件",
            initialfile=message["attachment_name"],
            parent=self,
        )
        if not destination:
            return
        self.chat_status.config(text=f"正在下载 {message['attachment_name']}…")
        self.background("downloaded", self.api.download, message["attachment_id"], destination)

    def _insert_attachment(self, message):
        size = message.get("attachment_size", 0)
        readable = f"{size / 1024 / 1024:.1f} MB" if size >= 1024 * 1024 else (f"{size / 1024:.1f} KB" if size >= 1024 else f"{size} B")
        tag = f"attachment-{message['id']}-{message['attachment_id']}"
        self.history.insert("end", f"📎  {message['attachment_name']}  ·  {readable}  ·  点击下载\n", ("attachment", tag))
        self.history.tag_bind(tag, "<Button-1>", lambda _, item=message: self._download_attachment(item))
        self.history.tag_bind(tag, "<Enter>", lambda _: self.history.config(cursor="hand2"))
        self.history.tag_bind(tag, "<Leave>", lambda _: self.history.config(cursor="arrow"))

    def _set_avatar(self, data: bytes):
        image = Image.open(BytesIO(data)).convert("RGBA")
        image = ImageOps.fit(image, (40, 40), Image.Resampling.LANCZOS)
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 39, 39), fill=255)
        image.putalpha(mask)
        self.avatar_photo = ImageTk.PhotoImage(image)
        self.avatar_label.config(image=self.avatar_photo, text="", width=40, height=40)

    def insert_message(self, msg):
        self.history.config(state="normal")
        self.history.insert("end", msg["username"] + "  ", "name")
        self.history.insert("end", format_server_time(msg["created_at"]) + "\n", "time")
        if msg.get("content"):
            self._insert_markdown(msg["content"])
            if not msg["content"].endswith("\n"):
                self.history.insert("end", "\n")
        if msg.get("attachment_id"):
            self._insert_attachment(msg)
        self.history.insert("end", "\n")
        self.history.config(state="disabled")
        self.history.see("end")

    def background(self, kind, function, *args):
        def work():
            try: self.events.put((kind, function(*args)))
            except Exception as exc: self.events.put(("error", exc))
        threading.Thread(target=work, daemon=True).start()

    def process_events(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "auth": self.show_chat(value)
                elif kind in ("rooms", "room_refresh", "created"):
                    if kind == "created": self.background("room_refresh", self.api.rooms); continue
                    selected_id = self.room["id"] if self.room else None
                    self.rooms = value; self.room_list.delete(0, "end")
                    for room in value: self.room_list.insert("end", f"#  {room['name']}")
                    selected_index = next((i for i, room in enumerate(value) if room["id"] == selected_id), None)
                    if selected_index is not None:
                        self.room = value[selected_index]; self.room_list.selection_set(selected_index); self.room_list.activate(selected_index)
                    elif value:
                        self.room = None; self.room_list.selection_set(0); self.select_room()
                elif kind == "messages":
                    for msg in value:
                        if msg["id"] > self.last_id: self.insert_message(msg); self.last_id = msg["id"]
                elif kind == "sent":
                    self.transfer_active = False
                    self.chat_status.config(text="文件或消息已发送")
                    if value["id"] > self.last_id: self.insert_message(value); self.last_id = value["id"]
                elif kind == "avatar":
                    self.user = value
                    self.chat_status.config(text="头像已更新")
                    self.background("avatar_image", self.api.avatar, value["id"], value["avatar_updated_at"])
                elif kind == "avatar_image":
                    self._set_avatar(value)
                elif kind == "downloaded":
                    self.chat_status.config(text=f"文件已保存到 {value}")
                elif kind == "error":
                    self.transfer_active = False
                    if hasattr(self, "auth_status") and self.auth_status.winfo_exists(): self.auth_status.config(text=str(value))
                    else:
                        if hasattr(self, "chat_status") and self.chat_status.winfo_exists(): self.chat_status.config(text=str(value))
                        messagebox.showerror("PolyChat", str(value), parent=self)
        except queue.Empty: pass
        if self.running:
            if self.room: self.background("messages", self.api.messages, self.room["id"], self.last_id)
            if hasattr(self, "room_list") and self.room_list.winfo_exists() and time.monotonic() - self.last_room_poll >= 3:
                self.last_room_poll = time.monotonic(); self.background("room_refresh", self.api.rooms)
            self.after(1800, self.process_events)

    def close(self): self.running = False; self.destroy()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PolyChat GUI client")
    parser.add_argument("--server", help="登录页中的初始服务器地址")
    args = parser.parse_args(); PolyChatGUI(args.server).mainloop()
