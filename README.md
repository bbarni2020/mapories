# Mapories

A privacy-first shared journal where memories are pinned to places on a map. Your stories stay yours until you're ready to share them.

## Project structure

This is a monorepo split into two main pieces:

- **`web/apps/api/`** — Fastify + Prisma backend that handles authentication, encryption, media storage, and the delayed-reveal logic that keeps posts private until they're unlocked
- **`web/apps/web/`** — React frontend with the map, journals, and the UI that makes all of this actually work

Both live under `web/` because they share a docker-compose setup and general dependencies.

## What you can do with it

- Sign in with Google, no accounts to manage
- Drop journal entries on a map and see them visually
- Mark posts as private — they stay hidden until one month passes (or you're signed in as the author)
- Add photos, encrypt sensitive data, manage who sees what
- Admins get a platform to manage users, roles, and pricing tiers

## Getting started

### 1. Copy the environment file

```bash
cd web
cp .env.example .env
```

### 2. Generate your app data encryption key

```bash
openssl rand -hex 32
```

Paste this into `APP_ENCRYPTION_KEY` in your `.env`.

### 3. (Optional) Set up Google OAuth

If you want one-click login:

```bash
# Get a Client ID from Google Cloud Console, then set:
GOOGLE_CLIENT_ID=your_client_id_here
VITE_GOOGLE_CLIENT_ID=same_client_id_here
```

### 4. Start everything

```bash
docker compose up --build
```

Open `http://localhost:5173` and you're in.

## Tech stack

- **Backend:** Fastify, Prisma, PostgreSQL
- **Frontend:** React, Vite
- **Infrastructure:** Docker Compose
- **Auth:** Google Identity Services, refresh token rotation
- **Security:** CSRF protection, encrypted payloads, rate limiting

## Documentation

For detailed setup, environment variables, and feature breakdown, check out [web/README.md](web/README.md).

## Development

The whole thing runs in Docker. If you're working on the API or frontend:

```bash
# Rebuild and restart
docker compose up --build

# Check logs
docker compose logs -f api
docker compose logs -f web
```

Database migrations happen automatically on startup via Prisma.
