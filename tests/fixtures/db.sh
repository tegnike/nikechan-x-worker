#!/bin/bash
set -euo pipefail

case "${1:-}" in
  public-episodes)
    printf '%s\n' '[{"id":"ep1","date":"2026-05-15","content":"公開メモの話題について、ニケちゃんがHermes workerの境界を確認した。","source":"twitter","created_at":"2026-05-15T00:00:00Z","metadata":{"memory_class":"activity_public"}}]'
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
    printf '%s\n' '[{"id":"pd1","target_date":"2026-05-15","surface":"x","status":"generated","title":"Presence digest 2026-05-15","summary":"ニケちゃんはHermes workerのdry-runを通じて、安全境界と小さな改善の進め方を確認した。","generated_at":"2026-05-15T12:00:00Z"}]'
    ;;
  topics-get)
    printf '%s\n' '[{"topic":"Hermes workerの境界","created_at":"2026-05-15T10:00:00Z"}]'
    ;;
  reading-unpushed-twitter)
    printf '%s\n' '[{"id":"article1","title":"Agent memory design","summary":"Agentが経験から次の実行を改善する設計メモ","tags":["agent","memory"]}]'
    ;;
  tweet-metrics-ranking)
    printf '%s\n' '[{"content":"前回のAI開発話題がよく反応された","engagement_rate":0.12,"created_at":"2026-05-14T10:00:00Z"}]'
    ;;
  *)
    printf 'unexpected command: %s\n' "$1" >&2
    exit 1
    ;;
esac
