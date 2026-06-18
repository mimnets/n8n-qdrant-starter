"""
browser-api — REST bridge between n8n and the browser-use Agent library.

This service wraps the official ``browser-use`` Agent behind a FastAPI REST API
so n8n workflows can trigger browser automation via HTTP Request nodes.

Design inspired by the ``browser-use/web-ui`` project (Gradio-based UI) —
we use the same underlying ``browser_use.Agent`` / ``browser_use.Browser`` APIs,
exposed through a programmatic REST interface instead of a Gradio frontend.

.. seealso:: https://github.com/browser-use/web-ui
"""

from __future__ import annotations

import json
import logging
import os
from enum import Enum
from typing import Optional

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .agent_service import TaskManager

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("browser-api")

app = FastAPI(
    title="Browser Use Bridge API",
    description="REST API that wraps browser-use Agent for n8n automation",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models (same contract as before)
# ---------------------------------------------------------------------------
class TaskStatus(str, Enum):
    created = "created"
    running = "running"
    finished = "finished"
    stopped = "stopped"
    paused = "paused"
    failed = "failed"
    stopping = "stopping"


class RunTaskRequest(BaseModel):
    task: str = Field(..., description="Natural-language instruction for the browser agent")
    ai_provider: str = Field(
        default_factory=lambda: os.getenv("DEFAULT_AI_PROVIDER", "openai"),
        description="LLM provider: openai, deepseek, anthropic, … (set DEFAULT_AI_PROVIDER in .env to change default)",
    )
    headful: Optional[bool] = Field(None, description="Override headless mode (true = show browser)")
    use_custom_chrome: Optional[bool] = Field(None, description="Use Chrome path from env vars")
    max_steps: int = Field(50, ge=1, le=200, description="Maximum agent steps")
    save_browser_data: bool = Field(False, description="Save browser cookies post-run")


class RunTaskResponse(BaseModel):
    id: str
    status: str
    live_url: str


class TaskStatusResponse(BaseModel):
    status: str
    result: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Custom JSON encoder — handles Enum → string
# ---------------------------------------------------------------------------
class _EnumEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Enum):
            return obj.value
        return super().default(obj)


@app.middleware("http")
async def _enum_serialization_middleware(request: Request, call_next):
    """Ensure Enum values are serialised as strings in JSON responses."""
    response = await call_next(request)
    if response.headers.get("content-type") == "application/json" and hasattr(response, "body"):
        try:
            body = await response.body()
            data = json.loads(body.decode())
            encoded = json.dumps(data, cls=_EnumEncoder)
            response = Response(
                content=encoded,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type="application/json",
            )
        except Exception:
            pass  # best-effort
    return response


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/api/v1/ping")
async def ping():
    """Health check."""
    return {"status": "success", "message": "API is running"}


@app.post("/api/v1/run-task", response_model=RunTaskResponse)
async def run_task(payload: RunTaskRequest):
    """Start a new browser automation task."""
    task_id = TaskManager.create(
        instruction=payload.task,
        ai_provider=payload.ai_provider,
        headful=payload.headful,
        use_custom_chrome=payload.use_custom_chrome,
        max_steps=payload.max_steps,
        save_browser_data=payload.save_browser_data,
    )
    return RunTaskResponse(id=task_id, status="created", live_url=f"/live/{task_id}")


@app.post("/api/v1/run-task-sync")
async def run_task_sync(payload: RunTaskRequest):
    """Start a browser task and block until it finishes — returns the result directly.

    Use this when you need the result immediately without polling.
    Works well from n8n HTTP Request nodes (up to 300s timeout).
    """
    result = await TaskManager.run_sync(
        instruction=payload.task,
        ai_provider=payload.ai_provider,
        headful=payload.headful,
        use_custom_chrome=payload.use_custom_chrome,
        max_steps=payload.max_steps,
        save_browser_data=payload.save_browser_data,
    )
    return result


@app.get("/api/v1/task/{task_id}")
async def get_task(task_id: str):
    """Return full task details (steps, result, error, …)."""
    data = TaskManager.get(task_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return data


@app.get("/api/v1/task/{task_id}/status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """Return just the task status + result / error."""
    data = TaskManager.status(task_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskStatusResponse(**data)


@app.put("/api/v1/stop-task/{task_id}")
async def stop_task(task_id: str):
    """Stop a running or paused task."""
    msg = await TaskManager.stop(task_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": msg}


@app.put("/api/v1/pause-task/{task_id}")
async def pause_task(task_id: str):
    """Pause a running task."""
    msg = await TaskManager.pause(task_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": msg}


@app.put("/api/v1/resume-task/{task_id}")
async def resume_task(task_id: str):
    """Resume a paused task."""
    msg = await TaskManager.resume(task_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": msg}


@app.get("/api/v1/list-tasks")
async def list_tasks():
    """List all tasks with summary fields."""
    task_list = TaskManager.list_tasks()
    return {"tasks": task_list, "total": len(task_list), "page": 1, "per_page": 100}


@app.get("/api/v1/browser-config")
async def browser_config():
    """Return the current browser configuration (read from env vars)."""
    return TaskManager.browser_config()


# ---------------------------------------------------------------------------
# Live view — embeddable HTML page that polls task status
# ---------------------------------------------------------------------------
_LIVE_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Browser Use Task {task_id}</title>
    <style>
        * {{ box-sizing: border-box; }}
        body {{ font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 1200px; margin: 0 auto; }}
        .status {{ padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; font-weight: 600; }}
        .created  {{ background: #f3e5f5; color: #7b1fa2; }}
        .running  {{ background: #e3f2fd; color: #1565c0; }}
        .finished {{ background: #e8f5e9; color: #2e7d32; }}
        .failed   {{ background: #ffebee; color: #c62828; }}
        .paused   {{ background: #fff8e1; color: #f57f17; }}
        .stopped  {{ background: #eeeeee; color: #424242; }}
        .stopping {{ background: #fce4ec; color: #ad1457; }}
        .controls {{ margin-bottom: 20px; }}
        button {{ padding: 8px 20px; margin-right: 10px; border: none; border-radius: 4px;
                  cursor: pointer; font-weight: 600; }}
        #pauseBtn  {{ background: #ff9800; color: #fff; }}
        #resumeBtn {{ background: #4caf50; color: #fff; }}
        #stopBtn   {{ background: #f44336; color: #fff; }}
        pre {{ background: #263238; color: #aed581; padding: 16px; border-radius: 6px;
              overflow-x: auto; white-space: pre-wrap; }}
        .step {{ margin-bottom: 10px; padding: 12px; border: 1px solid #ddd;
                border-radius: 6px; background: #fff; }}
        .step strong {{ color: #333; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Browser Use Task</h1>
        <div id="status" class="status">Loading…</div>

        <div class="controls">
            <button id="pauseBtn"  onclick="action('pause')">⏸️ Pause</button>
            <button id="resumeBtn" onclick="action('resume')">▶️ Resume</button>
            <button id="stopBtn"   onclick="action('stop')">⏹️ Stop</button>
        </div>

        <h2>Result</h2>
        <pre id="result">Loading…</pre>

        <h2>Steps</h2>
        <div id="steps">Loading…</div>
    </div>

    <script>
        const TID = '{task_id}';
        const TERMINAL = ['finished','failed','stopped'];

        async function refresh() {{
            try {{
                const r1 = await fetch('/api/v1/task/' + TID + '/status');
                const s = await r1.json();
                const el = document.getElementById('status');
                el.textContent = 'Status: ' + s.status;
                el.className = 'status ' + s.status;

                if (s.result) document.getElementById('result').textContent = s.result;
                else if (s.error) document.getElementById('result').textContent = 'Error: ' + s.error;

                const r2 = await fetch('/api/v1/task/' + TID);
                const d = await r2.json();
                if (d.steps && d.steps.length) {{
                    document.getElementById('steps').innerHTML = d.steps.map(
                        st => '<div class="step"><strong>Step ' + st.step + '</strong>'
                            + '<p>Next Goal: ' + (st.next_goal || 'N/A') + '</p>'
                            + '<p>Evaluation: ' + (st.evaluation_previous_goal || 'N/A') + '</p></div>'
                    ).join('');
                }} else {{
                    document.getElementById('steps').textContent = 'No steps recorded yet.';
                }}

                if (!TERMINAL.includes(s.status)) setTimeout(refresh, 2000);
            }} catch (e) {{
                console.error(e);
                setTimeout(refresh, 5000);
            }}
        }}

        async function action(verb) {{
            if (verb === 'stop' && !confirm('Really stop this task?')) return;
            try {{
                const r = await fetch('/api/v1/' + verb + '-task/' + TID, {{ method: 'PUT' }});
                const d = await r.json();
                alert(d.message);
            }} catch (e) {{ console.error(e); }}
        }}

        refresh();
        setInterval(refresh, 5000);
    </script>
</body>
</html>"""


@app.get("/live/{task_id}", response_class=HTMLResponse)
async def live_view(task_id: str):
    """Embeddable live view for a task."""
    if TaskManager.get(task_id) is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return HTMLResponse(content=_LIVE_HTML_TEMPLATE.format(task_id=task_id))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
