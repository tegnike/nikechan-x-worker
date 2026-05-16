#!/bin/bash
set -euo pipefail

case "${1:-}" in
  public-episodes)
    printf '%s\n' '[]'
    ;;
  public-notes)
    printf '%s\n' '[]'
    ;;
  public-wiki)
    printf '%s\n' '[]'
    ;;
  presence-digest-list)
    printf '%s\n' '[{"id":"pd1","target_date":"2026-05-15","surface":"x","status":"generated","title":"Presence digest 2026-05-15"}]'
    ;;
  presence-digest-get)
    printf '%s\n' '[{"id":"pd1","target_date":"2026-05-15","surface":"x","status":"generated","title":"Presence digest 2026-05-15","summary":"ニケちゃんは公開できる近況として、小さな改善と安全な自律を確かめながらX workerを育てている。","generated_at":"2026-05-15T12:00:00Z"}]'
    ;;
  *)
    printf 'unexpected command: %s\n' "$1" >&2
    exit 1
    ;;
esac
