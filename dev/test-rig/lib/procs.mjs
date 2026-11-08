// Background processes with pid files and logs under RIG_DATA_DIR.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS } from './config.mjs';

const pidFile = (name) => path.join(PATHS.run, `${name}.pid`);
export const logFile = (name) => path.join(PATHS.logs, `${name}.log`);

export function readPid(name) {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), 'utf8').trim());
    return pid > 0 ? pid : null;
  } catch (err) {
    return null;
  }
}

export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function running(name) {
  const pid = readPid(name);
  return alive(pid) ? pid : null;
}

// Started in a process group of its own, so stop() takes its children
// (next dev forks) with it.
export function startProcess(name, cmd, args, { cwd, env } = {}) {
  const existing = running(name);
  if (existing) return existing;
  fs.mkdirSync(PATHS.run, { recursive: true });
  fs.mkdirSync(PATHS.logs, { recursive: true });
  const out = fs.openSync(logFile(name), 'a');
  fs.writeSync(out, `\n--- ${new Date().toISOString()} starting ${name}: ${cmd} ${args.join(' ')}\n`);
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  fs.writeFileSync(pidFile(name), String(child.pid));
  fs.closeSync(out);
  return child.pid;
}

export async function stopProcess(name, { timeoutMs = 8000 } = {}) {
  const pid = readPid(name);
  if (!alive(pid)) {
    try { fs.unlinkSync(pidFile(name)); } catch (err) { /* none */ }
    return false;
  }
  const signal = (sig) => {
    try { process.kill(-pid, sig); } catch (err) {
      try { process.kill(pid, sig); } catch (e) { /* gone */ }
    }
  };
  signal('SIGTERM');
  const until = Date.now() + timeoutMs;
  while (alive(pid) && Date.now() < until) await sleep(150);
  if (alive(pid)) signal('SIGKILL');
  try { fs.unlinkSync(pidFile(name)); } catch (err) { /* none */ }
  return true;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

export async function waitFor(check, { timeoutMs = 30000, every = 250, what = 'service' } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await check()) return true;
    } catch (err) {
      // not yet
    }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export function tail(name, lines = 30) {
  try {
    const text = fs.readFileSync(logFile(name), 'utf8').split('\n');
    return text.slice(-lines).join('\n');
  } catch (err) {
    return '';
  }
}
