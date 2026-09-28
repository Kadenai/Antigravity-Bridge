const { withState, recover } = require('./store');

const terminal = new Set(['success', 'needs_review', 'error', 'canceled', 'interrupted']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function publicTask(task) {
  const { prompt, projectConfig, ...visible } = task;
  return visible;
}

async function waitFor(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await withState(state => { recover(state); return state.tasks[id]; });
    if (!task) throw new Error('Tarefa nao encontrada.');
    if (terminal.has(task.status) || Date.now() >= deadline) return task;
    await sleep(Math.min(2000, Math.max(0, deadline - Date.now())));
  }
}

module.exports = { terminal, publicTask, waitFor };
