# 🛠️ Local Development Setup (Redis in Docker — Everything Else Native)

> **Mode:** Partial Docker
> | Service | How it runs |
> |---|---|
> | **Redis** | Docker container (`docker compose up -d redis`) |
> | **PostgreSQL** | Local system install |
> | **Backend API** | `npm run dev` (ts-node-dev) |
> | **BullMQ Worker** | `npm run worker` (ts-node-dev) |
> | **Frontend** | `npm run dev` (Vite) |

---

## Prerequisites

Install these on your machine before starting:

| Tool | Min Version | Check | Install |
|---|---|---|---|
| Node.js | 20 LTS | `node --version` | [nodejs.org](https://nodejs.org) |
| npm | 9+ | `npm --version` | Comes with Node |
| PostgreSQL | 16 | `psql --version` | `sudo apt install postgresql postgresql-client` |
| Docker | 24+ | `docker --version` | [docs.docker.com](https://docs.docker.com/get-docker/) |
| openssl | any | `openssl version` | `sudo apt install openssl` |

---

## Step 1 — Fix Docker Permissions (one-time setup)

By default your user may not have permission to run Docker commands. Fix this once:

```bash
# Add your user to the docker group
sudo usermod -aG docker $USER

# Apply the group change in your current terminal session
newgrp docker
```

> ⚠️ `newgrp docker` applies the group only to the **current terminal session**.
> For all future terminals to work without `sudo`, **log out and log back in** once after running `usermod`.

Verify Docker works without sudo:
```bash
docker ps
# Should list containers (or empty table) — no permission error
```

---

## Step 2 — Start Redis in Docker

The `redis` service is already defined in `docker-compose.yml`. Start only Redis by name:

```bash
# From the project root
cd /home/sr-user91/Documents/Projects/CRM
docker compose up -d redis
```

> `-d` = detached mode (runs in background, frees your terminal)

Verify it's running and healthy:
```bash
docker compose ps redis
```

Ping check:
```bash
docker compose exec redis redis-cli ping
# Expected: PONG
```

To stop / restart Redis:
```bash
docker compose stop redis    # stop
docker compose start redis   # start again
```

---

## Step 3 — Set Up PostgreSQL Locally

### 3a. Install and start PostgreSQL

```bash
sudo apt install postgresql postgresql-client -y
sudo systemctl start postgresql
sudo systemctl enable postgresql   # auto-start on boot
```

### 3b. Create the database and user

```bash
sudo -u postgres psql
```

Inside the psql shell, run:

```sql
CREATE USER crm WITH PASSWORD 'crm_dev_password';
CREATE DATABASE crm_db OWNER crm;
GRANT ALL PRIVILEGES ON DATABASE crm_db TO crm;
\q
```

### 3c. Verify connection

```bash
psql -U crm -d crm_db -h localhost -c "SELECT 1;"
# Expected: ?column? → 1
```

> **If you get `peer authentication failed`:**
> Edit `/etc/postgresql/16/main/pg_hba.conf` — change the `local` line method from `peer` to `md5`, then:
> ```bash
> sudo systemctl restart postgresql
> ```

---

## Step 4 — Configure Environment Variables

Your `.env` lives at the **project root** (not inside `backend/`).

```bash
cd /home/sr-user91/Documents/Projects/CRM
nano .env
```

### Required values — verify these are filled in:

#### JWT Keys (RS256)

Generate if not already set:
```bash
# Run from project root
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Copy into `.env` (newlines become `\n`):
```bash
JWT_PRIVATE_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.pem)"
JWT_PUBLIC_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' public.pem)"
```

#### Encryption Key

```bash
openssl rand -hex 32
# Copy the output → ENCRYPTION_KEY in .env
```

#### Database & Redis URLs

```env
DATABASE_URL=postgresql://crm:crm_dev_password@localhost:5432/crm_db
REDIS_URL=redis://localhost:6379
```

#### Other values for local dev

| Key | Value |
|---|---|
| `NODE_ENV` | `development` |
| `PORT` | `3000` |
| `CORS_ORIGIN` | `http://localhost:5173` |
| `OPENAI_API_KEY` | Your real key, or leave blank (AI features degrade gracefully) |
| `SENTRY_DSN` | Leave blank for local dev |
| `S3_ENDPOINT` | Leave as-is (file uploads won't work without MinIO, skip for now) |

> `GOOGLE_PLACES_API_KEY`, `YOUTUBE_API_KEY`, `FACEBOOK_ACCESS_TOKEN` are optional — features gracefully skip without them.

---

## Step 5 — Install Dependencies

Run once (or when `package.json` changes):

```bash
# Backend
cd /home/sr-user91/Documents/Projects/CRM/backend
npm install

# Frontend
cd /home/sr-user91/Documents/Projects/CRM/frontend
npm install
```

---

## Step 6 — Run Database Migrations

> **Important:** Always run migrations via `npm run migrate` — not directly as `node-pg-migrate`.
> The binary is a local devDependency inside `backend/node_modules/.bin/`.

```bash
cd /home/sr-user91/Documents/Projects/CRM/backend
npm run migrate
```

Check migration status:
```bash
npm run migrate:status
```

Rollback one migration (if needed):
```bash
npm run migrate:down
```

---

## Step 7 — Start the Backend API

Open **Terminal 1**:

```bash
cd /home/sr-user91/Documents/Projects/CRM/backend
npm run dev
```

Expected output:
```
[ts-node-dev] Starting...
Server running on port 3000
Database pool connected
Redis connected
```

Health check:
```bash
curl http://localhost:3000/health
# Expected: {"success":true,"data":{"db":"ok","redis":"ok"}}
```

---

## Step 8 — Start the BullMQ Worker

Open **Terminal 2**:

```bash
cd /home/sr-user91/Documents/Projects/CRM/backend
npm run worker
```

---

## Step 9 — Start the Frontend

Open **Terminal 3**:

```bash
cd /home/sr-user91/Documents/Projects/CRM/frontend
npm run dev
```

Frontend: **http://localhost:5173**

---

## All Services At a Glance

| Service | How it runs | URL / Port |
|---|---|---|
| Redis | `docker compose up -d redis` | `localhost:6379` |
| PostgreSQL | `sudo systemctl start postgresql` | `localhost:5432` |
| Backend API | Terminal 1 → `npm run dev` | `http://localhost:3000` |
| BullMQ Worker | Terminal 2 → `npm run worker` | (background, no UI) |
| Frontend | Terminal 3 → `npm run dev` | `http://localhost:5173` |

---

## Daily Workflow (After First-Time Setup)

Every day you work on this project:

```bash
# 1. Start Redis (from project root)
cd /home/sr-user91/Documents/Projects/CRM
docker compose up -d redis

# 2. Start PostgreSQL
sudo systemctl start postgresql

# 3. Terminal 1 — Backend API
cd /home/sr-user91/Documents/Projects/CRM/backend && npm run dev

# 4. Terminal 2 — Worker
cd /home/sr-user91/Documents/Projects/CRM/backend && npm run worker

# 5. Terminal 3 — Frontend
cd /home/sr-user91/Documents/Projects/CRM/frontend && npm run dev
```

---

## Useful Commands

```bash
# Check Redis is alive
docker compose exec redis redis-cli ping
# Expected: PONG

# Check PostgreSQL is alive
psql -U crm -d crm_db -h localhost -c "SELECT version();"

# Run migrations
cd backend && npm run migrate

# Rollback one migration
cd backend && npm run migrate:down

# Backend tests
cd backend && npm run test

# Frontend tests
cd frontend && npm run test

# Lint
cd backend && npm run lint
cd frontend && npm run lint
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `permission denied while trying to connect to the Docker daemon` | User not in docker group | `sudo usermod -aG docker $USER` then `newgrp docker` |
| `newgrp: command not found` | Util-linux-extra not installed | `sudo apt install util-linux-extra` |
| `ECONNREFUSED 127.0.0.1:6379` | Redis container not running | `docker compose up -d redis` |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not started | `sudo systemctl start postgresql` |
| `node-pg-migrate: not found` | Called outside npm scripts | Use `npm run migrate` not the binary directly |
| `peer authentication failed` | pg_hba.conf uses `peer` auth | Change `local` to `md5` in pg_hba.conf, restart postgres |
| `JWT malformed` or `invalid signature` | Bad JWT keys in `.env` | Regenerate with openssl (see Step 4) |
| `ts-node-dev not found` | `npm install` not run | `cd backend && npm install` |
| Port 3000 already in use | Another process on 3000 | `sudo lsof -i :3000` → kill the PID |
| Port 5173 already in use | Another Vite server | `sudo lsof -i :5173` → kill the PID |
| CORS error in browser | `CORS_ORIGIN` wrong in `.env` | Set `CORS_ORIGIN=http://localhost:5173` |

---

## Notes

- **`.env` lives at the project root** — the backend `migrate` script uses `--envPath ../.env` to find it from inside `backend/`.
- **Never edit existing migration files** — only append new ones to `migrations/`.
- **MinIO / S3** — not required for basic local dev; CSV import / file upload features will fail without it.
- **OpenAI** — AI personalization gracefully falls back to raw templates when the key is missing or the call fails.
- **Docker group change is permanent** after a logout/login — `newgrp docker` is only needed in the current session the first time.
