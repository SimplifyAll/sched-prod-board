// Builds dist/ from app/: fills config.js from the environment and writes the build sha (R6) into the page.
//   API=<api> SESSION=<session> node scripts/build.mjs   (BUILD_SHA defaults to git HEAD)
// The filled config.js is in dist/ only, never committed: the session is a key.
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const { API, SESSION } = process.env;
if (!API || !SESSION) { console.error('set API and SESSION'); process.exit(2); }
const sha = process.env.BUILD_SHA || execSync('git rev-parse HEAD').toString().trim();
if (!process.env.BUILD_SHA && execSync('git status --porcelain app').toString().trim()) {
  console.error('app/ has uncommitted changes: commit first, so the sha names this build'); process.exit(2);
}
rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
writeFileSync('dist/config.js', `export const API = ${JSON.stringify(API)};\nexport const SESSION = ${JSON.stringify(SESSION)};\n`);
const html = readFileSync('dist/index.html', 'utf8').replaceAll('__BUILD_SHA__', sha);
writeFileSync('dist/index.html', html);
console.log(`dist/ built at ${sha}`);
