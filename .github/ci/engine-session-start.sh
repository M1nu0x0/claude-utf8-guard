#!/usr/bin/env bash
# Starts the real Claude Code with the plugin, without a login, and checks that its SessionStart hook ran: Claude Code
# runs SessionStart hooks before it asks for a login, starts this plugin's exec-form "node" hook with
# CLAUDE_PLUGIN_DATA set, and the hook's background refresh leaves upstream.json in that folder.
# HOME (USERPROFILE on Windows) is a fresh folder, so only this run's files are there.
set -u

root=$(cd "$(dirname "$0")/../.." && pwd)
home=$(mktemp -d)
work=$(mktemp -d)
native() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

out=$(cd "$work" && HOME="$home" USERPROFILE="$(native "$home")" \
  claude -p --plugin-dir "$(native "$root/plugins/utf8-guard")" --max-turns 1 "Reply with just: ok" </dev/null 2>&1 | tail -n 3 | tr '\n' ' ')

# The refresh runs detached after the hook exits; give it the request's own 10-second timeout and a little more.
cache=""
for _ in $(seq 1 30); do
  cache=$(find "$home/.claude/plugins/data" -name upstream.json 2>/dev/null | head -n 1)
  [ -n "$cache" ] && break
  sleep 0.5
done
if [ -z "$cache" ]; then
  echo "::error title=engine SessionStart::no upstream.json under CLAUDE_PLUGIN_DATA, so the SessionStart hook did not run; claude said: $out"
  exit 1
fi
echo "::notice title=engine SessionStart::$(tr '\n' ' ' <"$cache")"

grep -q '"issue": 83033' "$cache" || { echo "::error title=engine SessionStart::upstream.json does not name #83033"; exit 1; }
