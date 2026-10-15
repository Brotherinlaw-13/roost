import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, symlinkSync, lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readConfigFile, saveConfig} from './config.js';

// `roost pet`: build the desktop pet if needed and start it (macOS only).
//   roost pet            build once, then start (or restart) it
//   roost pet --rebuild  compile again first
//   roost pet stop       quit it
const PET = join(fileURLToPath(new URL('..', import.meta.url)), 'pet');
const APP = join(PET, 'RoostPet.app');
const SKILL = join(fileURLToPath(new URL('..', import.meta.url)), 'skills', 'pet');
const CLAUDE_SKILL = join(homedir(), '.claude', 'skills', 'pet');

// `/pet` inside Claude Code: a skill that runs `roost pet`. Linked, not copied, so it follows the repo.
function installSkill() {
  try { lstatSync(CLAUDE_SKILL); return false; } catch {}
  mkdirSync(join(homedir(), '.claude', 'skills'), {recursive: true});
  symlinkSync(SKILL, CLAUDE_SKILL);
  return true;
}

export async function runPet(args = []) {
  if (process.platform !== 'darwin') {
    console.log('The desktop pet runs on macOS only.');
    return;
  }
  spawnSync('pkill', ['-x', 'RoostPet']);
  if (args[0] === 'stop') return void console.log('Pet stopped.');
  if (!existsSync(APP) || args.includes('--rebuild')) {
    const r = spawnSync('bash', [join(PET, 'build.sh')], {stdio: 'inherit'});
    if (r.status !== 0) return void console.log('The pet did not build (it needs Xcode Command Line Tools: xcode-select --install).');
  }
  spawnSync('open', [APP]);
  const c = readConfigFile() || {};
  if (!c.pet) saveConfig({...c, pet: true});
  if (installSkill()) console.log('Added /pet to Claude Code (new sessions pick it up).');
  console.log('Pet started. Click it for its menu; ⌥⌘S opens the next session that needs you.');
}
