# Setup

## 1. Requirements

- [Bun](https://bun.sh) 1.2 or newer, and Git.
- For the Work tab: [Claude Code](https://docs.claude.com/en/docs/claude-code) and/or the [Codex CLI](https://github.com/openai/codex), installed and signed in on the same PC.
- Optional: `ffmpeg` (voice), `yt-dlp` (content research), `pdftotext` (bank statements).

## 2. Install and create the owner

```bash
git clone https://github.com/vedant-aggarwal/agentic-os.git
cd agentic-os
bun install
bun server/admin.ts invite --owner
```

`invite --owner` prints a one-time code. The first account that signs up with it becomes the owner. Later, invite members from the app or with `bun server/admin.ts invite`. Other admin commands: `users`, `signout <email>`, `password <email>`.

## 3. Start the server

The server reads settings from environment variables first, then from `server/config.json` (git-ignored). A minimal `server/config.json`:

```json
{
  "AGENTOS_SRC": "cli/src/agentos.ts",
  "OPENAI_API_KEY": "sk-..."
}
```

Then:

```bash
bun run server
```

It listens on `http://127.0.0.1:8090`. Data goes to `./data` (accounts, jobs, Wyn) and `~/.agentos/agentos.db` (the owner's life data).

Instead of running the CLI from source you can build it once and put it on your PATH:

```bash
cd cli
bun build src/agentos.ts --compile --outfile dist/agentos
```

Then set `AGENTOS_BIN` to that file, or copy it somewhere on your PATH as `agentos`.

## 4. Reach it from your phone

The phone app talks to the server over **https**. Options:

- **Quick test:** `cloudflared tunnel --url http://localhost:8090` prints a temporary `https://….trycloudflare.com` address.
- **Permanent:** a named [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on your own domain, or [Tailscale](https://tailscale.com) (Serve or Funnel).

Open the app, enter that address as the server, then sign up with your invite code. You can change the address later in Settings → Server address.

Local-agent routes (`/api/v1/agent/*`) answer only on the PC itself and never through a tunnel.

## 5. Optional features

| Feature | What to set |
|---|---|
| Voice and transcription | `OPENAI_API_KEY`; `VOICE_PROVIDER`, `OPENAI_TRANSCRIBE_MODEL`, `WYN_TTS_MODEL`, `WYN_VOICE_MODEL` to change models. |
| Sign in with Google | `GOOGLE_CLIENT_ID` (a Google OAuth web client). |
| Google Calendar for Wyn | `WYN_GCAL_CREDS`: path to a Google OAuth desktop-client JSON (default `~/.agentos/google-calendar.json`). |
| Google Tasks sync | `AGENTOS_GOOGLE_CREDS` (default `~/.agentos/google-tasks.json`). |
| WhatsApp | Run the bridge in `scripts/whatsapp/` and set `WA_TRANSPORT`, `WA_OWNER` (your number), `WA_SECRET`, `WA_BRIDGE_URL`; or use the WhatsApp Cloud API with `WA_PHONE_ID`, `WA_TOKEN`, `WA_TEMPLATE`. |
| Wyn's model | `WYN_MODEL`, `WYN_EFFORT`; `OPENROUTER_API_KEY` with `WYN_JEV` for routing through OpenRouter. |
| iPhone push | `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (default `dev.agenticos.app`), `APNS_ENV`. |
| Email capture (forward mail into the Brain) | `CAPTURE_USER`, `CAPTURE_PASSWORD`, `CAPTURE_JMAP`, `CAPTURE_FROM` (allowed senders, comma-separated). |
| Claude Code plugin | Install `plugin/` as a local Claude Code plugin; it finds the server through `WYN_URL` (default `http://127.0.0.1:8090`). |

## All settings

Grouped by what they touch. Defaults are in the code next to each `conf("NAME", default)` call.

- **Server:** `PORT`, `HOST`, `DATA_DIR`, `OWNER_DB`, `OWNER_EVENTS`, `APP_URL`, `MOD_SCHEDULER`, `MOD_DRY_RUN`, `AI_PREFETCH`
- **CLI:** `AGENTOS_SRC`, `AGENTOS_BIN`, `AGENTOS_DB`, `AGENTOS_DATA_DIR`, `AGENTOS_CONTENT_DB`, `AGENTOS_EVENTS`, `AGENTOS_OPERATOR_DATA`, `AGENTOS_GOOGLE_CREDS`, `AGENTOS_GOOGLE_TASKS_API`, `AGENTOS_GOOGLE_TOKEN_URL`
- **Work jobs:** `JOB_DRIVER` (native Claude SDK / Codex app-server by default, or `acp`), `JOB_IDLE_MS`, `CLAUDE_BIN`, `CODEX_BIN`, `CODEX_HOME`, `CODEX_MODEL`, `CODEX_EFFORT`, `ACP_CLAUDE`, `ACP_CODEX`, `WORK_ACTIVITY`
- **Wyn:** `WYN_MODEL`, `WYN_EFFORT`, `WYN_HEARTBEAT`, `WYN_REALTIME`, `WYN_WEB_SEARCH`, `WYN_JEV`, `WYN_JEV_INSTRUCTIONS`, `WYN_BRAIN`, `WYN_CLASS_WORDS`, `WYN_CALL_NAMES`, `WYN_CALL_TURN`, `WYN_URL`, `WYN_AGENT_NAME`, `WYN_AGENT_TOKEN_FILE`, `WYN_OWNER_CODEX_HOME`, `WYN_GCAL_*`
- **Personal context (all optional, neutral defaults):** `OWNER_NAME`, `OWNER_PROFILE`, `CREATOR_PROFILE`, `PLAN_OWNER_RULES`, `PT_RULES`, `KB_ABOUT`
- **Voice:** `OPENAI_API_KEY`, `VOICE_PROVIDER`, `VOICE_SCRIPT`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_URL`, `WYN_TTS_MODEL`, `WYN_VOICE_MODEL`, `WYN_VOICE_EFFORT`, `FFMPEG`
- **Areas:** `BODY_AI_PLAN`, `SCAN_MODEL`, `SCAN_EFFORT`, `CONTENT_POST`, `YTDLP_COOKIES`, `YTDLP_COOKIES_FROM_BROWSER`, `PDFTOTEXT`, `CRM_WRITE`, `STUDIO_BRAIN`, `STUDIO_OS`, `PULSECHAT_API_URL`, `PULSECHAT_API_KEY`, `PULSECHAT_NUMBER_ID`
- **Brain search:** `BRAIN_EMBED`, `BRAIN_EMBED_MODEL`, `OLLAMA_HOST`, `BRAIN_CLI`
- **Messaging:** `WA_*`, `CAPTURE_*`, `APNS_*`, `GOOGLE_CLIENT_ID`

## Building the apps

Both apps bundle `app/` (through `www/`), so run the matching npm script after any change to `app/`.

### Android

Needs Android Studio (for its JDK 21 and the Android SDK).

```bash
npm install
npm run android
cd android
./gradlew assembleRelease
```

On Windows use `gradlew.bat` and set `JAVA_HOME` to Android Studio's `jbr` folder. To sign the release, set `AGENTICOS_KEYSTORE`, `AGENTICOS_KEYSTORE_PASSWORD`, `AGENTICOS_KEY_ALIAS` and `AGENTICOS_KEY_PASSWORD`; without them the build is signed with the debug key. The APK lands in `android/app/build/outputs/apk/release/`.

### iPhone

Needs a Mac with Xcode 26 or newer.

```bash
npm install
npm run ios
ruby scripts/add_targets.rb
open ios/App/App.xcodeproj
```

`add_targets.rb` adds the widgets, share extension and native plugins to the Xcode project. Pick your team under Signing & Capabilities and run on your phone. Set the build setting `AOS_SERVER_URL` if you want a default server address baked in.

The **Release** GitHub workflow (`.github/workflows/release.yml`) does the same on a macOS runner without signing and attaches `AgenticOS-<version>-unsigned.ipa` to the release. Sign that file with your own Apple ID using AltStore or Sideloadly.
