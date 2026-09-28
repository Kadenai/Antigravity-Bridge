// AGY PreToolUse hook. Runs only for AGY Bridge sessions.
const fs = require('node:fs');
const path = require('node:path');

const allowed = new Set([
  'view_file', 'list_dir', 'find_by_name', 'grep_search',
  'search_web', 'read_url_content',
  'write_to_file', 'replace_file_content', 'multi_replace_file_content',
  'run_command'
]);
const writes = new Set(['write_to_file', 'replace_file_content', 'multi_replace_file_content']);
const pathArg = {
  view_file: 'AbsolutePath', list_dir: 'DirectoryPath', find_by_name: 'SearchDirectory',
  grep_search: 'SearchPath', write_to_file: 'TargetFile',
  replace_file_content: 'TargetFile', multi_replace_file_content: 'TargetFile'
};

function realPath(candidate) {
  let current = path.resolve(candidate);
  const missing = [];
  while (!fs.existsSync(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...missing);
}

function inside(candidate, root) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  const current = realPath(candidate);
  if (!current) return false;
  const relative = path.relative(fs.realpathSync(root), current);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function sensitive(candidate, write) {
  const parts = path.normalize(candidate).split(path.sep).map(part => part.toLowerCase());
  const name = parts.at(-1) || '';
  return parts.includes('.git') || (write && (parts.includes('.agents') || parts.includes('.gemini'))) ||
    name === '.env' || name.startsWith('.env.') ||
    /\.(pem|key|p12|pfx)$/i.test(name) || name === 'id_rsa';
}

function listFromEnv(name) {
  try { const value = JSON.parse(process.env[name] || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

function globRegex(pattern) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp('^' + source + '(/.*)?$', 'i');
}

// Project config paths plus the config itself, so AGY cannot grant itself permissions.
function protectedByProject(candidate, root) {
  const relative = path.relative(fs.realpathSync(root), realPath(candidate)).replace(/\\/g, '/');
  return ['.agy-bridge.json', ...listFromEnv('AGY_BRIDGE_PROTECTED')]
    .some(pattern => globRegex(pattern.replace(/\/+$/, '')).test(relative));
}

function safeCommand(command) {
  const c = command.trim();
  if (!c || /[\r\n;&|><`$%]/.test(c) || /\b(agy|antigravity|powershell|pwsh|cmd|bash|sh|python\s+-c|node\s+-e)\b/i.test(c)) return false;
  if (listFromEnv('AGY_BRIDGE_EXTRA_COMMANDS').some(extra => extra.toLowerCase() === c.toLowerCase())) return true;
  return /^(?:git (?:status(?: --short)?|diff(?: --check| --stat| --name-only)?|log -[1-9] --oneline)|npm (?:test|run (?:test|build|lint|typecheck))|npx tsc --noEmit|pytest(?: -q)?|python -m pytest(?: -q)?|cargo test|go test \.\/\.\.\.|dotnet test)$/i.test(c);
}

function check(event) {
  if (!process.env.AGY_BRIDGE_TASK_ID) return { decision: 'allow' };
  const { name, args = {} } = event.toolCall || {};
  const root = process.env.AGY_BRIDGE_WORKDIR;
  if (!root || !fs.existsSync(root)) return { decision: 'deny', reason: 'AGY Bridge: projeto indisponivel.' };
  if (!allowed.has(name)) return { decision: 'deny', reason: 'AGY Bridge: ferramenta reservada ao orquestrador. Subagentes e acoes externas estao desativados.' };
  if (writes.has(name) && process.env.AGY_BRIDGE_ACCESS !== 'write')
    return { decision: 'deny', reason: 'AGY Bridge: tarefa somente de leitura.' };
  const candidate = args[pathArg[name]];
  if (pathArg[name] && (!inside(candidate, root) || sensitive(candidate, writes.has(name))))
    return { decision: 'deny', reason: 'AGY Bridge: acesso fora do projeto ou a arquivo protegido.' };
  if (writes.has(name) && protectedByProject(candidate, root))
    return { decision: 'deny', reason: 'AGY Bridge: caminho protegido pela configuracao do projeto.' };
  if (name === 'run_command') {
    if (process.env.AGY_BRIDGE_ACCESS !== 'write')
      return { decision: 'deny', reason: 'AGY Bridge: comandos indisponiveis em tarefa somente de leitura.' };
    if (args.BypassSandbox || args.RunPersistent || !inside(args.Cwd || root, root) || !safeCommand(String(args.CommandLine || '')))
      return { decision: 'deny', reason: 'AGY Bridge: comando nao permitido. Acoes criticas exigem decisao do orquestrador.' };
  }
  return { decision: 'allow' };
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let result;
  try { result = check(JSON.parse(input)); }
  catch { result = { decision: 'deny', reason: 'AGY Bridge: falha na validacao da ferramenta.' }; }
  process.stdout.write(JSON.stringify(result));
});
