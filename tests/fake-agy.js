const args = process.argv.slice(2);
const fs = require('node:fs');
const path = require('node:path');
if (args.includes('/hooks')) {
  process.stdout.write('agy-bridge-guard\tenabled\tPreToolUse\t*\tcommand\tguard\n');
} else {
  const prompt = args[args.indexOf('-p') + 1] || '';
  process.stdout.write(JSON.stringify({ event: 'init', conversation_id: '00000000-0000-4000-8000-000000000000',
    init: { model: 'gemini-3.8-flash-high' } }) + '\n');
  if (prompt === 'fake task 0') process.stdout.write(JSON.stringify({ event: 'step_update', step_update: {
    state: 'ERROR', step_type: 'tool', tool_name: 'view_file',
    tool_info: { error: { message: 'tool call denied by pre-tool hook: AGY Bridge: acesso fora do projeto ou a arquivo protegido.' } }
  } }) + '\n');
  if (prompt === 'fake isolated edit') fs.writeFileSync(path.join(process.cwd(), 'app.js'), 'module.exports = 2;\n');
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ event: 'result', result: {
      conversation_id: '00000000-0000-4000-8000-000000000000', status: 'SUCCESS',
      response: 'fake complete', usage: { total_tokens: 1 }
    } }) + '\n');
  }, Number(process.env.AGY_BRIDGE_FAKE_DELAY || 2500));
}
