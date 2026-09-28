const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lockfile = require('proper-lockfile');
const { dataDir, initialize } = require('./store');

function unquotedPath(file) {
  const absolute = path.resolve(file);
  if (!/\s/.test(absolute)) return absolute.replace(/\\/g, '/');
  if (process.platform === 'win32') {
    const result = spawnSync('cmd.exe', ['/d', '/c', 'for %I in ("' + absolute + '") do @echo %~sI'],
      { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 5000 });
    const candidate = String(result.stdout || '').trim();
    if (result.status === 0 && candidate && !/\s/.test(candidate) && fs.existsSync(candidate))
      return candidate.replace(/\\/g, '/');
  }
  throw new Error('O caminho do Node ou do guard tem espacos e nao possui alias curto para o hook AGY.');
}

async function ensureGuard() {
  if (process.env.AGY_BRIDGE_SKIP_GUARD_SETUP === '1') return;
  initialize();
  const guardPath = path.join(dataDir, 'guard.cjs');
  const sourcePath = path.join(__dirname, 'guard.cjs');
  const configDir = path.join(os.homedir(), '.gemini', 'config');
  const hooksPath = path.join(configDir, 'hooks.json');
  fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(hooksPath)) {
    try { fs.writeFileSync(hooksPath, '{}\n', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const release = await lockfile.lock(hooksPath, { realpath: false, stale: 30000,
    retries: { retries: 50, minTimeout: 20, maxTimeout: 200 } });
  try {
    const source = fs.readFileSync(sourcePath);
    if (!fs.existsSync(guardPath) || !fs.readFileSync(guardPath).equals(source)) {
      const guardNext = guardPath + '.next.' + process.pid;
      fs.writeFileSync(guardNext, source);
      fs.renameSync(guardNext, guardPath);
    }
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    const command = unquotedPath(process.execPath) + ' ' + unquotedPath(guardPath);
    hooks['agy-bridge-guard'] = {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }]
    };
    const next = hooksPath + '.agy-bridge-next.' + process.pid;
    fs.writeFileSync(next, JSON.stringify(hooks, null, 2) + '\n');
    fs.renameSync(next, hooksPath);
  } finally { await release(); }
  return hooksPath;
}

module.exports = { ensureGuard };
