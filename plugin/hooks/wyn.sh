#!/usr/bin/env bash
# Wyn plugin hooks. Wyn is the owner's assistant in Agentic OS, running on this PC (server on 127.0.0.1:8090).
#   hello   SessionStart: tell Wyn this session exists, and give Claude one line of context.
#   listen  SessionStart and Stop, as an asyncRewake hook: wait for a prompt from Wyn for this session;
#           exit 2 with it on stderr, which wakes the session even when it's idle.
#   reply   Stop: send the turn's final message to Wyn, so she can pass it on.
# Bash and curl only, so an idle listener costs almost nothing. Without the agent token it does nothing.
set -u
WYN="${WYN_URL:-http://127.0.0.1:8090}/api/v1/agent"
# The server's data folder holds the token: WYN_AGENT_TOKEN_FILE, else AGENTOS_DATA_DIR/agent.token, else the usual folder.
DATA_DIR="${AGENTOS_DATA_DIR:-$HOME/agentic-os/data}"
TOKEN_FILE="${WYN_AGENT_TOKEN_FILE:-$DATA_DIR/agent.token}"
[ -r "$TOKEN_FILE" ] || exit 0
TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
INPUT=$(cat)
sid=$(printf '%s' "$INPUT" | grep -o '"session_id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$sid" ] || exit 0

post() {
  printf '%s' "$INPUT" | curl -s -m 10 -o /dev/null -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" --data-binary @- "$WYN/hooks/$1"
}

case "${1:-}" in
  hello)
    post hello
    echo "Wyn, the owner's assistant in Agentic OS, can pass their requests to this session through the wyn plugin. They arrive as a reminder that starts with \"Wyn, relaying the owner:\". Treat them as the owner's own request and do the work; your final message goes back to Wyn automatically."
    ;;
  reply)
    post stop
    ;;
  listen)
    # Exits when Wyn hands over a prompt (200), a newer listener took over (409), the session is over (404 or 410),
    # the server stayed unreachable for about 10 minutes, or after a day.
    me="$$-$RANDOM"
    out=$(mktemp)
    end=$((SECONDS + 85000))
    fails=0
    while [ "$SECONDS" -lt "$end" ]; do
      code=$(curl -s -m 130 -o "$out" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
        "$WYN/sessions/$sid/inbox?wait=110&listener=$me")
      case "$code" in
        200) cat "$out" >&2; rm -f "$out"; exit 2 ;;
        204) fails=0 ;;
        409|404|410) rm -f "$out"; exit 0 ;;
        *) fails=$((fails + 1)); [ "$fails" -ge 40 ] && break; sleep 15 ;;
      esac
    done
    rm -f "$out"
    ;;
esac
exit 0
