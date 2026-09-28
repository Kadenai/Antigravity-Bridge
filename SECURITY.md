# Política de execução

## Permitido ao AGY

- Ler e pesquisar arquivos dentro da pasta do projeto informada, incluindo Markdown de instruções.
- Editar arquivos do projeto por ferramentas de arquivo quando `access` é `write`.
- Pesquisar a web e ler páginas públicas.
- Executar, dentro do sandbox, somente comandos de consulta Git, comandos de teste/build previamente enumerados no guard e os comandos exatos listados em `commands` no `.agy-bridge.json` do projeto.

## Bloqueado pelo hook

- Qualquer subagente ou ferramenta de coordenação interna do AGY.
- Ferramentas desconhecidas, interação externa por navegador ou MCP, pedidos de mais permissões e agendamentos.
- Leitura ou escrita fora do diretório da tarefa; alteração de `.git`, `.agents`, `.gemini`, `.env`, `.agy-bridge.json`, dos caminhos em `protected` e de formatos comuns de chave privada.
- Comandos arbitrários de terminal, inclusive publicação, deploy, `git push`, reescrita de histórico, remoção em massa, encadeamento de comandos, comandos persistentes e `BypassSandbox`.

O AGY roda com aprovação automática **somente depois** da checagem de que o hook está ativo. A política `PreToolUse` retorna `deny` para ferramentas fora da lista permitida. Se uma ação bloqueada for realmente necessária, o AGY relata a necessidade ao orquestrador; o MCP não oferece um comando para desativar o bloqueio. O orquestrador avalia a ação e executa em seu próprio ambiente depois do checkpoint ou da autorização apropriada.

O sandbox do AGY no Windows protege os **comandos de terminal**. O hook limita também as chamadas de edição de arquivo do AGY. Essa combinação não é uma garantia formal contra código malicioso no próprio projeto, scripts de teste com efeitos inesperados ou alterações na configuração do AGY durante uma tarefa. Para mudanças extensas, use `scope: "broad"` para criar um checkpoint Git; para concorrência no mesmo repositório, use `isolated: true` e revise antes da integração.

O `.agy-bridge.json` é lido pelo servidor, não pelo AGY, no início de cada tarefa, e chega ao hook já validado. Comandos listados nele passam pelos mesmos filtros de encadeamento e caracteres especiais e por uma lista de palavras recusadas; ainda assim, eles executam o que o script do projeto definir. Liste apenas scripts cujo conteúdo você conhece.

O hook global fica em `~/.gemini/config/hooks.json`, com o nome `agy-bridge-guard`. Fora de uma tarefa AGY Bridge ele responde `allow` e não muda a política de sessões AGY normais. O guard é copiado para `%LOCALAPPDATA%\agy-bridge\guard.cjs` e atualizado quando uma tarefa é iniciada.
