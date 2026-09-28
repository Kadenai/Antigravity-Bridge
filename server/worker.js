const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { withState, recover, dataDir } = require('./store');
const { snapshot, changesSince } = require('./git');

const id = process.argv[2];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const terminal = new Set(['success', 'needs_review', 'error', 'canceled', 'interrupted']);

function agyPath() {
  if (process.env.AGY_BRIDGE_AGY_PATH) return process.env.AGY_BRIDGE_AGY_PATH;
  if (process.platform === 'win32') {
    const candidate = path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'agy';
}

async function claim() {
  return withState(state => {
    recover(state);
    const task = state.tasks[id];
    if (!task || terminal.has(task.status) || task.cancelRequested) {
      if (task && task.cancelRequested && !terminal.has(task.status)) task.status = 'canceled';
      return null;
    }
    const running = Object.values(state.tasks).filter(item => item.status === 'running');
    if (running.length >= 5) return false;
    const eligible = Object.values(state.tasks)
      .filter(item => item.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .find(item => !(item.access === 'write' &&
        running.some(active => active.access === 'write' && active.workdir === item.workdir)));
    if (eligible?.id !== id) return false;
    task.status = 'running';
    task.workerPid = process.pid;
    task.startedAt = new Date().toISOString();
    return { ...task };
  });
}

function stopTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

async function execute(task) {
  const testArgs = process.env.AGY_BRIDGE_TEST_ARGS ? JSON.parse(process.env.AGY_BRIDGE_TEST_ARGS) : [];
  const hookCheck = spawnSync(agyPath(), [...testArgs, '-p', '/hooks', '--new-project', '--output-format', 'text'], {
    cwd: task.workdir, encoding: 'utf8', windowsHide: true, timeout: 30000
  });
  if (hookCheck.status !== 0 || !/^agy-bridge-guard\tenabled\tPreToolUse\t\*/m.test(hookCheck.stdout || '')) {
    throw new Error('O hook de seguranca do AGY Bridge nao esta ativo. Execucao cancelada. ' +
      String(hookCheck.stderr || hookCheck.error?.message || '').slice(0, 1000));
  }
  const outputDir = path.join(dataDir, 'logs');
  fs.mkdirSync(outputDir, { recursive: true });
  const logPath = path.join(outputDir, id + '.jsonl');
  const errorPath = path.join(outputDir, id + '.stderr.txt');
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  const errors = fs.createWriteStream(errorPath, { flags: 'a' });
  const args = [...testArgs];
  args.push('-p', task.prompt, '--output-format', 'stream-json', '--model',
    'gemini-3.8-flash-high', '--print-timeout', '0', '--sandbox', '--mode', 'accept-edits',
    '--dangerously-skip-permissions', '--disable-slash-commands');
  if (task.conversationId) args.push('--conversation', task.conversationId);
  else args.push('--new-project');
  const before = task.access === 'write' ? snapshot(task.workdir) : null;
  const config = task.projectConfig || { commands: [], protected: [] };

  const child = spawn(agyPath(), args, {
    cwd: task.workdir,
    env: { ...process.env, AGY_BRIDGE_TASK_ID: id, AGY_BRIDGE_ACCESS: task.access,
      AGY_BRIDGE_WORKDIR: task.workdir,
      AGY_BRIDGE_EXTRA_COMMANDS: JSON.stringify(config.commands),
      AGY_BRIDGE_PROTECTED: JSON.stringify(config.protected),
      PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '') },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let buffer = '';
  let final = null;
  let blocked = 0;
  let criticalErrors = 0;
  const warnings = [];
  const checks = [];
  let cancellation = false;
  const processLine = line => {
    if (!line.trim()) return;
    log.write(line + '\n');
    try {
      const event = JSON.parse(line);
      if (event.event === 'result') final = event.result;
      if (event.event === 'step_update' && event.step_update?.state === 'ERROR') {
        blocked++;
        const step = event.step_update;
        const message = String(step.tool_info?.error?.message || '');
        if (step.tool_name === 'view_file' && message.includes('acesso fora do projeto ou a arquivo protegido'))
          warnings.push('Leitura externa ao projeto bloqueada.');
        else criticalErrors++;
      }
      if (event.event === 'step_update' && event.step_update?.step_type === 'tool' &&
          event.step_update?.tool_name === 'run_command' && event.step_update?.state === 'DONE') {
        const command = event.step_update.tool_info?.parameters?.CommandLine;
        if (command) checks.push({ command, error: event.step_update.tool_info?.error || null });
      }
    } catch {}
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      processLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  child.stderr.pipe(errors);
  await withState(state => { state.tasks[id].agyPid = child.pid || null; });
  const cancelTimer = setInterval(async () => {
    try {
      const requested = await withState(state => state.tasks[id]?.cancelRequested);
      if (requested && !cancellation) { cancellation = true; stopTree(child.pid); }
    } catch {}
  }, 1500);
  const timeout = setTimeout(() => {
    cancellation = true;
    stopTree(child.pid);
  }, Number(process.env.AGY_BRIDGE_MAX_MS || 30 * 60 * 1000));
  const result = await new Promise(resolve => {
    child.on('error', error => resolve({ code: -1, error: error.message }));
    child.on('close', code => resolve({ code }));
  });
  clearInterval(cancelTimer);
  clearTimeout(timeout);
  if (buffer) processLine(buffer);
  await new Promise(resolve => log.end(resolve));
  await new Promise(resolve => errors.end(resolve));
  if (task.access === 'write' && fs.existsSync(path.join(task.workdir, '.git'))) {
    const check = spawnSync('git', ['diff', '--check'], { cwd: task.workdir,
      encoding: 'utf8', windowsHide: true, timeout: 30000 });
    checks.push({ command: 'git diff --check', error: check.status === 0 ? null :
      String(check.stderr || check.error?.message || 'falhou').slice(0, 1000) });
    if (check.status !== 0) criticalErrors++;
  }
  const changes = before ? changesSince(task.workdir, before) : null;
  await withState(state => {
    const current = state.tasks[id];
    current.finishedAt = new Date().toISOString();
    current.conversationId = final?.conversation_id || current.conversationId || null;
    current.response = String(final?.response || '').slice(0, 30000);
    current.usage = final?.usage || null;
    current.blockedActions = blocked;
    current.warnings = warnings.slice(-30);
    current.checks = checks.slice(-30);
    current.changedFiles = changes?.changedFiles ?? null;
    current.diffStat = changes?.diffStat ?? null;
    current.logPath = logPath;
    current.stderrPath = errorPath;
    current.exitCode = result.code;
    current.error = result.error || final?.error || null;
    current.status = current.cancelRequested ? 'canceled'
      : result.code !== 0 || final?.status !== 'SUCCESS' ? 'error'
      : criticalErrors ? 'needs_review' : 'success';
  });
}

(async () => {
  let task;
  for (;;) {
    const claimed = await claim();
    if (claimed === null) return;
    if (claimed) { task = claimed; break; }
    await sleep(1000);
  }
  try { await execute(task); }
  catch (error) {
    await withState(state => {
      state.tasks[id].status = 'error';
      state.tasks[id].error = error.message;
      state.tasks[id].finishedAt = new Date().toISOString();
    });
  }
})().catch(error => {
  fs.appendFileSync(path.join(dataDir, 'worker-errors.log'), String(error.stack || error) + '\n');
  process.exitCode = 1;
});
