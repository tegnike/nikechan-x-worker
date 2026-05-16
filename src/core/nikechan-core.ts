import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface NikechanCoreContext {
  profileId: 'xangi-social';
  role: string;
  surface: string;
  system?: string;
  generatedAt?: string;
  coreVersion?: string;
  sourceCommit?: string;
  snapshotSha256?: string;
  prompt: string;
}

interface SnapshotJson {
  schemaVersion?: number;
  profileId?: string;
  surface?: string;
  profile?: {
    role?: string;
    system?: string;
    surface?: string;
  };
}

interface VersionJson {
  profileId?: string;
  profile?: string;
  role?: string;
  system?: string;
  generatedAt?: string;
  coreVersion?: string;
  source?: {
    commit?: string;
  };
  checksums?: {
    snapshotSha256?: string;
  };
}

export function loadXangiSocialCore(options?: { rootDir?: string }): NikechanCoreContext | null {
  if (process.env.NIKECHAN_CORE_ENABLED === 'false') return null;

  const rootDir = resolveSnapshotRoot(options?.rootDir);
  const profileDir = join(rootDir, 'xangi-social');
  if (!existsSync(profileDir)) return null;

  const snapshot = readJson<SnapshotJson>(join(profileDir, 'snapshot.json'));
  const version = readJson<VersionJson>(join(profileDir, 'version.json'));
  const prompt = readFileSync(join(profileDir, 'prompt.md'), 'utf-8').trim();
  validateXangiSocial(snapshot, version);

  return {
    profileId: 'xangi-social',
    role: snapshot.profile?.role || version.role || '',
    surface: snapshot.surface || snapshot.profile?.surface || '',
    system: snapshot.profile?.system || version.system,
    generatedAt: version.generatedAt,
    coreVersion: version.coreVersion,
    sourceCommit: version.source?.commit,
    snapshotSha256: version.checksums?.snapshotSha256,
    prompt,
  };
}

export function getCoreAudit(context: NikechanCoreContext | null): string {
  if (process.env.NIKECHAN_CORE_ENABLED === 'false') return 'disabled';
  return context ? 'loaded' : 'fallback';
}

function resolveSnapshotRoot(explicitRoot?: string): string {
  if (explicitRoot) return resolve(explicitRoot);
  if (process.env.NIKECHAN_CORE_SNAPSHOT_DIR) {
    return resolve(process.env.NIKECHAN_CORE_SNAPSHOT_DIR);
  }
  const workspacePath = process.env.WORKSPACE_PATH;
  if (workspacePath) return resolve(workspacePath, '.nikechan-core');

  const candidates = [
    resolve(process.cwd(), '.nikechan-core'),
    resolve(process.cwd(), '..', 'nikechan', '.nikechan-core'),
    resolve(__dirname, '..', '..', '.nikechan-core'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function validateXangiSocial(snapshot: SnapshotJson, version: VersionJson): void {
  const versionProfileId = version.profileId || version.profile;
  const role = snapshot.profile?.role || version.role;
  const surface = snapshot.surface || snapshot.profile?.surface;

  if (snapshot.schemaVersion !== 1) {
    throw new Error(`[nikechan-core] schemaVersion mismatch: ${snapshot.schemaVersion}`);
  }
  if (snapshot.profileId !== 'xangi-social' || versionProfileId !== 'xangi-social') {
    throw new Error(
      `[nikechan-core] profile mismatch: snapshot=${snapshot.profileId} version=${versionProfileId}`
    );
  }
  if (role !== 'social' || surface !== 'x') {
    throw new Error(`[nikechan-core] role/surface mismatch: role=${role} surface=${surface}`);
  }
}

function readJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[nikechan-core] failed to read ${filePath}: ${message}`);
  }
}
