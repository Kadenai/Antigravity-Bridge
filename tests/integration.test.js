const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = result => JSON.parse(result.content[0].text);

test('MCP aceita tarefas e limita a cinco AGY globais', { timeout: 30000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-mcp-'));
  const workspace = path.join(base, 'project');
  fs.mkdirSync(workspace);
  const env = { ...process.env, AGY_BRIDGE_DATA_DIR: path.join(base, 'data'),
      AGY_BRIDGE_SKIP_GUARD_SETUP: '1', AGY_BRIDGE_AGY_PATH: process.execPath,
      AGY_BRIDGE_TEST_ARGS: JSON.stringify([path.join(__dirname, 'fake-agy.js')]),
      AGY_BRIDGE_FAKE_DELAY: '3500' };
  const clients = [0, 1].map(i => ({
    client: new Client({ name: 'agy-bridge-test-' + i, version: '1.0.0' }),
    transport: new StdioClientTransport({ command: process.execPath,
      args: [path.join(__dirname, '..', 'server', 'index.js')], env })
  }));
  try {
    await Promise.all(clients.map(({ client, transport }) => client.connect(transport)));
    const tools = await clients[0].client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'start_task'));
    const tasks = [];
    for (let i = 0; i < 6; i++) {
      const client = clients[i % 2].client;
      const result = decode(await client.callTool({ name: 'start_task',
        arguments: { workspace, prompt: 'fake task ' + i, access: 'read' } }));
      assert.ok(result.taskId);
      tasks.push(result.taskId);
    }
    await sleep(1500);
    const client = clients[0].client;
    const snapshot = await Promise.all(tasks.map(async task_id =>
      decode(await client.callTool({ name: 'task_status', arguments: { task_id } }))));
    assert.ok(snapshot.filter(item => item.status === 'running').length <= 5);
    assert.ok(snapshot.some(item => item.status === 'queued'));
    let final = snapshot;
    for (let i = 0; i < 25; i++) {
      if (final.every(item => item.status === 'success')) break;
      await sleep(500);
      final = await Promise.all(tasks.map(async task_id =>
        decode(await client.callTool({ name: 'task_status', arguments: { task_id } }))));
    }
    assert.ok(final.every(item => item.status === 'success'), JSON.stringify(final));
    assert.ok(final.every(item => item.response === 'fake complete'));
    assert.equal(final[0].blockedActions, 1);
    assert.equal(final[0].warnings[0], 'Leitura externa ao projeto bloqueada.');

    const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'AGY Bridge Test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(workspace, 'app.js'), 'module.exports = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'initial');
    const isolated = decode(await client.callTool({ name: 'start_task', arguments: {
      workspace, prompt: 'fake isolated edit', access: 'write', isolated: true
    } }));
    assert.ok(isolated.taskId);
    let edit;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      edit = decode(await client.callTool({ name: 'task_status', arguments: { task_id: isolated.taskId } }));
      if (!['queued', 'running'].includes(edit.status)) break;
    }
    assert.equal(edit.status, 'success', JSON.stringify(edit));
    assert.equal(fs.readFileSync(path.join(workspace, 'app.js'), 'utf8'), 'module.exports = 1;\n');
    const integrated = decode(await client.callTool({ name: 'integrate_task',
      arguments: { task_id: isolated.taskId } }));
    assert.ok(integrated.integratedCommit, JSON.stringify(integrated));
    assert.equal(fs.readFileSync(path.join(workspace, 'app.js'), 'utf8').trim(), 'module.exports = 2;');
    assert.equal(git('status', '--short'), '');
  } finally {
    await Promise.all(clients.map(({ client }) => client.close()));
  }
});
