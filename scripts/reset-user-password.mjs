#!/usr/bin/env node
// Reset a Foundry world user's password by writing directly to the world DB.
//
// For local development against a world exported from a hosted platform. On
// The Forge, players authenticate against their Forge account and Forge brokers
// the world login, so the password stored on the user document is a value the
// owner has never typed and cannot supply. Locally there is no broker, the join
// form checks that stored value, and nobody can get in. This resets it.
//
//   node scripts/reset-user-password.mjs <world>/data/users <userName> <newPassword>
//   node scripts/reset-user-password.mjs <world>/data/users <userName> --clear
//
// FOUNDRY MUST NOT BE RUNNING. LevelDB takes an exclusive lock, so the write
// fails while the world is active. Stop the server, reset, start it again.
//
// Requires classic-level (npm i -D classic-level).
//
// Mirrors Foundry 14's own scheme, read out of the application bundle:
//   dist/core/auth.mjs   hashPassword(pw, salt) =
//                          pbkdf2Sync(pw, salt, 1000, 64, 'sha512').toString('hex')
//                        createPassword(pw) uses salt = randomString(64)
//   dist/sessions.mjs    testPassword(pw, user.password, user.passwordSalt)
//
// Note the salt that matters is the one on the USER document, not the global
// `passwordSalt` in Config/options.json -- that global is only used for the
// admin password. So a reset must write `password` and `passwordSalt` together.

import { ClassicLevel } from 'classic-level';
import crypto from 'node:crypto';

const [usersDir, userName, newPw] = process.argv.slice(2);

if (!usersDir || !userName) {
  console.error('usage: reset-user-password.mjs <world>/data/users <userName> [newPassword|--clear]');
  process.exit(2);
}

const ITERATIONS = 1000;
const KEYLEN = 64;
const DIGEST = 'sha512';

const hashPassword = (pw, salt) =>
  crypto.pbkdf2Sync(pw, salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
const randomString = (n = 64) => crypto.randomBytes(n).toString('hex').slice(0, n);

const db = new ClassicLevel(usersDir, { valueEncoding: 'json' });

let key = null;
let user = null;
for await (const [k, v] of db.iterator()) {
  if (v?.name === userName) {
    key = k;
    user = v;
    break;
  }
}

if (!user) {
  const names = [];
  for await (const [, v] of db.iterator()) if (v?.name) names.push(`${v.name} (role ${v.role})`);
  console.error(`no user named ${JSON.stringify(userName)}. Users in this world:`);
  for (const n of names.sort()) console.error(`  ${n}`);
  await db.close();
  process.exit(1);
}

console.log(`user ${user.name}   role ${user.role}   id ${user._id}`);
console.log(`  before: password ${user.password ? 'SET' : '(empty)'}, salt ${user.passwordSalt ? 'SET' : '(empty)'}`);

if (newPw === '--clear' || newPw === undefined) {
  user.password = '';
  user.passwordSalt = '';
  console.log('  after : password (empty) -- this user now joins with no password');
} else {
  const salt = randomString(64);
  user.passwordSalt = salt;
  user.password = hashPassword(newPw, salt);
  // Verify the way the server will, before committing anything to disk.
  const ok = crypto.timingSafeEqual(
    crypto.pbkdf2Sync(newPw, salt, ITERATIONS, KEYLEN, DIGEST),
    Buffer.from(user.password, 'hex')
  );
  if (!ok) {
    console.error('  self-check FAILED -- refusing to write');
    await db.close();
    process.exit(1);
  }
  console.log(`  after : password SET (${user.password.length} hex chars), self-check PASS`);
}

await db.put(key, user);
await db.close();
console.log('written. Start Foundry and log in.');
