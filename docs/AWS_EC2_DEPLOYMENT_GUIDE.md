# AWS EC2 Production Deployment Guide — CRM Automation Platform

**Author:** Antigravity AI Engineering  
**Date:** September 4, 2026  
**Target Domain:** `https://soft.swaragh.net`  
**Host Architecture:** AWS EC2 `t3.micro` (ap-south-1 Mumbai)  
**Elastic IP:** `13.200.184.209`  

---

## 1. Executive Summary

This document provides a complete technical record and operations manual for the production deployment of the **CRM Automation Platform** on Amazon Web Services (AWS) using an EC2 `t3.micro` instance.

The entire modular application stack—including the React 18 Single-Page Application (SPA), Express.js backend REST API, 13 BullMQ asynchronous worker queues, PostgreSQL 16 database, Redis 7 cache/queue broker, Bull-Board monitoring UI, and an Nginx reverse proxy with automated TLS/SSL encryption—was deployed, configured, optimized for the 1 GiB memory boundary, and verified with live browser automated testing.

---

## 2. Infrastructure & Access Specifications

| Parameter | Value |
|---|---|
| **Public Domain** | [`https://soft.swaragh.net`](https://soft.swaragh.net) |
| **API Base URL** | `https://soft.swaragh.net/api/v1` |
| **Health Check URL** | [`https://soft.swaragh.net/health`](https://soft.swaragh.net/health) |
| **Elastic IP** | `13.200.184.209` |
| **AWS Region / AZ** | `ap-south-1a` (Mumbai) |
| **EC2 Instance ID** | `i-0ba65e2ed49564fd1` |
| **Instance Type** | `t3.micro` (2 vCPUs, 1.0 GiB RAM) |
| **Operating System** | Ubuntu 24.04 LTS (Noble Numbat) |
| **Storage (Root Volume)** | 25 GiB gp3 SSD (`/dev/sda1`) |
| **Security Group** | `demo-deploy-sg` (`sg-009e39f3a3cd06ccb`) |
| **Inbound Ports Open** | `22` (SSH), `80` (HTTP), `443` (HTTPS) |
| **Default Admin Account** | `admin@crm.io` |
| **Default Admin Password** | `Admin@1234` |
| **SSH Key Path (Local)** | `/home/sr-user91/Downloads/pms-shared.pem` |
| **Remote App Directory** | `/home/ubuntu/crm` |

---

## 3. Production Architecture

The platform runs as isolated container services inside a private Docker bridge network (`crm-network`), fronted by an Nginx reverse proxy exposed to ports 80 and 443.

```mermaid
graph TD
    User["Client Browser"] -->|HTTPS (443) / HTTP (80)| Nginx["crm_nginx (Nginx 1.27 Alpine)"]
    Nginx -.->|301 Redirect to HTTPS| Nginx
    
    subgraph "Docker Bridge Network: crm-network"
        Nginx -->|/assets/* & /*| Frontend["crm_frontend (React 18 SPA)"]
        Nginx -->|/api/* & /health| API["crm_api (Node.js 20 Express)"]
        
        API -->|Port 5432| Postgres["crm_postgres (PostgreSQL 16 Alpine)"]
        API -->|Port 6379| Redis["crm_redis (Redis 7 Alpine)"]
        
        Worker["crm_worker (13 BullMQ Queues)"] -->|Port 5432| Postgres
        Worker -->|Port 6379| Redis
        
        BullBoard["crm_bull_board (deadly0/bull-board)"] -->|Port 6379| Redis
    end

    subgraph "Persistent Volumes"
        Postgres --> PV1[("crm_postgres_data")]
        Redis --> PV2[("crm_redis_data")]
        Nginx --> PV3[("/etc/letsencrypt (Certificates)")]
    end
```

---

## 4. Phase-by-Phase Implementation Record

### Phase 1: AWS EC2 Provisioning & Networking
1. **Instance Launch**:
   - Launched an official Canonical Ubuntu 24.04 LTS AMI (`ami-050c78efa486a0196`) on `t3.micro`.
   - Configured root block device mapping: 25 GiB gp3, 3000 IOPS, 125 MB/s throughput, delete on termination enabled.
   - Associated the existing keypair `pms-shared`.
2. **Security Group Setup (`demo-deploy-sg`)**:
   - Inbound Rule 1: TCP Port 22 from `0.0.0.0/0` (SSH administration).
   - Inbound Rule 2: TCP Port 80 from `0.0.0.0/0` (HTTP challenge & redirect).
   - Inbound Rule 3: TCP Port 443 from `0.0.0.0/0` (HTTPS encrypted traffic).
3. **Elastic IP Binding**:
   - Associated Elastic IP `13.200.184.209` (`eipalloc-09f3b018ca93e6ffa`) with instance `i-0ba65e2ed49564fd1` (`eipassoc-0a9cf7a2306711c61`).
   - Verified that the external DNS record `soft.swaragh.net` resolves to `13.200.184.209`.

---

### Phase 2: Operating System Tuning for 1 GiB RAM (`t3.micro`)
Because a standard `t3.micro` instance has only 909 MiB of usable physical RAM, running 7 containers simultaneously (Postgres, Redis, Node API, BullMQ Worker, Frontend Nginx, Reverse Proxy Nginx, Bull Board) exceeds physical memory. Without swap, the Linux kernel OOM (Out Of Memory) killer would terminate containers.

1. **Swapfile Configuration**:
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
2. **Swappiness & Cache Pressure Optimization**:
   ```bash
   sudo sysctl vm.swappiness=10
   sudo sysctl vm.vfs_cache_pressure=50
   echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
   echo 'vm.vfs_cache_pressure=50' | sudo tee -a /etc/sysctl.conf
   ```
3. **Container Runtime Installation**:
   - Installed official Docker Engine (`29.8.0`) and Docker Compose Plugin (`v5.5.1`).
   - Added user `ubuntu` to the `docker` group to permit rootless Docker execution.
   - Installed `certbot` for automated SSL provisioning.

---

### Phase 3: Let's Encrypt SSL Certificate Setup
1. Obtained trusted SSL certificates using Certbot standalone mode:
   ```bash
   sudo certbot certonly --standalone -d soft.swaragh.net --non-interactive --agree-tos -m admin@swaragh.net
   ```
2. Adjusted directory permissions to ensure the Docker Nginx container can read the certificate and private key:
   ```bash
   sudo chmod -R 755 /etc/letsencrypt/live /etc/letsencrypt/archive
   ```
3. Mounted the full `/etc/letsencrypt` directory as read-only (`:ro`) into the Nginx container, preserving symlinks between `live/soft.swaragh.net` and `archive/soft.swaragh.net`.

---

### Phase 4: Application Build & Local Pre-compilation
Building Vite and compiling TypeScript inside a 1 GiB cloud instance exhausts memory and consumes AWS CPU burst credits. To eliminate server load:
1. **Frontend Bug Fixes**:
   - Resolved syntax error in `frontend/src/api/pipelines.ts` (unmatched closure in optimistic mutation helper).
   - Resolved type-guard assertion error in `frontend/src/pages/ScraperConfigPage.tsx` for string group definitions.
2. **Local Multi-Stage Build**:
   - Built production Docker images locally:
     - `crm-api:latest` (Node 20 Alpine, compiled dist, pruned devDependencies)
     - `crm-worker:latest` (Node 20 Alpine with BullMQ workers)
     - `crm-frontend:latest` (Nginx 1.27 Alpine with static Vite production bundle)
3. **Direct Image Streaming**:
   - Streamed compressed Docker layers directly over SSH to the EC2 daemon:
     ```bash
     docker save crm-api:latest crm-worker:latest crm-frontend:latest | gzip -1 | ssh -i pms-shared.pem ubuntu@13.200.184.209 "gunzip | docker load"
     ```

---

### Phase 5: Production Environment & Secrets Generation
On the EC2 server (`/home/ubuntu/crm`), an automated generation script created `.env.prod` with `0600` permissions:
- **Database & Redis**: Generated high-entropy passwords with `secrets.token_hex(16)`.
- **JWT Authentication**: Generated a 2048-bit RS256 RSA private key and public key pair using `openssl genrsa` and formatted with newline escapes for Docker environment compatibility.
- **Data Encryption**: Generated a 64-hex character (256-bit) AES key (`ENCRYPTION_KEY`) for third-party connector credential encryption.
- **Docker Compose Symlink**: Linked `.env -> .env.prod` to ensure automatic variable interpolation in `docker-compose.prod.yml`.

---

### Phase 6: Database Migrations
All 68 append-only database migrations were applied to PostgreSQL 16:
- Executed via `npx node-pg-migrate up -m /migrations`.
- Schema created for: `users`, `leads`, `custom_fields`, `pipelines`, `stages`, `scoring_rules`, `assignments`, `campaigns`, `templates`, `outreach_sequences`, `integrations`, `scraper_configs`, `ai_settings`, `ai_decision_log`, `ai_inbox_items`, `agent_plans`, `landing_pages`, `files`, `newsletter_subscribers`, and indexes.
- Default admin user (`admin@crm.io`) seeded with bcrypt hash (`Admin@1234`).

---

### Phase 7: Edge Nginx Configuration
Configured `/home/ubuntu/crm/nginx/nginx.prod.conf` to serve the application:
1. **HTTP (Port 80)**: Catches ACME challenges for cert renewal and issues a `301 Moved Permanently` to `https://$host$request_uri`.
2. **HTTPS (Port 443)**:
   - Modern TLS protocols: `TLSv1.2 TLSv1.3` with strong ciphers.
   - HTTP/2 enabled (`http2 on;`).
   - Strict Security Headers: HSTS (1 year), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
   - Reverse proxy routes:
     - `/assets/`: Direct proxy to `crm_frontend` with caching and rate-limit bypass to allow modern browsers to load 40+ bundle chunks simultaneously without 503 drops.
     - `/`: Proxy to `crm_frontend` (SPA routing with HTML5 fallback).
     - `/api/`: Proxy to `crm_api` with rate-limiting (`burst=200 nodelay`).
     - `/api/v1/notifications/stream`: Real-time Server-Sent Events (SSE) with `proxy_buffering off` and `proxy_read_timeout 86400s`.
     - `/health`: Health check passthrough directly to `crm_api/health`.

---

## 5. Live Verification Evidence

### Automated Healthcheck
```bash
$ curl -i https://soft.swaragh.net/health
HTTP/2 200 
server: nginx/1.27.5
content-type: application/json; charset=utf-8

{"status":"ok","db":"connected","redis":"connected","uptime":145.33,"timestamp":"2026-09-04T06:17:58.944Z"}
```

### Authentication Test (RS256 JWT Token)
```bash
$ curl -s -X POST https://soft.swaragh.net/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@crm.io","password":"Admin@1234"}'

{"success":true,"data":{"accessToken":"eyJhbGciOiJSUzI1Ni...","user":{"id":"00000000-0000-0000-0000-000000000002","name":"Admin","email":"admin@crm.io","role":"admin"}}}
```

### Static Bundle Verification
- `https://soft.swaragh.net/assets/index-WWLcqgCT.js`: **HTTP/2 200** (362 kB, `public, immutable, max-age=31536000`)
- `https://soft.swaragh.net/assets/index-CkeghUZ8.css`: **HTTP/2 200** (94 kB, `public, immutable, max-age=31536000`)
- `http://soft.swaragh.net`: **HTTP/1.1 301 Moved Permanently** → `https://soft.swaragh.net/`

---

## 6. Live Resource Consumption on `t3.micro`

Recorded under real operating load:

```
               total        used        free      shared  buff/cache   available
Mem:           909Mi       578Mi        69Mi        22Mi       413Mi       331Mi
Swap:          4.0Gi        52Mi       3.9Gi
Load average:  0.01, 0.19, 0.18
```

| Container | Image | Memory Usage | Configured Limit | Status |
|---|---|---|---|---|
| `crm_api` | `crm-api:latest` | 64.9 MiB | 512 MiB | Up (healthy) |
| `crm_worker` | `crm-worker:latest` | 59.2 MiB | 512 MiB | Up |
| `crm_postgres` | `postgres:16-alpine` | 38.5 MiB | 512 MiB | Up (healthy) |
| `crm_bull_board`| `deadly0/bull-board:latest` | 15.7 MiB | 128 MiB | Up |
| `crm_nginx` | `nginx:1.27-alpine` | 5.8 MiB | 128 MiB | Up |
| `crm_redis` | `redis:7-alpine` | 4.5 MiB | 256 MiB | Up (healthy) |
| `crm_frontend` | `crm-frontend:latest` | 3.9 MiB | 256 MiB | Up (healthy) |

**Result:** The stack utilizes only ~578 MiB of physical memory, leaving 331 MiB of free buffer and 3.9 GiB of swap headroom. Load average is 0.01.

---

## 7. Operations & Maintenance Playbook

### Connecting to the Server
```bash
ssh -i /path/to/pms-shared.pem ubuntu@13.200.184.209
cd /home/ubuntu/crm
```

### Inspecting Running Services
```bash
# View container status and health
docker ps

# View live CPU / Memory metrics
docker stats --no-stream
```

### Checking Application Logs
```bash
# View API server logs
docker logs --tail 100 -f crm_api

# View BullMQ background worker logs
docker logs --tail 100 -f crm_worker

# View Nginx access & error logs
docker logs --tail 100 -f crm_nginx

# View Postgres logs
docker logs --tail 50 crm_postgres
```

### Restarting Services
```bash
# Restart entire stack gracefully
docker compose -f docker-compose.prod.yml restart

# Restart a specific service
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml restart worker
docker compose -f docker-compose.prod.yml restart nginx
```

### Database Backups & Restores
```bash
# Create a timestamped database backup
docker exec crm_postgres pg_dump -U crm -d crm_db -F c -b -v -f /tmp/backup_$(date +%Y%m%d_%H%M%S).dump
docker cp crm_postgres:/tmp/backup_*.dump /home/ubuntu/backups/

# Restore from a backup
docker exec -i crm_postgres pg_restore -U crm -d crm_db -v --clean < /home/ubuntu/backups/backup_name.dump
```

### Automated SSL Certificate Renewal
Let's Encrypt certificates expire every 90 days. A cron job ensures seamless auto-renewal:
```bash
# Test renewal
sudo certbot renew --dry-run

# Add cron renewal (runs daily at 3:30 AM, reloads Nginx if renewed)
echo "30 3 * * * root certbot renew --quiet --deploy-hook 'docker exec crm_nginx nginx -s reload'" | sudo tee /etc/cron.d/certbot-renew
```

---

## 8. Deployment File Tree Reference

```
/home/ubuntu/crm/
├── .env -> .env.prod                # Symlink for Docker Compose variable substitution
├── .env.prod                        # Secure production environment variables (mode 0600)
├── docker-compose.prod.yml          # Production multi-container composition
├── migrations/                      # 68 PostgreSQL append-only schema migrations
│   ├── 1750000000000_initial-schema.js
│   └── ... (all 68 migration scripts)
└── nginx/
    └── nginx.prod.conf              # Reverse proxy, SSL, rate limiting, and caching
```

---

## 9. Security Recommendations for Production

1. **Change Default Admin Password**:
   - Log in at [`https://soft.swaragh.net/login`](https://soft.swaragh.net/login) using `admin@crm.io` / `Admin@1234`.
   - Immediately navigate to **Settings → Account** or **Users** and update the password.
2. **Restrict SSH Access**:
   - Currently SSH (port 22) is open to `0.0.0.0/0`. In AWS Console → EC2 → Security Groups (`demo-deploy-sg`), update port 22 inbound source to your specific office/home IP (`My IP`).
3. **OpenAI API Key Configuration**:
   - For Phase 2 AI intelligence features (AI Research, AI Reply classification, Campaign Brain), insert your OpenAI API key either in `.env.prod` (`OPENAI_API_KEY=sk-...`) or directly in the UI under **Settings → AI Settings**.
