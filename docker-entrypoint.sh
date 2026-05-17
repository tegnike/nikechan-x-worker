#!/bin/sh
set -eu

HERMES_HOME="${HERMES_HOME:-/home/node/.hermes}"
SKILL_NAMES="${NIKECHAN_X_WORKER_HERMES_SKILLS:-nikechan-x-self-tweet,nikechan-x-trend-context}"

OLD_IFS="$IFS"
IFS=","
for SKILL_NAME in $SKILL_NAMES; do
  IFS="$OLD_IFS"
  SKILL_NAME="$(printf '%s' "$SKILL_NAME" | xargs)"
  if [ -n "$SKILL_NAME" ]; then
    mkdir -p "$HERMES_HOME/skills/$SKILL_NAME"
    if [ ! -f "$HERMES_HOME/skills/$SKILL_NAME/SKILL.md" ] && [ -f "/worker/skills/hermes/$SKILL_NAME/SKILL.md" ]; then
      cp "/worker/skills/hermes/$SKILL_NAME/SKILL.md" "$HERMES_HOME/skills/$SKILL_NAME/SKILL.md"
    fi
  fi
  IFS=","
done
IFS="$OLD_IFS"

cat > "$HERMES_HOME/config.yaml" <<EOF
model:
  default: ${NIKECHAN_X_WORKER_HERMES_MODEL:-gpt-5.4}
  provider: ${NIKECHAN_X_WORKER_HERMES_PROVIDER:-copilot}
agent:
  max_turns: 90
terminal:
  backend: local
  cwd: .
  timeout: 180
memory:
  memory_enabled: true
  user_profile_enabled: true
skills:
  template_vars: true
  guard_agent_created: false
curator:
  enabled: true
  interval_hours: 168
approvals:
  mode: manual
hooks: {}
hooks_auto_accept: false
mcp_servers:
  nikechan-x-worker:
    command: node
    args:
      - /worker/dist/mcp-server.js
    enabled: true
_config_version: 23
EOF

case ",${NIKECHAN_X_WORKER_HERMES_TOOLSETS:-nikechan-x-worker,skills,memory,x_search}," in
  *,x_search,*)
    hermes tools enable x_search >/dev/null 2>&1 || true
    ;;
esac

git config --global --add safe.directory /worker >/dev/null 2>&1 || true
git config --global user.name "${NIKECHAN_X_WORKER_GIT_USER_NAME:-nikechan-x-worker}" >/dev/null 2>&1 || true
git config --global user.email "${NIKECHAN_X_WORKER_GIT_USER_EMAIL:-nikechan-x-worker@example.local}" >/dev/null 2>&1 || true

exec "$@"
