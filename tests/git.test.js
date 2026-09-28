const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkpoint } = require('../server/git');

test('checkpoint cria commit antes de tarefa ampla e recusa arquivo sensivel', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'AGY Bridge Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'app.js'), 'first\n');
  git('add', '-A');
  git('commit', '-qm', 'initial');
  const before = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'app.js'), 'changed\n');
  const backup = checkpoint(root);
  assert.notEqual(backup, before);
  assert.equal(backup, git('rev-parse', 'HEAD'));
  assert.equal(git('status', '--short'), '');
  assert.equal(git('show', 'HEAD:app.js'), 'changed');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret\n');
  assert.throws(() => checkpoint(root), /sensiveis/);
  assert.ok(git('status', '--short').includes('.env'));
});
