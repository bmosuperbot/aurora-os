#!/usr/bin/env python3
"""
Aurora Pulse Test Harness

Sends owner commands and simulates button clicks via the Pulse WebSocket,
captures kernel_surface responses, and reads OpenClaw session files to
verify model tool-call behavior — all without screenshots.

Usage:
    python scripts/pulse-test-harness.py                      # interactive mode
    python scripts/pulse-test-harness.py run heart-coffee      # run a named flow
    python scripts/pulse-test-harness.py run all               # run all flows
    python scripts/pulse-test-harness.py send "How are sales?" # one-shot command
    python scripts/pulse-test-harness.py action <surfaceId> <actionName> '{"key":"val"}'
    python scripts/pulse-test-harness.py visual                # Playwright visual check
"""

import json, sys, os, re, time, uuid, threading, argparse, textwrap
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import functools
print = functools.partial(print, flush=True)

try:
    import websocket
except ImportError:
    print("Missing dependency: pip install websocket-client")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

WS_URL = os.environ.get("PULSE_WS_URL", "ws://127.0.0.1:28790/aura/surface")
SESSION_DIR = Path(os.environ.get(
    "OPENCLAW_SESSION_DIR",
    os.path.expanduser("~/Documents/openclaw-aura-state/config/agents/main/sessions"),
))
STEP_TIMEOUT = int(os.environ.get("PULSE_STEP_TIMEOUT", "180"))

# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class SurfaceResult:
    surface_id: str = ""
    title: str = ""
    a2ui_messages: list = field(default_factory=list)
    raw: dict = field(default_factory=dict)
    received_at: float = 0.0

    @property
    def components(self) -> list:
        """Extract components from surfaceUpdate-based a2ui messages."""
        out = []
        for msg in self.a2ui_messages:
            su = msg.get("surfaceUpdate", {})
            out.extend(su.get("components", []))
        return out

    @property
    def sections(self) -> list:
        """Normalize components into a section-like list for easy checks."""
        out = []
        for comp in self.components:
            cid = comp.get("id", "")
            c = comp.get("component", {})
            if "Text" in c:
                out.append({"type": "text", "id": cid, "text": c["Text"].get("text", {}).get("literalString", "")})
            elif "MetricGrid" in c:
                out.append({"type": "metrics", "id": cid, "items": c["MetricGrid"].get("metrics", [])})
            elif "DataTable" in c:
                dt = c["DataTable"]
                out.append({"type": "table", "id": cid, "columns": dt.get("columns", []), "rows": dt.get("rows", [])})
            elif "ActionButton" in c:
                ab = c["ActionButton"]
                out.append({
                    "type": "action", "id": cid,
                    "label": ab.get("label", ""),
                    "action_id": ab.get("actionId", ab.get("action_id", "")),
                    "context": ab.get("actionContext", ab.get("context", {})),
                })
            elif "Column" in c:
                pass  # layout container, skip
            elif "Heading" in c:
                out.append({"type": "heading", "id": cid, "text": c["Heading"].get("text", {}).get("literalString", "")})
        return out

    @property
    def actions(self) -> list:
        return [s for s in self.sections if s.get("type") == "action"]

    @property
    def metrics(self) -> list:
        return [s for s in self.sections if s.get("type") == "metrics"]

    @property
    def tables(self) -> list:
        return [s for s in self.sections if s.get("type") == "table"]

    @property
    def texts(self) -> list:
        return [s for s in self.sections if s.get("type") == "text"]

    def action_by_id(self, action_id: str) -> Optional[dict]:
        for a in self.actions:
            if a.get("action_id") == action_id:
                return a
        return None

    def summary(self) -> str:
        lines = [
            f"  Surface: {self.surface_id}",
            f"  Title:   {self.title}",
            f"  A2UI messages: {len(self.a2ui_messages)}",
        ]
        for s in self.sections:
            st = s.get("type", "?")
            if st == "heading":
                lines.append(f"    [heading] {s.get('text', '')}")
            elif st == "text":
                lines.append(f"    [text]    {s.get('text', '')[:80]}...")
            elif st == "metrics":
                items = s.get("items", [])
                labels = ", ".join(f"{i.get('label','')}={i.get('value','')}" for i in items)
                lines.append(f"    [metrics] {labels}")
            elif st == "table":
                cols = [c.get("label", "") for c in s.get("columns", [])]
                rows = len(s.get("rows", []))
                lines.append(f"    [table]   cols={cols} rows={rows}")
            elif st == "action":
                ctx = s.get("context", {})
                lines.append(f"    [action]  \"{s.get('label','')}\" → {s.get('action_id','')} ctx={json.dumps(ctx)}")
        return "\n".join(lines)


@dataclass
class StepResult:
    step_name: str
    input_type: str  # "command" or "action"
    input_text: str
    surface: Optional[SurfaceResult] = None
    session_tool_calls: list = field(default_factory=list)
    session_text_replies: list = field(default_factory=list)
    elapsed_ms: float = 0
    error: str = ""
    passed: bool = False


# ── WebSocket client ──────────────────────────────────────────────────────────

class PulseClient:
    def __init__(self, url=WS_URL):
        self.url = url
        self.ws = None
        self._surfaces: list[SurfaceResult] = []
        self._command_statuses: list[dict] = []
        self._all_messages: list[dict] = []
        self._lock = threading.Lock()
        self._surface_event = threading.Event()
        self._connected = threading.Event()
        self._thread = None

    def connect(self):
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        self._thread = threading.Thread(target=self.ws.run_forever, daemon=True)
        self._thread.start()
        if not self._connected.wait(timeout=10):
            raise ConnectionError(f"Could not connect to {self.url}")
        print(f"[harness] Connected to {self.url}")

    def close(self):
        if self.ws:
            self.ws.close()

    def send_command(self, text: str) -> str:
        cmd_id = f"harness-{uuid.uuid4().hex[:8]}"
        msg = {
            "type": "submit_command",
            "payload": {
                "commandId": cmd_id,
                "text": text,
                "modality": "text",
            },
        }
        self._surface_event.clear()
        self.ws.send(json.dumps(msg))
        return cmd_id

    def send_action(self, surface_id: str, action_name: str,
                    context: Optional[dict] = None, source_component: str = "") -> None:
        msg = {
            "type": "surface_action",
            "payload": {
                "surfaceId": surface_id,
                "actionName": action_name,
            },
        }
        if source_component:
            msg["payload"]["sourceComponentId"] = source_component
        if context:
            msg["payload"]["context"] = context
        self._surface_event.clear()
        self.ws.send(json.dumps(msg))

    def wait_for_surface(self, timeout: int = STEP_TIMEOUT) -> Optional[SurfaceResult]:
        if self._surface_event.wait(timeout=timeout):
            with self._lock:
                return self._surfaces[-1] if self._surfaces else None
        return None

    def clear(self):
        with self._lock:
            self._surfaces.clear()
            self._command_statuses.clear()
            self._all_messages.clear()
        self._surface_event.clear()

    # ── internal ──

    def _on_open(self, ws):
        self._connected.set()

    def _on_message(self, ws, raw):
        try:
            msg = json.loads(raw)
        except Exception:
            return
        with self._lock:
            self._all_messages.append(msg)
        t = msg.get("type", "")
        # Server wraps data under "payload" for most message types
        payload = msg.get("payload", msg)
        if t == "kernel_surface":
            surface = payload if isinstance(payload, dict) else msg
            result = SurfaceResult(
                surface_id=surface.get("surfaceId", ""),
                title=surface.get("title", ""),
                a2ui_messages=surface.get("a2uiMessages", []),
                raw=msg,
                received_at=time.time(),
            )
            with self._lock:
                self._surfaces.append(result)
            self._surface_event.set()
        elif t == "command_status":
            with self._lock:
                self._command_statuses.append(payload)

    def _on_error(self, ws, error):
        print(f"[harness] WS error: {error}")

    def _on_close(self, ws, code, reason):
        self._connected.clear()


# ── Session file reader ───────────────────────────────────────────────────────

def get_pulse_session_id() -> Optional[str]:
    sessions_file = SESSION_DIR / "sessions.json"
    if not sessions_file.exists():
        return None
    with open(sessions_file) as f:
        data = json.load(f)
    entry = data.get("agent:main:pulse")
    return entry.get("sessionId") if entry else None


def read_session_events(session_id: str, after_index: int = 0) -> list[dict]:
    path = SESSION_DIR / f"{session_id}.jsonl"
    if not path.exists():
        return []
    events = []
    with open(path) as f:
        for i, line in enumerate(f):
            if i < after_index:
                continue
            line = line.strip()
            if not line:
                continue
            line = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', line)
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


def extract_tool_calls(events: list[dict]) -> list[dict]:
    """Extract tool calls from session events."""
    calls = []
    for ev in events:
        msg = ev.get("message", {})
        if msg.get("role") != "assistant":
            continue
        for c in msg.get("content", []):
            if c.get("type") == "toolCall":
                calls.append({
                    "name": c.get("name", ""),
                    "arguments": c.get("arguments", {}),
                })
    return calls


def extract_text_replies(events: list[dict]) -> list[str]:
    replies = []
    for ev in events:
        msg = ev.get("message", {})
        if msg.get("role") != "assistant":
            continue
        for c in msg.get("content", []):
            if c.get("type") == "text" and c.get("text", "").strip():
                replies.append(c["text"].strip())
    return replies


# ── Flow definitions ──────────────────────────────────────────────────────────

@dataclass
class FlowStep:
    name: str
    input_type: str  # "command" or "action"
    text: str = ""
    action_id: str = ""
    auto_context: bool = True  # pull context from previous surface's action
    context_override: Optional[dict] = None
    checks: list = field(default_factory=list)  # list of check functions


def check_has_surface(result: StepResult) -> tuple[bool, str]:
    if result.surface:
        return True, "Surface received"
    return False, "No surface received"


def check_tool_called(tool_name: str):
    def _check(result: StepResult) -> tuple[bool, str]:
        names = [tc["name"] for tc in result.session_tool_calls]
        if tool_name in names:
            return True, f"Tool '{tool_name}' was called"
        return False, f"Tool '{tool_name}' not found in calls: {names}"
    return _check


def check_has_actions(result: StepResult) -> tuple[bool, str]:
    if result.surface and result.surface.actions:
        labels = [a.get("label", "") for a in result.surface.actions]
        return True, f"Actions: {labels}"
    return False, "No action buttons in surface"


def check_action_exists(action_id: str):
    def _check(result: StepResult) -> tuple[bool, str]:
        if not result.surface:
            return False, "No surface"
        a = result.surface.action_by_id(action_id)
        if a:
            return True, f"Action '{action_id}' found: \"{a.get('label','')}\""
        ids = [a.get("action_id", "") for a in result.surface.actions]
        return False, f"Action '{action_id}' not found. Available: {ids}"
    return _check


def check_no_empty_context(result: StepResult) -> tuple[bool, str]:
    if not result.surface:
        return False, "No surface"
    for a in result.surface.actions:
        ctx = a.get("context", {})
        if not ctx:
            return False, f"Action '{a.get('action_id','')}' has empty context"
    return True, "All action contexts non-empty"


def check_surface_id(expected: str):
    def _check(result: StepResult) -> tuple[bool, str]:
        if result.surface and result.surface.surface_id == expected:
            return True, f"Surface ID matches: {expected}"
        sid = result.surface.surface_id if result.surface else "none"
        return False, f"Expected surface_id '{expected}', got '{sid}'"
    return _check


def check_has_metrics(result: StepResult) -> tuple[bool, str]:
    if result.surface and result.surface.metrics:
        return True, f"Has {len(result.surface.metrics)} metric section(s)"
    return False, "No metrics sections"


def check_has_text_section(result: StepResult) -> tuple[bool, str]:
    if result.surface and result.surface.texts:
        return True, f"Has {len(result.surface.texts)} text section(s)"
    return False, "No text sections"


# ── Predefined flows ─────────────────────────────────────────────────────────

FLOWS = {}

FLOWS["heart-coffee"] = {
    "name": "Heart Coffee Overdue Collection",
    "description": "4-step flow: inquiry → follow-up draft → edit/revise → confirm send",
    "steps": [
        FlowStep(
            name="Ask about Heart Coffee",
            input_type="command",
            text="What's the situation with Heart Coffee?",
            checks=[
                check_has_surface,
                check_tool_called("read"),
                check_tool_called("aura_surface"),
                check_has_metrics,
                check_has_actions,
                check_no_empty_context,
            ],
        ),
        FlowStep(
            name="Click Follow Up / Send Reminder",
            input_type="action",
            action_id="follow-up|send-reminder|contact-heart|followup|send-draft|contact",
            auto_context=True,
            checks=[
                check_has_surface,
                check_tool_called("aura_surface"),
                check_has_actions,
            ],
        ),
        FlowStep(
            name="Click Edit Draft / Make Firmer",
            input_type="action",
            action_id="edit-draft|revise-firmer|make-firmer|edit|revise",
            auto_context=True,
            checks=[
                check_has_surface,
                check_tool_called("aura_surface"),
            ],
        ),
        FlowStep(
            name="Click Confirm / Send",
            input_type="action",
            action_id="confirm-send|send|confirm|save-changes|approve|send-draft|mark",
            auto_context=True,
            checks=[
                check_has_surface,
                check_tool_called("aura_surface"),
            ],
        ),
    ],
}

FLOWS["kenya-reorder"] = {
    "name": "Kenya AA Reorder Decision",
    "description": "3-step flow: decision → reorder → contact supplier",
    "steps": [
        FlowStep(
            name="Ask about Kenya reorder",
            input_type="command",
            text="Should I reorder Kenya AA beans?",
            checks=[
                check_has_surface,
                check_tool_called("read"),
                check_tool_called("aura_surface"),
                check_has_actions,
            ],
        ),
        FlowStep(
            name="Click Reorder",
            input_type="action",
            action_id="reorder-bean|reorder-kenya|reorder",
            auto_context=True,
            checks=[
                check_has_surface,
                check_tool_called("aura_surface"),
                check_has_actions,
            ],
        ),
        FlowStep(
            name="Click Contact Supplier",
            input_type="action",
            action_id="contact-supplier|contact-cafe|send-message|contact",
            auto_context=True,
            checks=[
                check_has_surface,
                check_tool_called("aura_surface"),
                check_has_text_section,
            ],
        ),
    ],
}

FLOWS["sales-summary"] = {
    "name": "Sales Summary",
    "description": "1-step: ask for sales data",
    "steps": [
        FlowStep(
            name="Ask about sales",
            input_type="command",
            text="How are sales this week?",
            checks=[
                check_has_surface,
                check_tool_called("read"),
                check_tool_called("aura_surface"),
                check_has_metrics,
            ],
        ),
    ],
}

FLOWS["inventory"] = {
    "name": "Inventory Check",
    "description": "1-step: ask which beans are low",
    "steps": [
        FlowStep(
            name="Ask about low inventory",
            input_type="command",
            text="Which beans are running low?",
            checks=[
                check_has_surface,
                check_tool_called("read"),
                check_tool_called("aura_surface"),
            ],
        ),
    ],
}


# ── Flow runner ───────────────────────────────────────────────────────────────

class FlowRunner:
    def __init__(self, client: PulseClient):
        self.client = client
        self.results: list[StepResult] = []
        self.last_surface: Optional[SurfaceResult] = None

    def reset_session(self):
        """Reset the pulse session via docker exec CLI /new command."""
        import subprocess
        print("[harness] Resetting pulse session via CLI ...")
        session_id = get_pulse_session_id()
        if not session_id:
            print("[harness] No pulse session found, skipping reset")
            return
        try:
            result = subprocess.run(
                ["docker", "exec", "aura-pulse-openclaw-gateway-1",
                 "node", "dist/index.js", "agent",
                 "--session-id", session_id,
                 "--message", "/new",
                 "--timeout", "60"],
                timeout=70, capture_output=True, text=True
            )
            if result.returncode == 0:
                print("[harness] Session reset via CLI (/new)")
            else:
                print(f"[harness] Reset returned code {result.returncode}")
                if result.stderr:
                    print(f"  stderr: {result.stderr[:200]}")
        except subprocess.TimeoutExpired:
            print("[harness] CLI reset timed out (continuing anyway)")
        except Exception as e:
            print(f"[harness] Reset error: {e}")
        # Consume any startup surface the reset may have generated
        self.client.clear()
        print("[harness] Waiting for startup surface ...")
        startup = self.client.wait_for_surface(timeout=STEP_TIMEOUT)
        if startup:
            print(f"[harness] Startup surface consumed: {startup.surface_id} — {startup.title}")
            self.last_surface = startup
        else:
            print("[harness] No startup surface (continuing)")
        self.client.clear()
        print("[harness] Session reset complete")

    def find_matching_action(self, action_id_pattern: str) -> Optional[dict]:
        """Find an action button matching any of the pipe-separated patterns.
        Falls back to the first available action if no match found."""
        if not self.last_surface:
            return None
        candidates = action_id_pattern.split("|")
        # Exact / substring match first
        for action in self.last_surface.actions:
            aid = action.get("action_id", "")
            for candidate in candidates:
                if candidate in aid:
                    return action
        # If no match, pick the first action and log a warning
        if self.last_surface.actions:
            first = self.last_surface.actions[0]
            print(f"  [ADAPT] No match for '{action_id_pattern}', using first action: "
                  f"'{first.get('action_id','')}' (\"{first.get('label','')}\")")
            return first
        return None

    def run_step(self, step: FlowStep, step_num: int) -> StepResult:
        session_id = get_pulse_session_id()
        event_count_before = 0
        if session_id:
            events_before = read_session_events(session_id)
            event_count_before = len(events_before)

        print(f"\n{'='*60}")
        print(f"  Step {step_num}: {step.name}")
        print(f"  Type: {step.input_type}")
        start = time.time()

        self.client.clear()

        if step.input_type == "command":
            print(f"  Sending: \"{step.text}\"")
            self.client.send_command(step.text)
        elif step.input_type == "action":
            action = self.find_matching_action(step.action_id)
            if not action:
                result = StepResult(
                    step_name=step.name,
                    input_type=step.input_type,
                    input_text=f"action:{step.action_id}",
                    error=f"No matching action button for '{step.action_id}' in previous surface",
                )
                self.results.append(result)
                return result

            aid = action["action_id"]
            ctx = step.context_override or (action.get("context", {}) if step.auto_context else {})
            surface_id = self.last_surface.surface_id if self.last_surface else ""

            print(f"  Clicking: \"{action.get('label','')}\" (action_id={aid})")
            print(f"  Surface: {surface_id}")
            print(f"  Context: {json.dumps(ctx)}")
            self.client.send_action(surface_id, aid, ctx)

        surface = self.client.wait_for_surface(timeout=STEP_TIMEOUT)
        elapsed = (time.time() - start) * 1000

        # Read session events to check tool calls
        tool_calls = []
        text_replies = []
        if session_id:
            new_events = read_session_events(session_id, after_index=event_count_before)
            tool_calls = extract_tool_calls(new_events)
            text_replies = extract_text_replies(new_events)

        result = StepResult(
            step_name=step.name,
            input_type=step.input_type,
            input_text=step.text if step.input_type == "command" else f"action:{step.action_id}",
            surface=surface,
            session_tool_calls=tool_calls,
            session_text_replies=text_replies,
            elapsed_ms=elapsed,
        )

        if surface:
            self.last_surface = surface

        # Run checks
        all_passed = True
        print(f"\n  Result ({elapsed:.0f}ms):")
        if surface:
            print(surface.summary())
        else:
            print("  [!] No surface received")

        if tool_calls:
            print(f"\n  Tool calls: {[tc['name'] for tc in tool_calls]}")
        if text_replies:
            for tr in text_replies:
                print(f"  Text reply: \"{tr[:100]}{'...' if len(tr) > 100 else ''}\"")

        print(f"\n  Checks:")
        for check_fn in step.checks:
            passed, msg = check_fn(result)
            status = "PASS" if passed else "FAIL"
            print(f"    [{status}] {msg}")
            if not passed:
                all_passed = False

        result.passed = all_passed
        self.results.append(result)
        return result

    def run_flow(self, flow_def: dict, reset=True) -> list[StepResult]:
        print(f"\n{'#'*60}")
        print(f"  Flow: {flow_def['name']}")
        print(f"  {flow_def['description']}")
        print(f"{'#'*60}")

        self.results.clear()
        self.last_surface = None

        if reset:
            self.reset_session()
        time.sleep(1)

        for i, step in enumerate(flow_def["steps"], 1):
            result = self.run_step(step, i)
            if result.error:
                print(f"\n  [ERROR] {result.error}")
                if not self.last_surface or not self.last_surface.actions:
                    print("  No actions available to continue. Stopping flow.")
                    break
                print("  Continuing with available actions...")
            elif not result.surface:
                print("\n  [WARN] No surface — model may have returned text only.")
                print("  Continuing to next step anyway...")

        self.print_summary(flow_def["name"])
        return self.results

    def print_summary(self, flow_name: str):
        print(f"\n{'='*60}")
        print(f"  SUMMARY: {flow_name}")
        print(f"{'='*60}")
        total = len(self.results)
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        errored = sum(1 for r in self.results if r.error)

        for r in self.results:
            status = "PASS" if r.passed else ("ERROR" if r.error else "FAIL")
            print(f"  [{status}] {r.step_name} ({r.elapsed_ms:.0f}ms)")
            if r.error:
                print(f"         {r.error}")

        print(f"\n  Total: {total}  Passed: {passed}  Failed: {failed}  Errors: {errored}")
        print(f"{'='*60}")


# ── Playwright visual check ──────────────────────────────────────────────────

OPENCLAW_CHAT_URL = os.environ.get("OPENCLAW_CHAT_URL", "http://127.0.0.1:28789")
PULSE_URL = os.environ.get("PULSE_URL", "http://localhost:5173")
SCREENSHOT_DIR = Path(os.environ.get("SCREENSHOT_DIR", "test-screenshots"))


class VisualChecker:
    def __init__(self):
        try:
            from playwright.sync_api import sync_playwright
            self._pw_module = sync_playwright
        except ImportError:
            print("Playwright not installed. Run:")
            print("  source aura-pulse/.venv/bin/activate && pip install playwright && playwright install chromium")
            self._pw_module = None
        self._pw = None
        self._browser = None
        self.chat_page = None
        self.pulse_page = None

    def _auto_approve_pairing(self):
        """Auto-approve any pending device pairing requests."""
        import subprocess
        try:
            result = subprocess.run(
                ["docker", "exec", "aura-pulse-openclaw-gateway-1",
                 "node", "dist/index.js", "devices", "list", "--json"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for req in data.get("pending", []):
                    rid = req.get("requestId", "")
                    subprocess.run(
                        ["docker", "exec", "aura-pulse-openclaw-gateway-1",
                         "node", "dist/index.js", "devices", "approve", rid],
                        capture_output=True, timeout=10
                    )
                    print(f"[visual] Auto-approved device {rid[:12]}...")
        except Exception:
            pass

    def start(self):
        if not self._pw_module:
            return False
        self._pw = self._pw_module().start()
        self._browser = self._pw.chromium.launch(headless=True)
        SCREENSHOT_DIR.mkdir(exist_ok=True)

        token = "8245191b363c5dc6411d8749a1ea6de742499adc7ff8fd72"
        self.chat_page = self._browser.new_page(viewport={"width": 1400, "height": 900})
        self.chat_page.goto(f"{OPENCLAW_CHAT_URL}/?token={token}")
        self.chat_page.wait_for_timeout(2000)

        # Click Connect if present
        connect_btn = self.chat_page.query_selector('button:has-text("Connect")')
        if connect_btn:
            connect_btn.click()
            self.chat_page.wait_for_timeout(2000)

        # Auto-approve pairing, then reload to complete handshake
        self._auto_approve_pairing()
        self.chat_page.wait_for_timeout(2000)
        self.chat_page.reload()
        self.chat_page.wait_for_timeout(3000)
        # May need another approval cycle after reload
        connect_btn = self.chat_page.query_selector('button:has-text("Connect")')
        if connect_btn:
            connect_btn.click()
            self.chat_page.wait_for_timeout(2000)
            self._auto_approve_pairing()
            self.chat_page.wait_for_timeout(5000)
        print(f"[visual] Chat page loaded: {OPENCLAW_CHAT_URL}")

        try:
            self.pulse_page = self._browser.new_page(viewport={"width": 1400, "height": 900})
            self.pulse_page.goto(PULSE_URL, timeout=5000)
            self.pulse_page.wait_for_timeout(2000)
            print(f"[visual] Pulse page loaded: {PULSE_URL}")
        except Exception:
            print(f"[visual] Pulse not reachable at {PULSE_URL} (skipping)")
            self.pulse_page = None
        return True

    def stop(self):
        if self._browser:
            self._browser.close()
        if self._pw:
            self._pw.stop()

    def screenshot(self, label: str = "") -> dict:
        ts = time.strftime("%Y%m%d-%H%M%S")
        tag = f"-{label}" if label else ""
        paths = {}

        if self.chat_page:
            p = SCREENSHOT_DIR / f"chat{tag}-{ts}.png"
            self.chat_page.screenshot(path=str(p), full_page=True)
            paths["chat"] = str(p)
            print(f"[visual] Chat screenshot: {p}")

        if self.pulse_page:
            p = SCREENSHOT_DIR / f"pulse{tag}-{ts}.png"
            self.pulse_page.screenshot(path=str(p), full_page=True)
            paths["pulse"] = str(p)
            print(f"[visual] Pulse screenshot: {p}")

        return paths

    def switch_to_pulse_session(self):
        """Switch the chat UI to the 'pulse' session via JS."""
        if not self.chat_page:
            return
        # Force-select via hidden <select> using JS (bypasses visibility check)
        switched = self.chat_page.evaluate("""() => {
            const selects = document.querySelectorAll('select');
            for (const s of selects) {
                for (const o of s.options) {
                    if (o.value && o.value.includes('pulse')) {
                        s.value = o.value;
                        s.dispatchEvent(new Event('change', {bubbles: true}));
                        return true;
                    }
                }
            }
            return false;
        }""")
        if switched:
            self.chat_page.wait_for_timeout(3000)
            print("[visual] Switched to pulse session")
        else:
            print("[visual] Could not find pulse session selector")

    def read_chat_messages(self, last_n: int = 10) -> list[dict]:
        """Read the last N messages from the OpenClaw chat UI."""
        if not self.chat_page:
            return []
        # The chat UI shows messages as blocks with role indicators
        # Try reading all text blocks that look like messages
        messages = []
        # Look for message containers — OpenClaw uses a custom layout
        body_text = self.chat_page.inner_text("body")
        # Find lines that look like messages (after the sidebar/header)
        lines = body_text.split("\n")
        in_chat = False
        current = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if "Message Assistant" in line:
                break
            if any(marker in line for marker in ["You ", "Assistant ", "Tool "]):
                if current:
                    messages.append(current)
                # Detect role from the marker
                if line.startswith("You") or "You " in line:
                    current = {"role": "user", "text": ""}
                elif "Assistant" in line:
                    current = {"role": "assistant", "text": ""}
                elif "Tool" in line:
                    current = {"role": "tool", "text": ""}
                in_chat = True
            elif in_chat and current is not None:
                if current["text"]:
                    current["text"] += " " + line
                else:
                    current["text"] = line
        if current:
            messages.append(current)
        return messages[-last_n:]

    def read_pulse_surfaces(self) -> list[dict]:
        """Read rendered surfaces from Pulse DOM."""
        if not self.pulse_page:
            return []
        surfaces = []
        for selector in ["[data-surface-id]", ".surface-card", ".kernel-surface"]:
            elements = self.pulse_page.query_selector_all(selector)
            if elements:
                for el in elements:
                    sid = el.get_attribute("data-surface-id") or ""
                    text = el.inner_text()[:500]
                    surfaces.append({"surface_id": sid, "text": text})
                break
        return surfaces

    def refresh_pages(self):
        if self.chat_page:
            self.chat_page.reload()
            self.chat_page.wait_for_timeout(2000)
        if self.pulse_page:
            self.pulse_page.reload()
            self.pulse_page.wait_for_timeout(2000)


def run_visual_check():
    vc = VisualChecker()
    if not vc.start():
        return
    try:
        vc.switch_to_pulse_session()
        vc.chat_page.wait_for_timeout(2000)
        paths = vc.screenshot("check")
        messages = vc.read_chat_messages()
        print(f"\n[visual] Chat messages: {len(messages)}")
        for m in messages:
            print(f"  [{m['role']}] {m['text'][:120]}")
        surfaces = vc.read_pulse_surfaces()
        if surfaces:
            print(f"\n[visual] Pulse surfaces in DOM: {len(surfaces)}")
            for s in surfaces:
                print(f"  - {s['surface_id']}: {s['text'][:100]}...")
    finally:
        vc.stop()


# ── Interactive mode ──────────────────────────────────────────────────────────

def interactive(client: PulseClient):
    runner = FlowRunner(client)
    print("\nAurora Pulse Test Harness — Interactive Mode")
    print("Commands:")
    print("  send <text>                     Send an owner command")
    print("  action <actionId>               Click a button from last surface")
    print("  action <surfaceId> <actionId>   Click with explicit surface")
    print("  reset                           Send /new to reset session")
    print("  surface                         Show last surface")
    print("  session                         Show recent session events")
    print("  flows                           List available flows")
    print("  run <flowname>                  Run a flow")
    print("  visual                          Playwright screenshot")
    print("  quit                            Exit")
    print()

    while True:
        try:
            line = input("[harness] > ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            continue

        parts = line.split(None, 1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "quit" or cmd == "exit":
            break
        elif cmd == "send":
            if not arg:
                print("Usage: send <text>")
                continue
            client.clear()
            client.send_command(arg)
            print(f"Command sent. Waiting for surface (up to {STEP_TIMEOUT}s)...")
            s = client.wait_for_surface(timeout=STEP_TIMEOUT)
            if s:
                runner.last_surface = s
                print(s.summary())
            else:
                print("No surface received (timeout).")
        elif cmd == "action":
            action_parts = arg.split()
            if len(action_parts) == 1:
                action = runner.find_matching_action(action_parts[0])
                if not action:
                    print(f"No matching action for '{action_parts[0]}'")
                    if runner.last_surface:
                        print("Available actions:")
                        for a in runner.last_surface.actions:
                            print(f"  {a.get('action_id','')} → \"{a.get('label','')}\"")
                    continue
                sid = runner.last_surface.surface_id if runner.last_surface else ""
                ctx = action.get("context", {})
                client.clear()
                client.send_action(sid, action["action_id"], ctx)
            elif len(action_parts) >= 2:
                sid = action_parts[0]
                aid = action_parts[1]
                ctx = json.loads(action_parts[2]) if len(action_parts) > 2 else {}
                client.clear()
                client.send_action(sid, aid, ctx)
            else:
                print("Usage: action <actionId> or action <surfaceId> <actionId> [context_json]")
                continue
            print(f"Action sent. Waiting for surface (up to {STEP_TIMEOUT}s)...")
            s = client.wait_for_surface(timeout=STEP_TIMEOUT)
            if s:
                runner.last_surface = s
                print(s.summary())
            else:
                print("No surface received (timeout).")
        elif cmd == "reset":
            runner.reset_session()
        elif cmd == "surface":
            if runner.last_surface:
                print(runner.last_surface.summary())
                print("\nFull JSON:")
                print(json.dumps(runner.last_surface.raw, indent=2)[:3000])
            else:
                print("No surface captured yet.")
        elif cmd == "session":
            sid = get_pulse_session_id()
            if not sid:
                print("No pulse session found.")
                continue
            events = read_session_events(sid)
            print(f"Session {sid}: {len(events)} events")
            for ev in events[-6:]:
                msg = ev.get("message", {})
                role = msg.get("role", ev.get("type", "?"))
                content = msg.get("content", [])
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict):
                            if c.get("type") == "text":
                                print(f"  [{role}] {c['text'][:120]}")
                            elif c.get("type") == "toolCall":
                                print(f"  [{role}] TOOL: {c['name']} args={str(c.get('arguments',{}))[:120]}")
        elif cmd == "flows":
            for k, v in FLOWS.items():
                print(f"  {k:20s} {v['name']} — {v['description']}")
        elif cmd == "run":
            if not arg or arg not in FLOWS:
                if arg == "all":
                    for k, flow_def in FLOWS.items():
                        runner.run_flow(flow_def, reset=True)
                else:
                    print(f"Unknown flow '{arg}'. Available: {list(FLOWS.keys())}")
                continue
            runner.run_flow(FLOWS[arg], reset=True)
        elif cmd == "visual":
            run_visual_check()
        else:
            print(f"Unknown command: {cmd}")


# ── CLI entry point ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Aurora Pulse Test Harness")
    sub = parser.add_subparsers(dest="mode")

    sub.add_parser("interactive", help="Interactive mode (default)")

    run_p = sub.add_parser("run", help="Run a named flow")
    run_p.add_argument("flow", help="Flow name or 'all'")
    run_p.add_argument("--no-reset", action="store_true", help="Skip session reset")

    send_p = sub.add_parser("send", help="Send a one-shot command")
    send_p.add_argument("text", help="Command text")

    action_p = sub.add_parser("action", help="Send a surface action")
    action_p.add_argument("surface_id", help="Surface ID")
    action_p.add_argument("action_name", help="Action name")
    action_p.add_argument("context", nargs="?", default="{}", help="JSON context")

    sub.add_parser("visual", help="Playwright visual screenshot")

    args = parser.parse_args()

    if args.mode == "visual":
        run_visual_check()
        return

    client = PulseClient()
    client.connect()

    try:
        if args.mode == "run":
            runner = FlowRunner(client)
            do_reset = not getattr(args, "no_reset", False)
            if args.flow == "all":
                for k, flow_def in FLOWS.items():
                    runner.run_flow(flow_def, reset=do_reset)
            elif args.flow in FLOWS:
                runner.run_flow(FLOWS[args.flow], reset=do_reset)
            else:
                print(f"Unknown flow: {args.flow}. Available: {list(FLOWS.keys())}")
        elif args.mode == "send":
            client.send_command(args.text)
            print(f"Waiting for surface (up to {STEP_TIMEOUT}s)...")
            s = client.wait_for_surface()
            if s:
                print(s.summary())
            else:
                print("No surface received.")
        elif args.mode == "action":
            ctx = json.loads(args.context)
            client.send_action(args.surface_id, args.action_name, ctx)
            print(f"Waiting for surface (up to {STEP_TIMEOUT}s)...")
            s = client.wait_for_surface()
            if s:
                print(s.summary())
            else:
                print("No surface received.")
        else:
            interactive(client)
    finally:
        client.close()


if __name__ == "__main__":
    main()
