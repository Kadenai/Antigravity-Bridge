const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { dataDir, withState, recover } = require('./store');
const { ensureGuard } = require('./guard-setup');
const { git, status, checkpoint, createWorktree } = require('./git');
const { loadProjectConfig } = require('./config');
const { terminal, publicTask, waitFor } = require('./tasks');

const server = new McpServer({ name: 'agy-bridge', version: '0.3.0' });
const textResult = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  isError
});
const failure = error => textResult({ error: String(error.message || error) }, true);

function workspacePath(value) {
  if (!path.isAbsolute(value)) throw new Error('Informe o caminho absoluto da pasta aberta no cliente.');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('A pasta do projeto nao existe.');
  return resolved;
}

function launch(task) {
  const worker = spawn(process.execPath, [path.join(__dirname, 'worker.js'), task.id], {
    detached: true, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, AGY_BRIDGE_DATA_DIR: dataDir }
  });
  worker.unref();
  return worker.pid;
}

async function enqueue(input, previous) {
  await ensureGuard();
  const workspace = workspacePath(input.workspace);
  const id = randomUUID();
  const access = input.access || 'write';
  const scope = input.scope || 'ordinary';
  const projectConfig = loadProjectConfig(workspace);
  let prompt = input.prompt;
  if (!previous && projectConfig.context.length) {
    prompt = 'Antes de comecar, leia estes arquivos do projeto: ' + projectConfig.context.join(', ') +
      '.\n\n' + prompt;
  }
  if (previous && (previous.workspace !== workspace || previous.status === 'running' ||
      previous.status === 'queued' || previous.integratedAt)) {
    throw new Error('A conversa anterior deve estar concluida e pertencer a esta pasta.');
  }
  let workdir = workspace;
  let baseCommit = previous?.baseCommit || null;
  let backupCommit = previous?.backupCommit || null;
  const isolated = previous ? previous.isolated : !!input.isolated;
  if (previous?.isolated) {
    workdir = previous.workdir;
    if (!fs.existsSync(workdir)) throw new Error('O worktree da conversa anterior nao existe mais.');
  } else if (access === 'write' && scope === 'broad') {
    backupCommit = checkpoint(workspace);
  }
  if (!previous && isolated) {
    const worktree = createWorktree(workspace, id, dataDir);
    workdir = worktree.target;
    baseCommit = worktree.baseCommit;
  }
  const task = {
    id, prompt, workspace, workdir, access, scope, isolated, projectConfig,
    baseCommit, backupCommit, conversationId: previous?.conversationId || null,
    status: 'queued', createdAt: new Date().toISOString(),
    workerPid: null, agyPid: null, cancelRequested: false
  };
  await withState(state => {
    recover(state);
    if (previous && Object.values(state.tasks).some(item => item.conversationId === previous.conversationId &&
        ['queued', 'running'].includes(item.status)))
      throw new Error('Esta conversa AGY ja tem uma continuacao em andamento.');
    state.tasks[id] = task;
  });
  try {
    const pid = launch(task);
    await withState(state => { state.tasks[id].workerPid = pid; });
  } catch (error) {
    await withState(state => {
      state.tasks[id].status = 'error';
      state.tasks[id].error = 'Falha ao iniciar o executor: ' + error.message;
    });
    throw error;
  }
  return {
    taskId: id, status: 'queued', workspace, workdir, isolated, backupCommit,
    waitCommand: 'node "' + path.join(__dirname, 'wait.js') + '" ' + id,
    note: isolated
      ? 'As alteracoes ficaram em um worktree; chame integrate_task apos revisar o resultado.'
      : 'Consulte task_status ate a conclusao.'
  };
}

server.registerTool('start_task', {
  title: 'Start Antigravity task',
  description: 'Start one AGY CLI task in the client project. Returns immediately with a task ID. Up to five AGY processes run globally. Pass the absolute path of the active project or worktree.',
  inputSchema: {
    prompt: z.string().min(1).max(30000),
    workspace: z.string().min(1),
    access: z.enum(['read', 'write']).optional(),
    scope: z.enum(['ordinary', 'broad']).optional(),
    isolated: z.boolean().optional()
  }
}, async input => {
  try { return textResult(await enqueue(input)); }
  catch (error) { return failure(error); }
});

server.registerTool('continue_task', {
  title: 'Continue Antigravity task',
  description: 'Send a follow-up to the AGY conversation returned by an earlier completed task.',
  inputSchema: { task_id: z.string().uuid(), prompt: z.string().min(1).max(30000) }
}, async ({ task_id, prompt }) => {
  try {
    const previous = await withState(state => { recover(state); return state.tasks[task_id]; });
    if (!previous?.conversationId) throw new Error('Esta tarefa nao tem uma conversa AGY que possa ser retomada.');
    return textResult(await enqueue({
      prompt, workspace: previous.workspace, access: previous.access,
      scope: 'ordinary', isolated: previous.isolated
    }, previous));
  } catch (error) { return failure(error); }
});

server.registerTool('task_status', {
  title: 'Get Antigravity task status',
  description: 'Read status, summary, denied actions and usage for one task.',
  inputSchema: { task_id: z.string().uuid() }
}, async ({ task_id }) => {
  try {
    const task = await withState(state => { recover(state); return state.tasks[task_id]; });
    if (!task) throw new Error('Tarefa nao encontrada.');
    return textResult(publicTask(task));
  } catch (error) { return failure(error); }
});

server.registerTool('wait_task', {
  title: 'Wait for Antigravity task',
  description: 'Block until one AGY task finishes or the timeout expires, then return the same data as task_status. Use when there is nothing else to do meanwhile; to keep working, run the waitCommand from start_task in the background instead.',
  inputSchema: { task_id: z.string().uuid(), timeout_seconds: z.number().int().min(1).max(600).optional() }
}, async ({ task_id, timeout_seconds }) => {
  try {
    const task = await waitFor(task_id, (timeout_seconds || 300) * 1000);
    return textResult({ ...publicTask(task), timedOut: !terminal.has(task.status) });
  } catch (error) { return failure(error); }
});

server.registerTool('list_tasks', {
  title: 'List Antigravity tasks',
  description: 'List recent tasks across Claude Code, Claude Desktop and Codex on this computer.',
  inputSchema: {}
}, async () => {
  try {
    const tasks = await withState(state => {
      recover(state);
      return Object.values(state.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    });
    return textResult(tasks.map(({ id, workspace, status, createdAt, access, isolated }) =>
      ({ id, workspace, status, createdAt, access, isolated })));
  } catch (error) { return failure(error); }
});

server.registerTool('cancel_task', {
  title: 'Cancel Antigravity task',
  description: 'Request cancellation of a queued or running AGY task.',
  inputSchema: { task_id: z.string().uuid() }
}, async ({ task_id }) => {
  try {
    const result = await withState(state => {
      const task = state.tasks[task_id];
      if (!task) throw new Error('Tarefa nao encontrada.');
      task.cancelRequested = true;
      if (task.status === 'queued') task.status = 'canceled';
      return { taskId: task_id, status: task.status };
    });
    return textResult(result);
  } catch (error) { return failure(error); }
});

server.registerTool('integrate_task', {
  title: 'Integrate isolated Antigravity task',
  description: 'Commit changes in a completed isolated Git worktree and cherry-pick them into its original clean project checkout.',
  inputSchema: { task_id: z.string().uuid() }
}, async ({ task_id }) => {
  try {
    const result = await withState(state => {
      recover(state);
      const task = state.tasks[task_id];
      if (!task?.isolated || !['success', 'needs_review'].includes(task.status))
        throw new Error('A tarefa isolada precisa ter terminado antes da integracao.');
      if (task.integratedAt) return { taskId: task_id, integratedAt: task.integratedAt, alreadyIntegrated: true };
      if (Object.values(state.tasks).some(item => ['running', 'queued'].includes(item.status) &&
          item.id !== task.id && (item.workdir === task.workdir || (!item.isolated && item.workspace === task.workspace))))
        throw new Error('Ha uma tarefa usando esta pasta ou a pasta principal. Aguarde sua conclusao.');
      if (status(task.workspace)) throw new Error('A pasta principal tem alteracoes locais. Integre depois de salva-las em um commit.');
      const changed = status(task.workdir);
      if (changed) {
        const files = changed.split(/\r?\n/).map(line => line.slice(3));
        if (files.some(file => /(^|[\\/])\.env($|[.\\/])|\.(pem|key|p12|pfx)$/i.test(file)))
          throw new Error('O worktree contem arquivo sensivel. Revise antes de integrar.');
        git(task.workdir, ['add', '-A']);
        git(task.workdir, ['commit', '-m', 'feat: integrar tarefa AGY Bridge ' + task.id.slice(0, 8)]);
      }
      const commits = git(task.workdir, ['rev-list', '--reverse', task.baseCommit + '..HEAD'])
        .split(/\r?\n/).filter(Boolean);
      try {
        for (const commit of commits) git(task.workspace, ['cherry-pick', commit]);
      } catch (error) {
        try { git(task.workspace, ['cherry-pick', '--abort']); } catch {}
        throw new Error('Integracao encontrou conflito; a pasta principal foi restaurada. O worktree foi preservado: ' + error.message);
      }
      task.integratedAt = new Date().toISOString();
      task.integratedCommit = git(task.workspace, ['rev-parse', 'HEAD']);
      return { taskId: task_id, integratedAt: task.integratedAt, integratedCommit: task.integratedCommit };
    });
    return textResult(result);
  } catch (error) { return failure(error); }
});

server.connect(new StdioServerTransport()).catch(error => {
  process.stderr.write(String(error.stack || error) + '\n');
  process.exitCode = 1;
});
