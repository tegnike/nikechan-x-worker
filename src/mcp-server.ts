#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod/v4';
import { readKillSwitchState } from './guards/kill-switch.js';
import { collectSelfTweetCanonicalMemory } from './memory/canonical-memory.js';
import { HermesMemoryStore } from './memory/hermes-memory.js';
import { collectSelfTweetToolContext } from './tools/self-tweet-context.js';

const server = new McpServer({
  name: 'nikechan-x-worker',
  version: '0.1.0',
});

server.registerTool(
  'read_self_tweet_context',
  {
    title: 'Read self-tweet context',
    description:
      'Read xangi-compatible, X-safe source context for Hermes self-tweet planning. This tool is read-only and never posts to X, Discord, or Supabase.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => jsonText(await collectSelfTweetToolContext())
);

server.registerTool(
  'read_public_memory',
  {
    title: 'Read public memory',
    description:
      'Read surface-safe public canonical memory for X. This is read-only and excludes raw private/operational memory.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => jsonText(await collectSelfTweetCanonicalMemory())
);

server.registerTool(
  'read_worker_experience',
  {
    title: 'Read worker experience',
    description: 'Read recent nikechan-x-worker local Hermes experience memory for workflow learning.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(20).default(8),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ limit }) => {
    const memory = new HermesMemoryStore();
    return jsonText({
      status: memory.isEnabled() ? 'loaded' : 'disabled',
      items: memory.recallRecent('self-tweet', limit),
    });
  }
);

server.registerTool(
  'read_self_tweet_skill',
  {
    title: 'Read self-tweet skill',
    description: 'Read the Hermes-native self-tweet skill used by nikechan-x-worker.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => jsonText(readHermesSelfTweetSkill())
);

server.registerTool(
  'read_guard_status',
  {
    title: 'Read guard status',
    description: 'Read kill-switch status for the X worker. This is read-only.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => jsonText(readKillSwitchState())
);

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function readHermesSelfTweetSkill() {
  const skillName = process.env.NIKECHAN_X_WORKER_HERMES_SKILLS ?? 'nikechan-x-self-tweet';
  const firstSkill = skillName.split(',')[0]?.trim() || 'nikechan-x-self-tweet';
  const path = resolve(homedir(), '.hermes', 'skills', firstSkill, 'SKILL.md');
  if (!existsSync(path)) {
    return {
      status: 'unavailable',
      skill: firstSkill,
      path,
      content: '',
    };
  }
  return {
    status: 'loaded',
    skill: firstSkill,
    path,
    content: readFileSync(path, 'utf-8'),
  };
}

await server.connect(new StdioServerTransport());
