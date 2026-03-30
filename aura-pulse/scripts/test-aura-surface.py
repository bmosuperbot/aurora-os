#!/usr/bin/env python3
"""
Send a Pulse owner command via the Aura websocket and monitor the response.
Watches for kernel_surface messages that indicate a successful render.
"""
import json, sys, time, threading
import websocket

WS_URL = "ws://127.0.0.1:28790/aura/surface"
COMMAND = (
    "Read the aura surface skill at /home/node/.openclaw/workspace/skills/aura-surface-ui/SKILL.md "
    "and then use aura_surface to show me a quick sales summary for last week. "
    "Include a heading, a couple of KPI metric tiles for revenue and orders, "
    "a small orders table with 3 rows, and an inspect button."
)
TIMEOUT = 120

received = []
done = threading.Event()

def on_message(ws, message):
    try:
        msg = json.loads(message)
    except Exception:
        print(f"[raw] {message[:200]}")
        return

    t = msg.get("type", "?")
    received.append(msg)
    ts = time.strftime("%H:%M:%S")

    if t == "command_status":
        status = msg.get("status", "?")
        print(f"[{ts}] command_status: {status} — {msg.get('message', '')}")
    elif t == "kernel_surface":
        surface = msg.get("surface", {})
        sid = surface.get("surfaceId", "?")
        n = len(surface.get("a2uiMessages", []))
        print(f"[{ts}] kernel_surface: surfaceId={sid} messages={n}")
        print(f"[{ts}] FULL PAYLOAD:")
        print(json.dumps(msg, indent=2))
        done.set()
    elif t == "onboarding_status":
        print(f"[{ts}] onboarding_status (skipping)")
    elif t == "connector_request":
        cid = msg.get("card", {}).get("connector_id", "?")
        print(f"[{ts}] connector_request: {cid} (skipping)")
    else:
        preview = json.dumps(msg)[:300]
        print(f"[{ts}] {t}: {preview}")

def on_open(ws):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] Connected to {WS_URL}")
    cmd = json.dumps({
        "type": "submit_command",
        "commandId": f"test-surface-{int(time.time())}",
        "text": COMMAND,
        "modality": "text",
    })
    ws.send(cmd)
    print(f"[{ts}] Command sent, waiting for agent response (up to {TIMEOUT}s)...")

def on_error(ws, error):
    print(f"[error] {error}")

def on_close(ws, close_status_code, close_msg):
    print(f"[closed] code={close_status_code} reason={close_msg}")

ws = websocket.WebSocketApp(
    WS_URL,
    on_open=on_open,
    on_message=on_message,
    on_error=on_error,
    on_close=on_close,
)

wst = threading.Thread(target=ws.run_forever, daemon=True)
wst.start()

if done.wait(timeout=TIMEOUT):
    print("\n=== SUCCESS: kernel_surface received ===")
else:
    print(f"\n=== TIMEOUT after {TIMEOUT}s ===")
    if received:
        print(f"Received {len(received)} messages total. Last:")
        print(json.dumps(received[-1], indent=2)[:2000])
    else:
        print("No messages received at all.")

ws.close()
