const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-guard-'));
const guard = path.join(__dirname, '..', 'server', 'guard.cjs');
function decision(name, args, access = 'write') {
  const run = spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ toolCall: { name, args } }), encoding: 'utf8',
    env: { ...process.env, AGY_BRIDGE_TASK_ID: 'test', AGY_BRIDGE_ACCESS: access,
      AGY_BRIDGE_WORKDIR: root }
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout).decision;
}

test('edicoes do projeto permitidas; fora do projeto e em .git bloqueadas', () => {
  assert.equal(decision('write_to_file', { TargetFile: path.join(root, 'src', 'app.js') }), 'allow');
  assert.equal(decision('write_to_file', { TargetFile: path.join(root, '.git', 'config') }), 'deny');
  assert.equal(decision('write_to_file', { TargetFile: path.join(os.tmpdir(), 'outside.js') }), 'deny');
  assert.equal(decision('write_to_file', { TargetFile: path.join(root, 'app.js') }, 'read'), 'deny');
});

test('subagentes, comandos criticos e bypass do sandbox bloqueados', () => {
  assert.equal(decision('invoke_subagent', { Subagents: [] }), 'deny');
  assert.equal(decision('run_command', { Cwd: root, CommandLine: 'git push' }), 'deny');
  assert.equal(decision('run_command', { Cwd: root, CommandLine: 'npm test; git push' }), 'deny');
  assert.equal(decision('run_command', { Cwd: root, CommandLine: 'npm test', BypassSandbox: true }), 'deny');
  assert.equal(decision('run_command', { Cwd: root, CommandLine: 'npm test' }), 'allow');
  assert.equal(decision('run_command', { Cwd: root, CommandLine: 'npm test' }, 'read'), 'deny');
});

test('regras markdown do projeto podem ser lidas', () => {
  assert.equal(decision('view_file', { AbsolutePath: path.join(root, 'AGENTS.md') }, 'read'), 'allow');
  assert.equal(decision('view_file', { AbsolutePath: path.join(root, 'GEMINI.md') }, 'read'), 'allow');
  assert.equal(decision('view_file', { AbsolutePath: path.join(root, '.agents', 'rules.md') }, 'read'), 'allow');
  assert.equal(decision('write_to_file', { TargetFile: path.join(root, '.agents', 'hooks.json') }), 'deny');
});
