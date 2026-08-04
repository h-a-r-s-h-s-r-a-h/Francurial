# Francurial

Browser-automation SaaS: submit one task via API (URL + optional proxy/credentials + a
natural-language instruction), and a real Chromium session executes it — with a live,
watchable/controllable view and human handoff on CAPTCHAs.

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
  directly, so callers never need to know pod addressing (`app/controllers/live_controller.py`).
- **Control lock**: every pause/resume (human "take control", CAPTCHA handoff, REST
  `/continue`) flows through a Redis pub/sub channel (`worker/src/services/controlLockService.js`),
  so the agent loop and the live WS server agree on state even across processes.
- **Resume-from-anywhere**: the agent loop re-`perceive()`s the DOM fresh every step
  instead of resuming a cached plan — that's what makes "pick up where the human left
  off" work without any special-cased state machine.
- **Credentials never reach the LLM**: the model calls `type_credential(selector, field)`
  as an opaque action; the real email/password is substituted server-side
  (`worker/src/agent/act.js`). Stored Fernet-encrypted at rest (`CREDENTIALS_ENC_KEY`).

## Run locally

```bash
docker compose up -d --build
curl -X POST http://localhost:8000/v1/tasks \
  -H "Content-Type: application/json" -H "X-API-Key: dev-local-key-change-me" \
  -d '{
    "url": "https://example.com",
    "instruction": "Describe what you see, then finish.",
    "max_steps": 5
  }'
# -> {"task_id": "...", "status": "queued", "live_url": "http://localhost:8000/v1/live/...?token=..."}

curl http://localhost:8000/v1/tasks/{task_id} -H "X-API-Key: dev-local-key-change-me"
curl -X POST http://localhost:8000/v1/tasks/{task_id}/continue -H "X-API-Key: dev-local-key-change-me"
```

Proxy/model resolution: pass `"proxy": {...}` or `"model": "..."` in the request to
override; omit either and it falls back to round-robin from `PROXY` / the `MODEL` value
in `.env`.

A ready-made Postman collection is at `francurial.postman_collection.json` — import it,
set `base_url`/`api_key` in the collection variables, and "Create Task" auto-saves
`task_id` for the other requests.

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

## Known limits (by design, for this MVP)

- Schema is created via `Base.metadata.create_all()` on gateway startup, not Alembic
  migrations — fine for now, replace before this touches a real prod database.
- CAPTCHA auto-solve is a best-effort checkbox click only; wire in a paid 3rd-party
  solver (2Captcha/Anti-Captcha) in `worker/src/services/captchaService.js` behind a
  config flag when you have one.
- Postgres/Redis single-replica manifests are for demoing the full stack in-cluster —
  use managed services for real traffic.
- Reasoning is DOM/accessibility-tree text only (no screenshot sent to the model yet);
  the perceive/reason interface is where you'd add a vision-capable model path.
