import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readConfigFile, saveConfig} from './config.js';

// `roost pet`: build the desktop pet if needed and start it (macOS only).
//   roost pet            build once, then start (or restart) it
//   roost pet --rebuild  compile again first
//   roost pet stop       quit it
const PET = join(fileURLToPath(new URL('..', import.meta.url)), 'pet');
const APP = join(PET, 'RoostPet.app');

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
  console.log('Pet started. Click it for its menu; ⌥⌘S opens the next session that needs you.');
}
