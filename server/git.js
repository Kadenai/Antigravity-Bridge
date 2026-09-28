const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true }).trim();
}

function isRepo(workspace) {
  try { return fs.realpathSync(git(workspace, ['rev-parse', '--show-toplevel'])) === fs.realpathSync(workspace); }
  catch { return false; }
}

function status(workspace) {
  return git(workspace, ['status', '--porcelain', '--untracked-files=all']);
}

function checkpoint(workspace) {
  if (!isRepo(workspace)) throw new Error('Mudancas amplas exigem que a pasta seja a raiz de um repositorio Git.');
  const before = status(workspace);
  if (before) {
    const files = before.split(/\r?\n/).map(line => line.slice(3));
    if (files.some(file => /(^|[\\/])\.env($|[.\\/])|\.(pem|key|p12|pfx)$|(^|[\\/])id_rsa$/i.test(file))) {
      throw new Error('Ha arquivos possivelmente sensiveis sem commit; prepare um checkpoint manual antes da tarefa ampla.');
    }
    git(workspace, ['add', '-A']);
    try { git(workspace, ['commit', '-m', 'checkpoint: antes de tarefa AGY Bridge']); }
    catch (error) {
      try { git(workspace, ['reset']); } catch {}
      throw new Error('Nao foi possivel criar o commit de backup: ' + String(error.message));
    }
  }
  return git(workspace, ['rev-parse', 'HEAD']);
}

function createWorktree(workspace, id, dataDir) {
  if (!isRepo(workspace)) throw new Error('Worktree exige a raiz de um repositorio Git.');
  if (status(workspace)) throw new Error('Crie um checkpoint antes de abrir um worktree; o repositorio tem alteracoes locais.');
  const target = path.join(dataDir, 'worktrees', id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  git(workspace, ['worktree', 'add', '--detach', target, 'HEAD']);
  return { target, baseCommit: git(workspace, ['rev-parse', 'HEAD']) };
}

// Content hashes of every dirty file, so edits made before the task are not blamed on AGY.
function snapshot(workdir) {
  let top, entries;
  try {
    top = git(workdir, ['rev-parse', '--show-toplevel']);
    entries = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: top, encoding: 'utf8', timeout: 60000, windowsHide: true }).split('\0');
  }
  catch { return null; }
  const files = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    if (/[RC]/.test(entry.slice(0, 2))) i++;
    const file = entry.slice(3);
    const full = path.join(top, file);
    files[file] = fs.existsSync(full) && fs.statSync(full).isFile()
      ? crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex') : 'missing';
  }
  return files;
}

function changesSince(workdir, before) {
  const after = snapshot(workdir);
  if (!before || !after) return null;
  const changedFiles = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(file => before[file] !== after[file]).sort();
  let diffStat = null;
  if (changedFiles.length) {
    try {
      const top = git(workdir, ['rev-parse', '--show-toplevel']);
      diffStat = git(top, ['diff', '--stat', 'HEAD', '--', ...changedFiles]) || null;
    } catch {}
  }
  return { changedFiles, diffStat };
}

module.exports = { git, isRepo, status, checkpoint, createWorktree, snapshot, changesSince };
