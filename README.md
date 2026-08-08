<p align="center">
  <img src="public/francurial_logo.png" alt="Francurial" width="220" />
</p>

# Francurial

**Browser-automation-as-a-service.** Submit one task over HTTP — a target URL, an
optional proxy, optional credentials, and a natural-language instruction — and a real,
isolated Chromium session executes it end to end: navigates, logs in, clicks, fills
forms, reads data off the page, and reports back a structured result. Every task gets
a live link so a human can watch it happen in real time, take the keyboard/mouse away
from the agent at any moment, and hand it back — including automatic pausing when the
agent hits a CAPTCHA it can't solve itself.

Repo: [github.com/h-a-r-s-h-s-r-a-h/Francurial](https://github.com/h-a-r-s-h-s-r-a-h/Francurial)
License: [MIT](./LICENSE)

## Demo

<p align="center">
  <video src="public/francurial.mp4" autoplay muted loop playsinline controls width="720">
    Your viewer doesn't support inline video — <a href="public/francurial.mp4">download/open francurial.mp4</a> directly.
  </video>
</p>

> **Note:** GitHub's own README renderer strips the `autoplay` attribute from embedded
> videos (a deliberate platform restriction, not a bug here) — on github.com this plays
> on click instead of automatically. It autoplays as intended everywhere that respects
> the tag: cloned locally and opened in a browser, most IDE Markdown previews, and any
> static-site generator that renders raw HTML.

## What it actually does

```bash
curl -X POST http://localhost:8000/v1/tasks \
  -H "Content-Type: application/json" -H "X-API-Key: dev-local-key-change-me" \
  -d '{
    "url": "https://divineapi.com/",
    "instruction": "go to login page, this is my email harsh@gmail.com and password is 123456789, when login finished, then go to profile details page and fetch my personal info",
    "model": "openai/gpt-5.4",
    "max_steps": 40
  }'
```

returns immediately with a task ID and a live link:

```json
{
  "task_id": "9bac1534-2cd6-4a45-a667-6198d36363b4",
  "status": "queued",
  "live_url": "http://localhost:8000/v1/live/9bac1534-2cd6-4a45-a667-6198d36363b4/view?token=..."
}
```

and polling that task ID gets you the real, extracted answer once it's done:

```bash
curl -X GET http://localhost:8000/v1/tasks/task_id \
  -H "Content-Type: application/json" -H "X-API-Key: dev-local-key-change-me"
```

```json
{
  "status": "completed",
  "result": {
    "data": {
      "personal_info": {
        "first_name": "Harsh", "last_name": ".", "phone": "1234567879",
        "email": "harsh@gmail.com", "joined_on": "Aug 01, 2026",
        "address": "", "city": "", "state": "", "postal_code": ""
      }
    },
    "summary": "Fetched profile details. Personal info visible on the profile page: First Name: Harsh; Last Name: .; Phone: 1234567879; Email: harsh@gmail.com; Address: blank; City: blank; State: blank; Postal Code: blank; Joined on Aug 01, 2026."
  }
}
```

No polling loop of your own required for the human side of it, either — open the
`live_url` in a browser and you'll see the actual session streaming live, with buttons
to take control, release it back, or continue past a CAPTCHA the agent got stuck on.

Real anti-bot challenges are handled the same way: point a task at a Cloudflare- or
reCAPTCHA-protected site and the agent tries to solve it itself first, then pauses in
`waiting_input`/`wait_reason: "captcha"` the moment it can't — a human opens the
`live_url`, solves the challenge, hits **Continue**, and the agent resumes exactly
where it left off (fresh `perceive()`, not a cached plan) rather than losing progress
or timing out silently.

## Feature list

**Task execution**
- One-shot task submission (URL + instruction + optional proxy/credentials/model/webhook/max_steps/timeout) — `POST /v1/tasks`
- Async by design: returns `202` in well under 100ms regardless of how long the browser work takes
- Full task lifecycle tracked in Postgres: `queued → running → waiting_input → running → completed | failed`
- Per-step audit trail (`perceive`/`reason`/`act`/captcha/human-takeover events) queryable per task
- A fresh, isolated Chromium context per task — no session state leaks between tasks

**AI agent loop** (`worker/src/agent/`)
- perceive → reason → act loop: fresh DOM read every step, never a cached plan
- Self-healing selectors: elements are tagged fresh each `perceive()` call, not reused across renders
- Selector provenance enforced **in code**, not just prompted — a selector the model didn't actually get from `perceive()` is rejected before it ever reaches Playwright
- Fact surfacing beyond clickable elements: any short leaf text containing a digit (prices, quotas, counts, dates) is handed to the model directly, so it doesn't need to guess a selector to read something that isn't a link or button
- Escalating retry when a page is caught mid-render (a real page never has zero interactive elements — treated as "still loading," not "nothing here")
- Mechanical loop-breaker: the same action repeated too many times in a row (3 for failures, 4 for successes) aborts the task with a clear reason instead of burning through `max_steps` silently — uses the element's *visible label* for identity when selectors are positional, so it can't be fooled by coincidental selector reuse across different pages
- Bring your own model per request (`"model": "..."`, any OpenRouter ID) or fall back to `MODEL` in `.env`

**Credentials**
- Structured `"credentials": {"email", "password"}` field, kept separate from the instruction text
- The model never sees the actual value — it calls `type_credential(selector, field)` as an opaque action; the real value is substituted server-side
- Falls back to typing a literal value only when it was already in the free-text instruction (nothing new exposed, since the LLM saw it there anyway)
- Encrypted at rest (Fernet, `CREDENTIALS_ENC_KEY`) — redacted in every log and audit entry
- A password's real value is never echoed back into a later `perceive()` call, even though the on-page masking (`•••`) is purely visual at the DOM level

**Proxies**
- Per-request proxy (`"proxy": {"host","port","username","password"}`) or automatic round-robin from the `PROXY` pool in `.env`
- Round-robin index lives in Redis (`INCR`), so it's fair across multiple gateway replicas
- Sticky for the task's full lifetime — never rotated mid-session

**Live view & human-in-the-loop**
- Real-time CDP screencast streamed over WebSocket, proxied through the gateway to whichever worker pod owns the task — callers never need pod addressing
- Signed, expiring link (`GET /v1/live/{task_id}/view?token=...`) — no platform login required to open it
- Take control / release control / continue, from either the browser UI or `POST /v1/tasks/{id}/continue`
- Multiple viewers, single controller — others see a "someone else has control" state
- Live console and network log streaming alongside the video
- CAPTCHA handling: the agent tries to solve it itself first (title-based + DOM-marker detection, checkbox click attempt); on failure it hands off to a human automatically and resumes exactly where it left off once solved

**Reliability**
- Circuit breakers for stuck-action loops (see above)
- Escalating perceive retry for slow-rendering pages
- Webhook delivery HMAC-signed, with retry + backoff, on task completion/failure

**Ops**
- Kubernetes manifests with HPA autoscaling for the worker pool (`k8s/`)
- Prometheus-friendly structured JSON logs with per-stage timing (`perceive`/`detectCaptcha`/`reason`/`act`)
- Postman collection ready to import (`francurial.postman_collection.json`)

## Architecture

```
Postman/API caller
      │  POST /v1/tasks  (202, returns task_id + live_url)
      ▼
gateway (FastAPI)  ──Redis Stream──▶  worker (Node + Playwright)
  │ Postgres: tasks, audit_logs,        │  1 Chromium context per task,
  │   webhook_deliveries                │  proxy held for task's full lifetime
  │ resolves proxy (user or round-      │  perceive → reason (OpenRouter) → act loop
  │   robin .env pool) + model          │  CDP screencast + Input.dispatch* for live view
  │ signs live_url (HMAC, expiring)     │  captcha: agent tries → human handoff → resume
  ▼                                     ▼
 anyone with live_url ──WS (proxied by gateway to the owning worker pod)──▶ live view
```

- **Live view**: gateway's `/v1/live/{task_id}?token=...` WebSocket is a thin proxy —
  it looks up which worker pod owns the task (in Redis) and forwards frames/input
  directly (`app/controllers/live_controller.py`). The actual browser-facing page is
  `/v1/live/{task_id}/view?token=...`, served by the gateway (`app/static/live_view.html`).
- **Control lock**: every pause/resume (human "take control", CAPTCHA handoff, REST
  `/continue`) flows through a Redis pub/sub channel (`worker/src/services/controlLockService.js`),
  so the agent loop and the live WS server agree on state even across processes.
- **Resume-from-anywhere**: the agent loop re-`perceive()`s the DOM fresh every step
  instead of resuming a cached plan — that's what makes "pick up where the human left
  off" work without any special-cased state machine.
- **Credentials never reach the LLM**: the model calls `type_credential(selector, field)`
  as an opaque action; the real email/password is substituted server-side
  (`worker/src/agent/act.js`). Stored Fernet-encrypted at rest (`CREDENTIALS_ENC_KEY`).

## Tech stack

| Layer | Tech |
|---|---|
| Gateway (orchestration/API) | Python, FastAPI, SQLAlchemy, Pydantic |
| Worker (browser control + AI loop) | Node.js, Playwright (Chromium), Express, `ws` |
| Task queue / pub-sub | Redis Streams + pub/sub |
| Durable state | PostgreSQL |
| Reasoning | Any OpenRouter model (per-request override, `.env` default) |
| Containerization | Docker / Docker Compose |
| Orchestration at scale | Kubernetes + HPA |

## Project structure

```
francurial/
├── docker-compose.yml
├── .env                          # PROXY pool, OPENROUTER_KEY, MODEL, secrets, ports
├── francurial.postman_collection.json
├── gateway/                      # FastAPI orchestration layer
│   ├── app/
│   │   ├── main.py
│   │   ├── core/                 # config, security (HMAC, encryption, API-key auth)
│   │   ├── db/                   # SQLAlchemy session/engine
│   │   ├── models/                # Task, AuditLog, WebhookDelivery
│   │   ├── schemas/               # Pydantic request/response models
│   │   ├── routes/                # tasks, live, internal, health
│   │   ├── controllers/           # task/live business logic
│   │   ├── services/              # proxy round-robin, model resolution, queue, webhooks
│   │   └── static/live_view.html  # the actual browser-facing live viewer page
│   └── Dockerfile
├── worker/                        # Node + Playwright browser control
│   └── src/
│       ├── index.js
│       ├── agent/                 # perceive.js, reason.js, act.js, agentLoop.js, actionSchema.js
│       ├── controllers/           # sessionController.js
│       ├── services/              # browserService, captchaService, controlLockService,
│       │                          #   gatewayClient, queueConsumer, redisClient
│       ├── ws/                    # liveServer.js — CDP screencast + input relay
│       └── config/, utils/
└── k8s/                            # namespace, configmap, secret template, deployments, HPA
```

## Getting started

### Prerequisites
- Docker + Docker Compose
- An [OpenRouter](https://openrouter.ai) API key
- (Optional) a proxy pool, if you don't want automated tasks to share your own IP

### Setup

```bash
git clone https://github.com/h-a-r-s-h-s-r-a-h/Francurial.git
cd Francurial
```

Edit `.env` and fill in at minimum:

```bash
OPENROUTER_KEY="sk-or-v1-..."      # your OpenRouter API key
MODEL="openai/gpt-5.4-nano"        # default model when a request doesn't override it
PROXY="host:port:user:pass,host2:port2:user2:pass2"   # optional pool, comma-separated; leave empty to require per-request proxies
API_KEYS="pick-a-real-key-here"    # comma-separated; sent as X-API-Key by callers
LIVE_URL_SECRET="generate-a-random-secret"
WEBHOOK_HMAC_SECRET="generate-a-random-secret"
INTERNAL_SHARED_SECRET="generate-a-random-secret"
CREDENTIALS_ENC_KEY="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
```

Then bring the whole stack up:

```bash
docker compose up -d --build
curl http://localhost:8000/healthz   # -> {"status":"ok"}
```

Submit your first task:

```bash
curl -X POST http://localhost:8000/v1/tasks \
  -H "Content-Type: application/json" -H "X-API-Key: <your API_KEYS value>" \
  -d '{
    "url": "https://example.com",
    "instruction": "Describe what you see, then finish.",
    "max_steps": 5
  }'
```

Open the `live_url` from the response in a browser to watch it run.

A ready-made Postman collection is at `francurial.postman_collection.json` — import it,
set `base_url`/`api_key` in the collection variables, and "Create Task" auto-saves
`task_id` for the other requests.

## API reference

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/tasks` | Submit a task. Returns `202` + `task_id` + `live_url` immediately. |
| `GET` | `/v1/tasks/{task_id}` | Poll status/result — a cheap read of the Postgres row, no live browser touched. |
| `POST` | `/v1/tasks/{task_id}/continue` | Resume a task parked in `waiting_input` (captcha solved / human done taking control). |
| `GET` | `/v1/live/{task_id}/view?token=...` | The browser-facing live viewer page. |
| `WS` | `/v1/live/{task_id}?token=...` | The underlying live transport the viewer page's JS connects to. |
| `GET` | `/healthz` | Liveness check. |

`POST /v1/tasks` body:

```json
{
  "url": "https://example.com",
  "instruction": "natural-language description of the goal",
  "credentials": { "email": "...", "password": "..." },   // optional — kept out of the LLM's context
  "proxy": { "host": "...", "port": 8080, "username": "...", "password": "..." }, // optional — else round-robin from .env
  "model": "openai/gpt-5.4",                                // optional — else MODEL from .env
  "webhook_url": "https://your-server/webhook",             // optional — HMAC-signed POST on completion
  "max_steps": 40,
  "timeout_seconds": 600
}
```

Internal worker↔gateway endpoints (`/internal/tasks/...`) are authenticated with
`INTERNAL_SHARED_SECRET`, not the public API key — they're for the worker to claim
tasks, report status, and append audit entries, and shouldn't be exposed publicly.

## Docker commands

```bash
# --- Start ---
docker compose up -d --build          # build images (if changed) + start everything, detached
docker compose up -d                  # start without rebuilding
docker compose up -d --build worker   # (re)build + start just one service
docker compose up -d --scale worker=4 # run 4 worker replicas locally

# --- Status / logs ---
docker compose ps                     # what's running
docker compose logs -f                # tail logs from all services
docker compose logs -f worker         # tail logs from just one service
docker compose exec gateway bash      # shell into a running container
docker compose exec worker sh

# --- Stop (containers paused, NOT removed — fast to resume) ---
docker compose stop                   # stop all services
docker compose stop worker            # stop just one
docker compose start                  # resume previously-stopped containers
docker compose restart gateway        # stop+start one service

# --- Remove (containers + network deleted; images/volumes kept by default) ---
docker compose down                   # stop + remove containers/network — DB data (volumes) survives

# --- Delete (destructive — irreversible) ---
docker compose down -v                # ...also delete volumes -> WIPES Postgres/Redis data
docker compose down -v --rmi local    # ...also delete the images this project built
docker compose down -v --rmi all      # ...delete ALL images used by this compose file (incl. postgres/redis/playwright base images — re-pulled next time)

# --- System-wide cleanup (affects ALL projects on this machine, not just this one) ---
docker system prune -a --volumes      # nukes every stopped container/unused image/volume on the host — use with care
```

## Kubernetes

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl create secret generic francurial-secrets -n francurial --from-env-file=.env   # real secrets, don't commit k8s/secret.yaml with real values
kubectl apply -f k8s/postgres.yaml -f k8s/redis.yaml -f k8s/gateway-deployment.yaml -f k8s/worker-deployment.yaml -f k8s/worker-hpa.yaml
```

`worker-hpa.yaml` autoscales on CPU/memory (2–30 replicas) — swap for a KEDA
`ScaledObject` on Redis-stream backlog once you're tuning against real load, since
"queue depth" is a more direct signal than CPU for this workload.

## Known limits (by design, for now)

- Schema is created via `Base.metadata.create_all()` on gateway startup, not Alembic
  migrations — fine for now, replace before this touches a real prod database.
- CAPTCHA auto-solve is a best-effort checkbox click / title-detection only; wire in a
  paid 3rd-party solver (2Captcha/Anti-Captcha) in `worker/src/services/captchaService.js`
  behind a config flag when you have one.
- Postgres/Redis single-replica manifests are for demoing the full stack in-cluster —
  use managed services for real traffic.
- Reasoning is DOM/accessibility-tree text only (no screenshot sent to the model yet);
  the perceive/reason interface is where you'd add a vision-capable model path.
- Small/cheap models (e.g. `-nano` tier) are noticeably less reliable at multi-step
  form flows (login, multi-field forms) — the platform's loop-breakers and retries
  keep failures fast and clean, but a stronger model materially improves success rate
  on anything beyond a single-page read.

## License

[MIT](./LICENSE) — see the `LICENSE` file.
