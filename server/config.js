// Project settings read from <workspace>/.agy-bridge.json when a task starts.
const fs = require('node:fs');
const path = require('node:path');

const fileName = '.agy-bridge.json';
const unsafeChars = /[\r\n;&|><`$%]/;
const unsafeWords = /\b(agy|antigravity|powershell|pwsh|cmd|bash|sh|python\s+-c|node\s+-e|rm|del|rmdir|rd|curl|wget|scp|ssh|deploy|publish|gh)\b/i;
const unsafeGit = /^git\s+(push|pull|fetch|reset|rebase|commit|checkout|switch|clean|restore|stash|merge|cherry-pick|tag|branch|remote|config|worktree|gc|filter-branch)\b/i;

function strings(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim()))
    throw new Error(fileName + ': "' + name + '" deve ser uma lista de textos.');
  return value.map(item => item.trim());
}

function relativeInside(item, name) {
  const normalized = item.replace(/\\/g, '/');
  if (path.isAbsolute(item) || normalized.split('/').includes('..'))
    throw new Error(fileName + ': "' + name + '" aceita apenas caminhos relativos dentro do projeto: ' + item);
  return normalized;
}

function loadProjectConfig(workspace) {
  const file = path.join(workspace, fileName);
  if (!fs.existsSync(file)) return { commands: [], protected: [], context: [] };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(fileName + ' invalido: ' + error.message); }
  const commands = strings(raw.commands, 'commands');
  for (const command of commands) {
    if (unsafeChars.test(command) || unsafeWords.test(command) || unsafeGit.test(command))
      throw new Error(fileName + ': comando recusado por seguranca: ' + command);
  }
  return {
    commands,
    protected: strings(raw.protected, 'protected').map(item => relativeInside(item, 'protected')),
    context: strings(raw.context, 'context').map(item => relativeInside(item, 'context'))
  };
}

module.exports = { fileName, loadProjectConfig };
