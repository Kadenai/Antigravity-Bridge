const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lockfile = require('proper-lockfile');

const dataDir = process.env.AGY_BRIDGE_DATA_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'agy-bridge');
const stateFile = path.join(dataDir, 'state.json');

function initialize() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(stateFile)) {
    try { fs.writeFileSync(stateFile, JSON.stringify({ tasks: {} }), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}

async function withState(change) {
  initialize();
  const release = await lockfile.lock(stateFile, {
    realpath: false,
    stale: 30000,
    update: 5000,
    retries: { retries: 100, factor: 1.15, minTimeout: 20, maxTimeout: 200 }
  });
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const result = await change(state);
    const next = stateFile + '.next.' + process.pid;
    fs.writeFileSync(next, JSON.stringify(state));
    fs.renameSync(next, stateFile);
    return result;
  } finally {
    await release();
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function recover(state) {
  for (const task of Object.values(state.tasks)) {
    const recent = Date.now() - Date.parse(task.createdAt) < 10000;
    if (['queued', 'running'].includes(task.status) && !pidAlive(task.workerPid) && !recent) {
      task.status = 'interrupted';
      task.error = 'O processo que executava esta tarefa terminou inesperadamente.';
      task.finishedAt = new Date().toISOString();
    }
  }
}

module.exports = { dataDir, stateFile, initialize, withState, recover };
