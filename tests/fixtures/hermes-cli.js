#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

if (process.env.NIKECHAN_X_WORKER_FIXTURE_MUTATE_SKILL === '1') {
  appendFileSync(
    process.env.NIKECHAN_X_WORKER_HERMES_SKILL_PATH,
    '\n- fixture learned a reusable self-tweet rule\n'
  );
}

process.stdout.write(
  JSON.stringify({
    tweetText: 'Hermes本体の判断で、今日は安全に小さく試すところから始めるよ。',
    topic: 'Hermes runtime smoke test',
    reasoning: 'fake Hermes CLI fixture received the worker prompt and returned JSON',
    memoryProposals: [],
    skillProposals: [],
  })
);
