# AGY Bridge

Plugin local que combina a [skill de delegação](skills/agy-delegate/SKILL.md) com um servidor MCP para o Antigravity CLI (`agy`). O mesmo servidor pode ser usado por Claude Code, Claude Desktop e Codex no Windows. Ele mantém uma fila compartilhada entre esses clientes e executa no máximo **cinco processos AGY ao mesmo tempo**.

A skill orienta o modelo principal a delegar espontaneamente, no dia a dia, unidades de código com contrato claro (uma função com testes, um módulo, testes, código repetitivo) enquanto ele segue trabalhando em outra parte. Esse é o modo **Smart**. No modo **Full**, solicitado pelo usuário, o AGY faz a execução principal e o modelo principal coordena e revisa. A escolha de ativar a skill em uma conversa ainda depende do cliente e do modelo; o servidor MCP aplica os limites de execução independentemente dessa escolha.

## Requisitos

- Windows, Antigravity CLI instalado e autenticado; `agy` deve conseguir executar uma tarefa headless.
- Node.js 20 ou superior para Claude Code e Codex. Claude Desktop fornece o runtime para extensões Node.
- Git para tarefas amplas, worktrees e integração.
- O modelo `gemini-3.8-flash-high` deve estar disponível na conta do AGY. O servidor o seleciona explicitamente.

## Instalação

O repositório não inclui `node_modules`. Antes de instalar ou empacotar, rode `npm ci` na pasta do plugin.

Os formatos usam o mesmo código do servidor e compartilham o estado em `%LOCALAPPDATA%\agy-bridge`.

### Claude Desktop (aba Chat)

Em **Customize → Plugins**, use **Upload plugin** e selecione `agy-bridge-plugin.zip`. Esse ZIP contém **skill + MCP + dependências** para uma única instalação local. Se a política da sua conta impedir o carregamento do MCP local pelo plugin, instale também `agy-bridge.mcpb` em **Configurações → Extensões → Configurações avançadas → Instalar Extensão…**; nesse caso, desative a conexão MCP duplicada do ZIP se ela aparecer. O `.mcpb` sozinho fornece as ferramentas, mas não instala a skill na aba Chat. [Plugins no Claude](https://support.claude.com/en/articles/13837440-use-plugins-in-claude); [extensões locais](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

### Claude Code, inclusive no Claude Code Desktop

No Claude Code Desktop, instale pelo ZIP em **Plugins → Upload plugin**, como na aba Chat. No Claude Code CLI, para testar sem instalar: `claude --plugin-dir "C:\caminho\para\agy-bridge"`. A skill aparece como `/agy-bridge:agy-delegate` e pode ser acionada automaticamente pelo Claude quando a tarefa couber. [Instruções oficiais](https://code.claude.com/docs/en/plugins).

### Codex

```text
codex plugin marketplace add "C:\caminho\para\outputs"
codex plugin add agy-bridge@agy-bridge-local
```

O catálogo está em `outputs/.agents/plugins/marketplace.json`. Também é possível abrir o diretório de plugins no Codex Desktop após registrar o marketplace. Codex descobre a skill em `skills/agy-delegate/SKILL.md` junto com o MCP em `mcp.json`. [Instruções oficiais](https://developers.openai.com/plugins/build/plugins).

Após instalar ou atualizar o plugin, inicie uma conversa nova ou recarregue plugins no cliente para disponibilizar a skill e as ferramentas.

## Uso das ferramentas

`start_task` recebe `prompt` e `workspace`, que deve ser o caminho absoluto da pasta do projeto aberta no cliente. Exemplo:

```json
{
  "workspace": "C:\\Users\\Levi\\Desktop\\AndroidApp",
  "prompt": "Corrija o erro de validação do formulário e execute os testes pertinentes.",
  "access": "write",
  "scope": "ordinary",
  "isolated": false
}
```

O servidor inicia AGY **dentro dessa pasta**. Em Claude Desktop, uma conversa comum pode não ter uma pasta de projeto ativa; nesse caso, forneça o caminho ao chamar a ferramenta. O cliente precisa transmitir esse caminho: o processo MCP fica instalado em outro diretório e não pode inferir com segurança qual pasta está aberta na interface.

Ferramentas disponíveis:

| Ferramenta | Função |
| --- | --- |
| `start_task` | Enfileira uma tarefa de leitura ou escrita. |
| `task_status` | Retorna estado, resposta, uso, verificações, avisos, arquivos alterados, resumo do diff e caminhos dos logs. |
| `wait_task` | Espera a tarefa terminar (até 10 minutos) e devolve o mesmo que `task_status`. |
| `list_tasks` | Mostra as tarefas recentes dos três clientes. |
| `continue_task` | Envia outro pedido à conversa AGY de uma tarefa concluída. |
| `cancel_task` | Cancela uma tarefa em fila ou em execução. |
| `integrate_task` | Integra por cherry-pick uma tarefa isolada concluída. |

`scope: "broad"` exige a raiz de um repositório Git. Se houver alterações locais, o servidor cria um **commit de checkpoint antes de iniciar**. Arquivos que parecem conter segredos bloqueiam esse checkpoint automático. `isolated: true` cria um worktree Git separado; a pasta principal precisa estar limpa. Os arquivos do worktree só chegam à pasta principal quando o orquestrador chama `integrate_task` após revisar o resultado.

AGY pode ler arquivos `.md` pertinentes dentro do projeto, inclusive `AGENTS.md` e `GEMINI.md`. A skill instrui o orquestrador a transmitir somente o contexto necessário, sem despejar todos os Markdown no prompt. Skills globais fora da pasta do projeto são bloqueadas pelo guard.

### Esperar sem consultar

`start_task` devolve um `waitCommand` (`node ".../server/wait.js" <taskId>`). Rodado em segundo plano pelo terminal do cliente, ele termina junto com a tarefa e imprime o resultado; no Claude Code, isso acorda o modelo principal sem nenhuma consulta intermediária. Códigos de saída: `0` sucesso, `1` `needs_review`/`error`/`canceled`/`interrupted`, `2` tempo esgotado (padrão de uma hora, ou o segundo argumento em segundos), `3` tarefa inexistente. Quando não há nada a fazer em paralelo, `wait_task` cumpre o mesmo papel dentro do MCP.

### Arquivos alterados

Em tarefas de escrita num repositório Git, o servidor registra o conteúdo dos arquivos pendentes antes de iniciar e compara ao fim. `changedFiles` lista só o que mudou durante a tarefa, mesmo que a pasta já tivesse alterações; `diffStat` é o `git diff --stat HEAD` desses arquivos (arquivos novos não rastreados aparecem apenas em `changedFiles`). Edições feitas por outra pessoa na mesma pasta durante a tarefa também entram na lista. Fora do Git, os dois campos vêm nulos.

## Configuração por projeto

Um arquivo `.agy-bridge.json` na raiz do projeto ajusta a política para aquele repositório. Ele é lido quando cada tarefa começa:

```json
{
  "commands": ["npm run check:content", "npm run check:editor", "npm run check:viewer"],
  "protected": ["dist/", "pdfjs/", "firebase-*.js"],
  "context": ["AGENTS.md"]
}
```

- `commands`: comandos **exatos** somados à lista permitida. Não aceita padrões nem argumentos variáveis. O servidor recusa o arquivo inteiro se algum comando tiver encadeamento, redirecionamento, variáveis ou palavras como `rm`, `curl`, `deploy`, `publish`, `git push` e afins. Um comando listado executa o que o script do projeto fizer, dentro do sandbox do AGY.
- `protected`: caminhos relativos que o AGY não pode editar pelas ferramentas de arquivo. Aceita pasta (`dist/`), arquivo e curingas (`*` dentro de um nível, `**` em qualquer profundidade). Não impede que um comando permitido, como um build, grave nesses caminhos.
- `context`: arquivos que o AGY deve ler antes de começar. O servidor acrescenta esse aviso ao início do pedido, só na primeira mensagem da conversa.

O AGY nunca pode editar o `.agy-bridge.json`.

## Ativar a delegação num projeto

A skill é acionada quando o modelo principal julga que a tarefa cabe nela. Para torná-la o comportamento padrão num repositório, acrescente ao `AGENTS.md` (ou `CLAUDE.md`) do projeto:

```text
Neste projeto, delegue ao AGY Bridge (skill agy-delegate) a escrita de unidades de código com contrato claro e mais de umas 80 linhas, seguindo o roteiro da skill.
```

## Execução e verificação

Cada tarefa usa `agy -p <prompt> --output-format stream-json --model gemini-3.8-flash-high --sandbox --mode accept-edits --dangerously-skip-permissions`. Um hook `PreToolUse` instalado pelo servidor limita as ferramentas antes de cada chamada. O executor confirma que o hook está ativo antes de iniciar a tarefa; caso contrário, cancela a execução. O hook bloqueia subagentes, ações externas, comandos de shell não autorizados e acesso a arquivos fora do projeto. Consulte [SECURITY.md](SECURITY.md) para a política exata.

O servidor registra o stream JSON e executa `git diff --check` ao fim de tarefas de escrita em repositórios Git. Alguns comandos conhecidos de teste e build são permitidos ao AGY dentro do sandbox. O resultado da ferramenta não equivale a uma revisão de código completa: o orquestrador deve escolher testes adicionais e revisar alterações de maior risco. O status `needs_review` indica erro de ferramenta relevante ou falha de verificação; uma leitura externa negada aparece em `warnings`.

Os prompts, respostas e logs ficam em `%LOCALAPPDATA%\agy-bridge`. O limite de cinco é global enquanto todos os clientes usam esse diretório padrão.

## Desenvolvimento

```text
npm ci
npm test
claude plugin validate .
```

Os testes usam um AGY simulado e validam o protocolo MCP, a fila global e o bloqueio de ferramentas. As novidades da versão 0.3.0 (configuração por projeto, espera e registro de arquivos alterados) ainda não têm testes próprios. A validação manual nesta máquina também confirmou uma edição real de arquivo pelo AGY. O pacote `.mcpb` é gerado com `mcpb pack`; o ZIP é o diretório completo do plugin com os arquivos na raiz do arquivo compactado.
