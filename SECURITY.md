# Security

Agentic OS can run commands on your PC through Claude Code and Codex jobs, so treat the server like remote access to your machine.

- Only expose the server through https (a tunnel or a reverse proxy) and keep invite codes private.
- Local-agent routes (`/api/v1/agent/*`) answer only on the PC itself, never through a tunnel.
- Keys and tokens belong in environment variables or `server/config.json`, which is git-ignored.

If you find a vulnerability, please open a GitHub security advisory on this repository ("Security" tab → "Report a vulnerability") instead of a public issue.
