// Background waiter: node wait.js <taskId> [timeoutSeconds]
// Exits when the task finishes, so the orchestrator is woken without polling.
// Exit codes: 0 success, 1 needs_review/error/canceled/interrupted, 2 timeout, 3 usage or lookup error.
const { terminal, publicTask, waitFor } = require('./tasks');

const [id, timeout] = process.argv.slice(2);
if (!id) {
  process.stderr.write('Uso: node wait.js <taskId> [segundos]\n');
  process.exit(3);
}

waitFor(id, Number(timeout || 3600) * 1000).then(task => {
  process.stdout.write(JSON.stringify(publicTask(task), null, 2) + '\n');
  process.exitCode = task.status === 'success' ? 0 : terminal.has(task.status) ? 1 : 2;
}).catch(error => {
  process.stderr.write(String(error.message || error) + '\n');
  process.exitCode = 3;
});
