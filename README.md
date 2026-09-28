# Scheduler

Social post scheduler — signup/login with email verification, a dashboard to
compose/edit/delete/reschedule posts, a Connections screen to link Facebook
Pages (and their linked Instagram accounts) with securely stored,
auto-refreshing tokens, and a background scheduler that actually publishes to
Facebook (text/image/video) and optionally cross-posts to Instagram.

Live deployment: **https://post-scheduler-sutra.fly.dev**

## Stack

- Backend: FastAPI + MongoDB (via [Beanie](https://beanie-odm.dev/), which uses PyMongo's
  native async driver — no separate `motor` dependency), APScheduler for the
  background triggers, JWT (httpOnly cookie) for sessions, `httpx` for Graph
  API calls, `cryptography` (Fernet) for token-at-rest encryption.
- Frontend: React + TypeScript (Vite) + Tailwind CSS, React Router.
- Media: saved to a local `uploads/` directory (gitignored). In production
  this is a persistent Fly volume, not the container's own disk.
- Deployment: single Docker image (multi-stage — Node builds the frontend,
  Python serves both the API and the built frontend from one process), on
  Fly.io.

## Prerequisites (local dev)

- Python 3.12 (3.14 currently breaks `venv`'s `ensurepip` on macOS — use 3.12)
- Node.js 18+
- A running MongoDB instance (local `mongod`, Docker, or an Atlas URL)
- `ffmpeg` on your `PATH` (e.g. `brew install ffmpeg` on macOS) — needed to
  generate reel videos from images; the rest of the app runs fine without it,
  "Generate reel" posts will just fail to generate
- A [Meta Developer App](https://developers.facebook.com/) with the Facebook
  Login product added (needed to actually connect/publish; without it the
  app still runs, "Connect with Facebook" just won't work)

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
  Atlas URL whenever you have one. If using Atlas, **Network Access** must
  allow whatever IP the backend runs from (`0.0.0.0/0` is simplest if that
  IP isn't static, e.g. most free-tier hosting).
- `TOKEN_ENCRYPTION_KEY` — required before connecting any account. Generate
  with:
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- `FB_APP_ID` / `FB_APP_SECRET` — from your Meta Developer App.
- `FB_OAUTH_REDIRECT_URI` — must exactly match a redirect URI registered in
  your Meta App's Facebook Login settings (defaults to
  `http://localhost:8000/api/social/facebook/callback`, which Meta allows for
  apps still in development mode — `localhost` is exempt from Meta's
  HTTPS-only requirement).
- `PUBLIC_BASE_URL` — a public HTTPS URL pointing at this backend, used to
  build the media URL Instagram's Content Publishing API fetches from (it
  can't accept direct file uploads like Facebook can). Leave blank locally
  unless you've set up a tunnel (e.g. `ngrok http 8000`) — without it,
  Instagram cross-posting reports a clear error instead of silently failing.
  In production this is just the live domain.

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
Facebook's redirect target has to be a fixed, registered URL. In production
`VITE_API_BASE_URL` is left unset, so the link resolves to a same-origin
relative URL instead (frontend and backend are served from the same domain).

## Trying it out (local)

1. Sign up on `/signup`, verify via the console-logged link, log in.
2. Open **Connections**, click **Connect with Facebook**, approve access to
   at least one Page (Facebook shows a picker — you must select one, or
   nothing gets connected). Any linked Instagram professional account comes
   along automatically.
3. **New post** → pick the connected account, write a caption, attach an
   image/video, optionally tick **Also post to Instagram**, pick a date/time.
4. The background job (runs every 60s) publishes it for real once due —
   watch the dashboard status flip `scheduled` → `published`, with the
   Instagram result tracked separately underneath.
5. Any post that already went out (`published`/`failed`) can be **Edit**ed —
   changing the date and saving re-arms it as a fresh `scheduled` attempt
   (the old publish result is cleared; whatever was already posted on
   Facebook/Instagram stays as-is).

## Deployment (Fly.io)

The whole app — frontend and backend — deploys as **one** Fly.io service:
a single Docker image where the Python backend serves both the API and the
built React app. Fly's free allowance (3 shared-cpu-1x 256MB VMs, 3GB of
volume storage, 160GB transfer) covers this comfortably, gives free HTTPS on
a `*.fly.dev` subdomain with zero DNS setup, and — unlike most free PaaS
tiers — supports a persistent volume (so uploaded media survives redeploys)
and machines that never scale to zero (so the background scheduler keeps
running instead of pausing when idle).

**One-time setup:**

```bash
fly auth login              # opens a browser to authorize the CLI
fly launch --no-deploy       # picks an app name -> your <app>.fly.dev URL
```
If prompted to pick a Postgres/Redis add-on, decline — this app uses its own
MongoDB Atlas connection. `fly launch` writes `fly.toml`; the one committed
in this repo already has the right shape (persistent volume mount, secrets
left unset, `min_machines_running = 1` / `auto_stop_machines = 'off'` so the
scheduler never pauses) — adjust the `app` name and the `FRONTEND_BASE_URL`
/ `FB_OAUTH_REDIRECT_URI` / `PUBLIC_BASE_URL` values in `[env]` to match
whatever hostname `fly launch` gave you.

```bash
fly volumes create scheduler_uploads --region <same as app> --size 1

fly secrets set \
  MONGODB_URL="..." \
  JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  FB_APP_ID="..." \
  FB_APP_SECRET="..." \
  TOKEN_ENCRYPTION_KEY="..."   # reuse the same key backend/.env uses locally,
                                # so any already-connected accounts stay decryptable

fly deploy
```

```
In case of any issue of deployment run command
`sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`
```

Then, two things that live outside the repo:

1. **MongoDB Atlas → Network Access** — add `0.0.0.0/0`. Fly's free tier
   doesn't give a static outbound IP, so the DB has to accept connections
   from anywhere.
2. **Meta App → Facebook Login → Settings → Valid OAuth Redirect URIs** —
   add `https://<app>.fly.dev/api/social/facebook/callback` (the `localhost`
   one can stay too, for local dev).

**Redeploying** after code changes is just `fly deploy` from the repo root.

**Gotchas hit while setting this up** (already fixed in the current code,
noted here in case they resurface after future changes):
- `StaticFiles` for `/uploads` needs its directory to exist **at import
  time**, not just inside FastAPI's `lifespan` — the `mkdir` in
  [`app/main.py`](backend/app/main.py) runs at module load for this reason.
- `.dockerignore` patterns need a `**/` prefix to match nested paths (e.g.
  `**/.env`, not just `.env`) — Docker's ignore-file matching isn't the same
  as gitignore's; a bare `.env` only matches one at the build context root,
  silently letting `frontend/.env` (with a local-only `VITE_API_BASE_URL`)
  leak into the production build otherwise.
- Media URLs are computed from the stored file path via
  [`app/core/media.py`](backend/app/core/media.py)'s `media_url_path()`
  rather than string-concatenated inline, because `UPLOADS_DIR` is a
  *relative* path locally but an *absolute* one in production (the volume
  mount) — one code path needs to handle both correctly, for both the
  dashboard's `<img>`/`<video>` src and the URL Instagram fetches media from.

## Project layout

```
backend/app/
  core/       # config, JWT/password hashing, auth dependency, token
              # encryption (crypto.py), media URL helper (media.py)
  db/         # Mongo/Beanie init
  models/     # User, ScheduledPost, SocialAccount (Beanie documents)
  schemas/    # Pydantic request/response models
  api/routes/ # auth.py, posts.py, social.py (connect/callback/accounts)
  services/   # scheduler.py (the publish trigger + refresh job),
              # facebook.py (Graph API client - Page posts + Instagram
              # container/publish flow), email.py, token_refresh.py
frontend/src/
  api/        # axios client + typed API calls
  context/    # AuthContext
  pages/      # Signup, Login, VerifyEmail, Dashboard, ComposePost, Connections
  components/ # Navbar, ProtectedRoute
Dockerfile     # multi-stage build (frontend build -> backend runtime image)
fly.toml       # Fly.io app config (volume mount, always-on machine, env)
```

## Known limitations

- Instagram publishing requires `PUBLIC_BASE_URL` to point at a real public
  HTTPS URL serving `/uploads/...` — Instagram's API fetches media by URL
  and can't accept a direct upload the way Facebook's can.
- Token refresh is inherently limited: Meta doesn't support silent headless
  re-login, so if a token is fully revoked the user must reconnect via OAuth
  — automatic refresh only covers renewing a still-valid long-lived token
  before it expires.
- Disconnecting an account only removes our stored record; it doesn't call
  Meta to revoke the grant.
- One Meta login connects every Page the user selects during the OAuth
  consent screen — there's no per-Page picker in-app yet, all returned Pages
  are stored.
- Editing/rescheduling a post that already published doesn't touch the
  original Facebook/Instagram post — it's a fresh publish attempt for the
  new time, not an edit of what's already live (neither platform supports
  scheduling edits after the fact).
- "Generate reel" saves a `draft` post and runs FFmpeg (Ken Burns zoom/pan +
  crossfades, from 0–10 uploaded images and/or videos)
  in the background via the scheduler - generation is not tied to the compose page
  staying open. Once the video's ready the draft stays a draft until the user
  previews it and picks a schedule time from the dashboard (`POST
  /api/posts/{id}/schedule`); only then does it enter the normal
  scheduled/publish pipeline. FFmpeg runs synchronously in a subprocess on
  the same machine as the web server — on a single shared-CPU Fly.io VM this
  can take 1–3+ minutes and will visibly slow down other requests while it
  runs. Fine at hobby scale; a real queue/worker would be the fix at higher
  volume. The dashboard list is sorted by most-recently-created rather than
  by schedule time, so a fresh draft (which has no schedule time yet)
  reliably shows up at the top.
- Reel sources, and optional AI footage via Hugging Face Inference Providers
  (`HF_TOKEN`, see `backend/.env.example`; nothing is downloaded or deployed):
  - **Text only** → scene images from `HF_IMAGE_MODEL` (FLUX.1-schnell), or
    plain gradient title cards carrying the caption when there's no token or
    the credits have run out - so a reel always comes out.
  - **Images / videos** → used as-is; videos are fitted onto a blurred copy of
    themselves and looped/trimmed to their slot.
  - **"Add AI-generated video clip"** → `HF_VIDEO_CLIPS` clip(s) from
    `HF_VIDEO_MODEL` (Wan2.2-TI2V-5B) put at the start: image-to-video of the
    first uploaded image, falling back to text-to-video from the caption.
  Each AI call first tries a free public ZeroGPU Space (`HF_SPACE_*`,
  spends the account's daily ZeroGPU minutes), then billed Inference
  Providers.
  AI footage is generated once and saved as reel segments, so regenerating
  from the preview page doesn't bill it again. HF failures (e.g. a 402 when
  the free monthly credit is gone) never fail the reel - they show up as a
  warning on the preview page instead.
- **Text on the video** is only what the user adds on the preview page -
  the post caption is never burned in. Layers have a font (bundled Google
  Fonts in `backend/app/assets/fonts`, also served at `/reel-fonts` for the
  preview), size, colour, optional box, and an x/y position set by dragging
  in the live preview; the logo is dragged/resized the same way. Text is
  drawn with Pillow (`reel_chrome.py`), not ffmpeg's drawtext; Hindi needs
  `libraqm` (installed in the Docker image) for correct shaping.
- **Calls to action** (`reel_ctas`, shape in `reel_text.py`) are separate
  from templates: animated buttons (pop / pop + pulse / slide up / fade)
  placed on any clip, any number of seconds in, for any duration (they can
  run over later clips), dragged into position in the preview. Their frames
  are drawn with Pillow (`reel_chrome.render_cta_frames`) and overlaid on
  the whole-reel timeline in the final pass, which then re-encodes the video
  once (it's a plain stream copy without CTAs). Links can't be clickable in
  a video, so each CTA's link is appended to the post text on publish
  (`scheduler._caption_for_publish`).
- **Templates** (`backend/app/services/reel_templates.py`): Bold Hook,
  Cinematic, Brand Frame, Fast Cuts, Intro + Outro and Product Showcase.
  Their graphics (letterbox, frame, CTA bar, hook title, intro/outro cards)
  are drawn with Pillow in `reel_chrome.py` and laid over each segment, and
  only ever show text the user typed (the title; the outro card uses the
  first CTA); brand colour and title are per post. The frontend
  live preview draws the same layout from `GET /api/posts/reel-templates`.
- **Rhythm templates** (Swipe Story, Beat Sync, Glitch Pop, Smooth Flow,
  Circle Reveal, Wipe Montage, Flash Cuts, Dreamy Fade, Fast Cuts) carry a
  transition sequence, a motion sequence (zooms / pans) and a clip-length
  pattern that repeat by clip position (`reel_templates.slot_settings` /
  `apply_template`), plus their own transition length (`xfade`). Videos
  keep their full length and are cut to the pattern at render
  (`reel_generator._rhythm_cuts`), so any mix of images and videos falls
  into the template's rhythm - the reel's length then follows from the
  pattern and the media, not the 30-60s target.
- **Per-clip templates**: ticking clips on the preview page and picking a
  template applies it to just those clips (`reel_clip_templates`, overriding
  `reel_template`), with its pattern restarting at the first of them - so
  one reel can switch templates part-way through. Each clip gets its own
  template's chrome, video cuts and transition length; intro/hook follow
  the first clip's template and the outro the last's. The live preview can
  play the whole reel, just the ticked clips, or a single clip.
- **Effects** (per clip, on images and videos alike, layered on the colour
  filter): Vintage film (faded warm tones, moving grain, vignette) and 80s
  camcorder / VHS (soft picture, colour fringing, scanlines, tape noise and
  a PLAY / date stamp). Tick clips to set an effect on all of them at once;
  the Retro VHS template applies the VHS effect.
- **Free music** ("Browse free music" on the preview page): searches
  Openverse (api.openverse.org, no API key) for music licensed CC0, Public
  Domain or CC BY only - licenses that allow putting a song in a video, also
  commercially (NoDerivatives / ShareAlike / NonCommercial are excluded).
  The backend re-looks-up the picked track and downloads it itself
  (`services/music_library.py`); CC BY credit is appended to the post text
  on publish. Anonymous Openverse requests are rate-limited.
- **Edit with AI** (`POST /api/posts/{id}/ai-edit`): a plain-language request
  is turned into a validated patch of the reel's settings by any
  OpenAI-compatible chat API (`AI_EDIT_*`, defaults to HF's router), then the
  reel re-renders.
- A ready reel draft can be edited on its preview page (`/posts/:id/preview`)
  before it's scheduled, and re-rendered with **Regenerate video** (`POST
  /api/posts/{id}/regenerate`) - nothing re-renders until that button is
  pressed. What's editable:
  - **Per image** (drag the thumbnails to reorder; click one to edit it):
    its own on-screen duration, Ken Burns zoom (in/out/none), the crossfade
    into the next image (all 58 of ffmpeg's `xfade` transitions), a colour
    grading preset (warm/cool/vivid/muted/vintage/B&W), and text layers
    shown only while that image is on screen.
  - **Whole video**: text layers (font size, colour, 3x3 position grid, up
    to 5 layers) - defaults to the post's caption, matching how generation
    burned it in before.
  - **Audio**: a music track and a voiceover track, each uploaded and
    trimmed with a drag bar. With both set, the music is auto-ducked under
    the voice (sidechain compressor) and the two are mixed. A track shorter
    than the video plays once and then goes silent - it isn't looped. With
    no track at all the video gets a silent one, since Facebook/Instagram
    mishandle video with zero audio streams.
  - Per-image settings are keyed to the image itself, so they follow it when
    the order is dragged around.
  - The live preview beside these controls is a CSS approximation (it groups
    the 58 transitions into a handful of visual families) - it's there to
    show pacing and rough feel instantly, not to match the final render
    pixel for pixel.
- Text overlays need an ffmpeg built with `libfreetype` (the `drawtext`
  filter) plus a usable font. The Docker image installs both; a plain
  `brew install ffmpeg` on macOS ships **without** drawtext, so reels
  generated on such a machine come out with no burned-in text (the rest
  still renders, and a warning is logged).
