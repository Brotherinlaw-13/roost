import {spawn} from 'node:child_process';

// execFile's signature, but the child runs in its own session, away from the
// terminal (execFile ignores `detached`). iTerm's Claude Code integration adds
// a toolbar while a `claude` process is in the tab's foreground, so the list
// refresh every 3 s made the screen jump.
export function execDetached(cmd, args, opts, done) {
  const {env, cwd, maxBuffer = 1024 * 1024} = opts || {};
  let child;
  try {
    child = spawn(cmd, args, {env, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  } catch (e) {
    queueMicrotask(() => done(e, '', ''));
    return null;
  }
  const out = [], err = [];
  let size = 0, failed = null;
  const take = list => d => {
    size += d.length;
    if (size > maxBuffer && !failed) { failed = new Error('maxBuffer exceeded'); child.kill(); }
    list.push(d);
  };
  child.stdout.on('data', take(out));
  child.stderr.on('data', take(err));
  child.on('error', e => { failed = failed || e; });
  child.on('close', code => {
    const o = Buffer.concat(out).toString('utf8'), e = Buffer.concat(err).toString('utf8');
    const error = failed || (code === 0 ? null : Object.assign(new Error(`${cmd} exited with code ${code}`), {code}));
    done(error, o, e);
  });
  return child;
}
