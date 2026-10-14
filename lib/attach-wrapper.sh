#!/bin/bash
# Launcher for CLAUDE_CODE_PROCESS_WRAPPER. Leaving `claude attach` with ← makes
# attach relaunch `claude agents` (CLAUDE_AGENTS_SELECT=<id>); for the roost
# that started this attach we exit instead, so control returns to its list.
#
# Only act for a LIVE roost: if `claude attach` has to boot the daemon, the
# daemon inherits this environment and hands it to every session it spawns.
# A leaked copy must stay inert, so anything that is not our own relaunch
# passes straight through.
if [ -n "$CLAUDE_AGENTS_SELECT" ] && [ -n "$ROOST_PARENT_PID" ] && kill -0 "$ROOST_PARENT_PID" 2>/dev/null; then
  for a in "$@"; do
    if [ "$a" = "agents" ]; then
      [ -n "$ROOST_AGENTS_RETURN" ] && printf '%s\n' "$CLAUDE_AGENTS_SELECT" > "$ROOST_AGENTS_RETURN"
      exit 0
    fi
  done
fi
exec "$@"
