import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {rmSync, writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {statePath} from './config.js';

// Lets the desktop pet drive the roost that is already open instead of
// opening a new one: a local socket that takes "open <id>", plus a file saying
// which terminal (tty) this roost lives in, so the pet can bring it forward.
export const SOCKET = process.env.ROOST_SOCKET || statePath('roost.sock');
const INFO = process.env.ROOST_SOCKET ? `${process.env.ROOST_SOCKET}.json` : statePath('roost.json');

function alive(path) {
  return new Promise(resolve => {
    const c = net.connect(path);
    c.on('connect', () => { c.end('ping\n'); resolve(true); });
    c.on('error', () => resolve(false));
  });
}

export function ttyOf(pid) {
  try {
    const t = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {encoding: 'utf8'}).trim();
    return t && t !== '??' ? `/dev/${t}` : null;
  } catch { return null; }
}

function request(path, line) {
  return new Promise(resolve => {
    const c = net.connect(path);
    c.on('connect', () => c.end(`${line}\n`));
    c.on('close', () => resolve());
    c.on('error', () => resolve());
    setTimeout(resolve, 500);
  });
}

// The roost opened last owns the socket: it is the one in use. An older one
// is told to let go; and every roost re-checks now and then, so when the
// owner quits another open roost picks the socket up.
export async function listen(onOpen) {
  mkdirSync(dirname(SOCKET), {recursive: true});
  let server = null;
  const release = () => {
    if (!server) return;
    server.close();
    server = null;
  };
  const own = () => {
    rmSync(SOCKET, {force: true});
    server = net.createServer(conn => {
      let buf = '';
      conn.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const [cmd, arg] = buf.slice(0, i).trim().split(/\s+/);
          buf = buf.slice(i + 1);
          if (cmd === 'open' && arg) { onOpen(arg); conn.write('ok\n'); }
          else if (cmd === 'ping') conn.write('pong\n');
          else if (cmd === 'release') { conn.end('bye\n'); release(); }
        }
      });
      conn.on('error', () => {});
    });
    server.on('error', () => { server = null; });
    server.listen(SOCKET);
    writeFileSync(INFO, JSON.stringify({pid: process.pid, tty: ttyOf(process.pid), socket: SOCKET}));
  };
  if (await alive(SOCKET)) await request(SOCKET, 'release');
  own();
  const timer = setInterval(async () => {
    if (!server && !(await alive(SOCKET))) own();
  }, 5000);
  timer.unref();
  const close = () => {
    clearInterval(timer);
    if (!server) return;
    release();
    try {
      if (JSON.parse(readFileSync(INFO, 'utf8')).pid === process.pid) { rmSync(SOCKET, {force: true}); rmSync(INFO, {force: true}); }
    } catch {}
  };
  process.on('exit', close);
  return close;
}

// Client side, for the pet: hand the id to a running roost. Resolves to its
// tty when one took it, or null when none is listening.
export function sendOpen(id) {
  return new Promise(resolve => {
    const c = net.connect(SOCKET);
    let got = '';
    c.on('connect', () => c.write(`open ${id}\n`));
    c.on('data', d => { got += d; if (got.includes('\n')) c.end(); });
    c.on('end', () => {
      if (!got.startsWith('ok')) return resolve(null);
      try { resolve(JSON.parse(readFileSync(INFO, 'utf8')).tty || ''); } catch { resolve(''); }
    });
    c.on('error', () => resolve(null));
    setTimeout(() => { c.destroy(); resolve(null); }, 1500);
  });
}
