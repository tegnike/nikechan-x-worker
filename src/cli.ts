#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { stdin } from 'node:process';
import { startServer } from './server.js';
import { runWorkflow } from './worker.js';

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'run') {
    const input = await readRequest(args);
    const report = await runWorkflow(input);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (command === 'serve') {
    const port = Number(readArg(args, '--port') ?? process.env.NIKECHAN_X_WORKER_PORT ?? 8787);
    const host = readArg(args, '--host') ?? process.env.NIKECHAN_X_WORKER_HOST ?? '127.0.0.1';
    startServer({ port, host });
    return;
  }
  if (command === 'hermes-setup') {
    const name = readArg(args, '--name') ?? 'nikechan-x-worker';
    const serverPath = resolve(process.cwd(), 'dist/mcp-server.js');
    if (!existsSync(serverPath)) {
      throw new Error('dist/mcp-server.js not found; run npm run build before hermes-setup');
    }
    const result = spawnSync(
      'hermes',
      ['mcp', 'add', name, '--command', process.execPath, '--args', serverPath],
      {
        input: 'y\n\n',
        encoding: 'utf-8',
        env: process.env,
      }
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      throw new Error(`hermes mcp add failed with status ${result.status ?? 'unknown'}`);
    }
    syncHermesSkills();
    process.stdout.write(
      [
        '',
        'Hermes MCP server registered.',
        `Recommended toolsets for worker runs: ${name},skills,memory,x_search`,
        `Worker MCP tools: ${name}:read_self_tweet_context,${name}:read_public_memory,${name}:read_worker_experience,${name}:read_self_tweet_skill,${name}:read_guard_status`,
        '',
      ].join('\n')
    );
    return;
  }
  printHelp();
}

function syncHermesSkills(): void {
  const hermesHome = process.env.HERMES_HOME?.trim() || resolve(homedir(), '.hermes');
  const skillNames = (
    process.env.NIKECHAN_X_WORKER_HERMES_SKILLS ?? 'nikechan-x-self-tweet,nikechan-x-trend-context'
  )
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  for (const skillName of skillNames) {
    const sourcePath = resolve(process.cwd(), 'skills', 'hermes', skillName, 'SKILL.md');
    if (!existsSync(sourcePath)) continue;
    const targetDir = resolve(hermesHome, 'skills', skillName);
    const targetPath = resolve(targetDir, 'SKILL.md');
    mkdirSync(targetDir, { recursive: true });
    if (!existsSync(targetPath)) copyFileSync(sourcePath, targetPath);
  }
}

async function readRequest(args: string[]): Promise<unknown> {
  const jsonArg = readArg(args, '--json');
  if (jsonArg) return JSON.parse(jsonArg);
  const fileArg = readArg(args, '--file');
  if (fileArg) return JSON.parse(readFileSync(fileArg, 'utf-8'));
  const raw = await readStdin();
  return JSON.parse(raw);
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) throw new Error('expected JSON on stdin or --json/--file');
  return raw;
}

function printHelp(): void {
  process.stdout.write(`nikechan-x-worker

Commands:
  run [--json JSON | --file path]  Run one workflow request and print WorkflowReport JSON
  serve [--host host] [--port n]   Start HTTP server with POST /workflow
  hermes-setup [--name name]        Register the read-only MCP tools with Hermes
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
