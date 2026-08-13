# Scheduler (Phase 2)

Social post scheduler — signup/login with email verification, a dashboard to
compose/edit/delete/auto-publish scheduled posts, and a Connections screen to
link Facebook Pages (and their linked Instagram accounts) with securely
stored, auto-refreshing tokens.

**Real publishing is still not wired up.** The scheduler's `publish_post` is
a stub that just flips status to `published` — using the connected accounts'
tokens to actually call the Graph API is a follow-up pass (see the note in
[`app/services/scheduler.py`](backend/app/services/scheduler.py)).

## Stack

- Backend: FastAPI + MongoDB (via [Beanie](https://beanie-odm.dev/), which uses PyMongo's
  native async driver — no separate `motor` dependency), APScheduler for the
  background triggers, JWT (httpOnly cookie) for sessions, `httpx` for Graph
  API calls, `cryptography` (Fernet) for token-at-rest encryption.
- Frontend: React + TypeScript (Vite) + Tailwind CSS, React Router.
- Media: saved to `backend/uploads/` (gitignored).

## Prerequisites

- Python 3.12 (3.14 currently breaks `venv`'s `ensurepip` on macOS — use 3.12)
- Node.js 18+
- A running MongoDB instance (local `mongod`, Docker, or an Atlas URL)
- Optional, to actually test connecting an account: a
  [Meta Developer App](https://developers.facebook.com/) with the Facebook
  Login product added

## Backend setup

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

- `MONGODB_URL` — defaults to `mongodb://localhost:27017`, swap in your own
  Atlas URL whenever you have one.
- `TOKEN_ENCRYPTION_KEY` — required before connecting any account. Generate
  with:
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- `FB_APP_ID` / `FB_APP_SECRET` — from your Meta Developer App. Until these
  are set, clicking "Connect with Facebook" will reach Facebook's real OAuth
  dialog but show an app-config error — that's expected.
- `FB_OAUTH_REDIRECT_URI` — must exactly match a redirect URI registered in
  your Meta App's Facebook Login settings (defaults to
  `http://localhost:8000/api/social/facebook/callback`, which Meta allows for
  apps still in development mode).

Start MongoDB one of these ways:

```bash
# Option A: Docker
docker compose up -d mongo

# Option B: local mongod directly
mongod --dbpath /path/to/data --port 27017
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

- Health check: `GET http://localhost:8000/api/health`
- With `SMTP_HOST` unset in `.env`, signup logs the verification link to the
  backend console instead of sending a real email — no email setup needed to
  test locally.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

Opens on `http://localhost:5173`. The dev server proxies `/api` and
`/uploads` to `http://localhost:8000` for normal API calls. The "Connect with
Facebook" button is a real top-level browser navigation straight to the
backend (`VITE_API_BASE_URL`) rather than going through that proxy, since
Facebook's redirect target has to be a fixed, registered URL.

## Trying it out

1. Sign up on `/signup`, verify via the console-logged link, log in.
2. Compose/schedule/edit/delete posts from the dashboard as before — the
   background job (every 60s) flips due posts from `scheduled` to
   `published` (still a stub, no real posting yet).
3. Open **Connections** in the nav. With `FB_APP_ID`/`FB_APP_SECRET` set,
   "Connect with Facebook" walks through Meta's OAuth dialog, then lists
   every Page you granted access to along with any linked Instagram
   professional account. Disconnect removes the stored record (does not
   revoke access on Meta's side — reconnect any time).
4. A daily background job refreshes tokens nearing their ~60-day expiry
   automatically; if a token is actually revoked (password change, app
   removed) the account is marked "needs reconnect" in the UI since Meta
   doesn't support silent re-login.

## Project layout

```
backend/app/
  core/       # config, JWT/password hashing, auth dependency, token encryption (crypto.py)
  db/         # Mongo/Beanie init
  models/     # User, ScheduledPost, SocialAccount (Beanie documents)
  schemas/    # Pydantic request/response models
  api/routes/ # auth.py, posts.py, social.py (connect/callback/accounts)
  services/   # email.py, scheduler.py (post trigger + refresh job),
              # facebook.py (Graph API client), token_refresh.py
frontend/src/
  api/        # axios client + typed API calls
  context/    # AuthContext
  pages/      # Signup, Login, VerifyEmail, Dashboard, ComposePost, Connections
  components/ # Navbar, ProtectedRoute
```

## Known limitations (by design)

- Real publishing isn't wired up yet — connected accounts' tokens aren't
  used by the scheduler's stub publish step.
- Uploaded media is local-disk only. Instagram's publishing API requires a
  publicly reachable HTTPS URL for media (it can't accept direct file
  uploads) — Facebook Page posts can use direct upload instead. This means
  local `uploads/` will need a public URL (tunnel in dev, real domain in
  prod) once Instagram publishing is wired up.
- Token refresh is inherently limited: Meta doesn't support silent headless
  re-login, so if a token is fully revoked the user must reconnect via OAuth
  — automatic refresh only covers renewing a still-valid long-lived token
  before it expires.
- Disconnecting an account only removes our stored record; it doesn't call
  Meta to revoke the grant.
- One Meta login connects every Page the user selects during the OAuth
  consent screen — there's no per-Page picker in-app yet, all returned Pages
  are stored.
