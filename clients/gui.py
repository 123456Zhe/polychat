#!/usr/bin/env python3
"""Tkinter desktop client for PolyChat."""
from __future__ import annotations

import argparse
import queue
import re
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from chat_api import ApiError, ChatAPI, load_server, save_server


class PolyChatGUI(tk.Tk):
    def __init__(self, server: str | None = None):
        super().__init__()
        self.title("PolyChat")
        self.geometry("1000x680")
        self.minsize(720, 480)
        self.api = ChatAPI(server or load_server())
        self.events = queue.Queue()
        self.room = None
        self.last_id = 0
        self.last_room_poll = 0
        self.running = True
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
        ttk.Label(side, text=f"●  {user['username']}  在线", style="Side.TLabel", padding=15).pack(fill="x")
        main = ttk.Frame(self); main.pack(side="left", fill="both", expand=True)
        self.room_title = ttk.Label(main, text="# 大厅", font=("sans", 16, "bold"), padding=(20, 16)); self.room_title.pack(fill="x")
        self.history = tk.Text(main, wrap="word", bg="white", fg="#30394b", borderwidth=0, padx=24, pady=15, state="disabled", font=("sans", 11), spacing2=2)
        self.history.pack(fill="both", expand=True)
        self.history.tag_config("name", font=("sans", 11, "bold"), foreground="#3d4760")
        self.history.tag_config("time", font=("sans", 9), foreground="#99a3b5")
        self.history.tag_config("h1", font=("sans", 17, "bold")); self.history.tag_config("h2", font=("sans", 14, "bold"))
        self.history.tag_config("bold", font=("sans", 11, "bold")); self.history.tag_config("italic", font=("sans", 11, "italic"))
        self.history.tag_config("code", font=("monospace", 10), background="#eef0f4"); self.history.tag_config("quote", foreground="#6d7690", lmargin1=18, lmargin2=18)
        compose = ttk.Frame(main, padding=(18, 10, 18, 16)); compose.pack(fill="x")
        self.input = tk.Text(compose, height=3, wrap="word", font=("sans", 11), padx=10, pady=8, highlightthickness=1, highlightbackground="#dfe3eb", relief="flat")
        self.input.pack(side="left", fill="x", expand=True); self.input.bind("<Return>", self.on_enter)
        ttk.Button(compose, text="文件", command=self.send_file).pack(side="left", padx=(9, 0), fill="y")
        ttk.Button(compose, text="发送 ↑", style="Accent.TButton", command=self.send).pack(side="left", padx=(7, 0), fill="y")
        self.last_room_poll = time.monotonic()
        self.background("rooms", self.api.rooms)

    def new_room(self):
        name = simpledialog.askstring("新建聊天室", "聊天室名称：", parent=self)
        if name: self.background("created", self.api.create_room, name)

    def select_room(self, _=None):
        selection = self.room_list.curselection()
        if not selection: return
        self.room = self.rooms[selection[0]]; self.last_id = 0
        self.room_title.config(text=f"# {self.room['name']}")
        self.history.config(state="normal"); self.history.delete("1.0", "end"); self.history.config(state="disabled")
        self.background("messages", self.api.messages, self.room["id"], 0)

    def on_enter(self, event):
        if event.state & 0x1: return
        self.send(); return "break"

    def send(self):
        content = self.input.get("1.0", "end").strip()
        if content and self.room:
            self.input.delete("1.0", "end"); self.background("sent", self.api.send, self.room["id"], content)

    def send_file(self):
        if not self.room: return
        path = filedialog.askopenfilename(title="选择不超过 10 MB 的文件", parent=self)
        if not path: return
        content = self.input.get("1.0", "end").strip(); self.input.delete("1.0", "end")
        self.background("sent", self.api.send_file, self.room["id"], path, content)

    def insert_message(self, msg):
        self.history.config(state="normal")
        self.history.insert("end", msg["username"] + "  ", "name"); self.history.insert("end", msg["created_at"] + "\n", "time")
        for line in msg["content"].splitlines() or [""]:
            tag = None; text = line
            if line.startswith("## "): tag, text = "h2", line[3:]
            elif line.startswith("# "): tag, text = "h1", line[2:]
            elif line.startswith("> "): tag, text = "quote", line[2:]
            parts = re.split(r"(\*\*.*?\*\*|`.*?`|\$\$?.*?\$\$?)", text)
            for part in parts:
                if part.startswith("**") and part.endswith("**"): self.history.insert("end", part[2:-2], "bold")
                elif part.startswith("`") and part.endswith("`"): self.history.insert("end", part[1:-1], "code")
                elif part.startswith("$") and part.endswith("$"): self.history.insert("end", "𝑓 " + part.strip("$"), "italic")
                else: self.history.insert("end", part, tag)
            self.history.insert("end", "\n")
        if msg.get("attachment_id"):
            size = msg.get("attachment_size", 0)
            readable = f"{size / 1024:.1f} KB" if size >= 1024 else f"{size} B"
            self.history.insert("end", f"📎 {msg['attachment_name']} ({readable}) · 文件 ID {msg['attachment_id']}\n", "code")
        self.history.insert("end", "\n"); self.history.config(state="disabled"); self.history.see("end")

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
                    if value["id"] > self.last_id: self.insert_message(value); self.last_id = value["id"]
                elif kind == "error":
                    if hasattr(self, "auth_status") and self.auth_status.winfo_exists(): self.auth_status.config(text=str(value))
                    else: messagebox.showerror("PolyChat", str(value), parent=self)
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
