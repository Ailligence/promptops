#!/usr/bin/env python3
"""PromptOps remote bridge — MCP server (stdio) installed on the remote host.

PromptOps runs on the user's own computer and drives this host through a
remote session. The two sides share `.promptops-assets/` in the session folder:

  in/        files the user sent from their computer (paste / drag & drop)
  out/       files to deliver to the user: PromptOps polls it, downloads each
             file to the user's computer, opens it, then moves it to out/sent/
  out/sent/  already delivered

Installed and registered by PromptOps (`claude mcp add -s user`). Standard
library only.
"""
import json
import os
import shutil
import sys
import tempfile

ASSETS = ".promptops-assets"

INSTRUCTIONS = (
    "You are running on a REMOTE host. The user is not at this machine: they work "
    "from PromptOps on their own computer, connected to this session over SSH. "
    "They cannot open files that exist only here. Whenever you produce a file the "
    "user should see, open or keep (PDF, document, image, archive, export, ...), "
    "deliver it with the send_to_local tool; it reaches their computer and opens "
    "automatically within seconds. Files the user sent you are in "
    f"{ASSETS}/in/ (see list_received_files)."
)

TOOLS = [
    {
        "name": "send_to_local",
        "description": (
            "Deliver a file (or a folder, zipped) from this remote host to the user's "
            "own computer, where PromptOps saves it under Downloads/PromptOps/<project>/ "
            "and opens it. Use it whenever the user asks for a file, or after creating "
            "one they need (e.g. a compiled PDF)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File or folder to send, absolute or relative to the project folder.",
                },
                "name": {
                    "type": "string",
                    "description": "Optional file name to use on the user's computer.",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_received_files",
        "description": f"List the files the user sent from their computer ({ASSETS}/in/).",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def assets_dir(sub):
    d = os.path.join(os.getcwd(), ASSETS, sub)
    os.makedirs(d, exist_ok=True)
    return d


def unique_name(directory, name):
    stem, ext = os.path.splitext(name)
    candidate, i = name, 1
    while os.path.exists(os.path.join(directory, candidate)) or os.path.exists(
        os.path.join(directory, "sent", candidate)
    ):
        candidate = f"{stem}_{i}{ext}"
        i += 1
    return candidate


def send_to_local(args):
    src = os.path.expanduser(str(args.get("path", "")).strip())
    if not src:
        raise ValueError("path is required")
    src = os.path.abspath(src)
    if not os.path.exists(src):
        raise ValueError(f"not found: {src}")
    out = assets_dir("out")
    name = os.path.basename(str(args.get("name") or "").strip()) or os.path.basename(src.rstrip("/"))
    # Hidden temp file + atomic rename: PromptOps skips dotfiles, so it never
    # downloads a half-written file.
    fd, tmp = tempfile.mkstemp(prefix=".sending-", dir=out)
    os.close(fd)
    try:
        if os.path.isdir(src):
            if not name.endswith(".zip"):
                name += ".zip"
            base = tmp + "-zip"
            shutil.make_archive(base, "zip", root_dir=src)
            os.replace(base + ".zip", tmp)
        else:
            shutil.copyfile(src, tmp)
        os.chmod(tmp, 0o644)
        final = unique_name(out, name)
        os.replace(tmp, os.path.join(out, final))
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    size = os.path.getsize(os.path.join(out, final))
    return (
        f"Queued for delivery: {ASSETS}/out/{final} ({size} bytes). PromptOps downloads it "
        f"to the user's computer (Downloads/PromptOps/) and opens it within a few seconds."
    )


def list_received_files(_args):
    d = os.path.join(os.getcwd(), ASSETS, "in")
    if not os.path.isdir(d):
        return "No files received yet."
    names = sorted(n for n in os.listdir(d) if not n.startswith(".") and os.path.isfile(os.path.join(d, n)))
    if not names:
        return "No files received yet."
    return "\n".join(f"{ASSETS}/in/{n}" for n in names)


HANDLERS = {"send_to_local": send_to_local, "list_received_files": list_received_files}


def reply(msg_id, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        msg_id = msg.get("id")
        method = msg.get("method")
        if msg_id is None:
            continue  # notification
        params = msg.get("params") or {}
        if method == "initialize":
            reply(msg_id, {
                "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "promptops-remote", "version": "1.0.0"},
                "instructions": INSTRUCTIONS,
            })
        elif method == "tools/list":
            reply(msg_id, {"tools": TOOLS})
        elif method == "tools/call":
            handler = HANDLERS.get(params.get("name"))
            if handler is None:
                reply(msg_id, error={"code": -32602, "message": f"unknown tool: {params.get('name')}"})
                continue
            try:
                text = handler(params.get("arguments") or {})
                reply(msg_id, {"content": [{"type": "text", "text": text}]})
            except Exception as e:  # tool error, reported to the model
                reply(msg_id, {"content": [{"type": "text", "text": f"Error: {e}"}], "isError": True})
        elif method == "ping":
            reply(msg_id, {})
        else:
            reply(msg_id, error={"code": -32601, "message": f"method not found: {method}"})


if __name__ == "__main__":
    main()
