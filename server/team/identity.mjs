// This computer's identity in a team: an Ed25519 key pair (shared/team-protocol.js). On macOS the keys live in the login
// keychain; elsewhere (or with OFFICE_TEAM_KEYSTORE=file) in data/team-key, readable by this user only.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const SERVICE = 'My Office team key';
const keyFile = (dataDir) => path.join(dataDir, 'team-key');
// one keychain item per data folder, so a second copy of the office (OFFICE_DATA_DIR) is a different member
const account = (dataDir) => path.resolve(dataDir);

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15_000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});
export const keychainWanted = () => process.platform === 'darwin' && process.env.OFFICE_TEAM_KEYSTORE !== 'file';

/** Keeps the keys; returns where: 'keychain' or 'file'. */
export async function saveKeys(dataDir, keys) {
  const secret = JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey });
  if (keychainWanted()) {
    try {
      // (-U: replace an item left from before. The secret is on the command line for a moment, visible only to this user.)
      await run('security', ['add-generic-password', '-U', '-a', account(dataDir), '-s', SERVICE, '-w', secret]);
      return 'keychain';
    } catch { /* no usable keychain (a locked or missing login keychain): fall back to the file */ }
  }
  await fsp.mkdir(dataDir, { recursive: true });
  const tmp = `${keyFile(dataDir)}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, secret, { mode: 0o600 });
  await fsp.chmod(tmp, 0o600);
  await fsp.rename(tmp, keyFile(dataDir));
  return 'file';
}

/** The keys kept by saveKeys, or null. */
export async function loadKeys(dataDir, store) {
  try {
    const raw = store === 'keychain'
      ? await run('security', ['find-generic-password', '-a', account(dataDir), '-s', SERVICE, '-w'])
      : await fsp.readFile(keyFile(dataDir), 'utf8');
    const k = JSON.parse(raw.trim());
    return k?.publicKey && k?.privateKey ? { publicKey: k.publicKey, privateKey: k.privateKey } : null;
  } catch { return null; }
}

export async function deleteKeys(dataDir, store) {
  if (store === 'keychain') await run('security', ['delete-generic-password', '-a', account(dataDir), '-s', SERVICE]).catch(() => {});
  await fsp.rm(keyFile(dataDir), { force: true });
}

/** The name others see: git's user.name, else the computer account's name. */
export async function displayName() {
  try { const n = (await run('git', ['config', '--global', 'user.name'])).trim(); if (n) return n; } catch { /* no git or no name */ }
  try { return os.userInfo().username; } catch { return 'me'; }
}
