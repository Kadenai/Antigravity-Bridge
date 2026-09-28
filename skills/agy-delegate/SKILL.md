---
name: agy-delegate
description: Delegue ao Antigravity CLI (Gemini 3.8 Flash), pelo AGY Bridge, a escrita de código e outras tarefas locais pesadas enquanto você segue trabalhando em outra parte. Use sempre que, construindo algo no dia a dia, surgir uma unidade com contrato claro que renda mais de umas 80 linhas (uma função com testes, um módulo novo, testes para código existente, código repetitivo, edições em muitos arquivos, documentação) ou uma pesquisa independente; use também quando o usuário disser "usa o AGY", "manda pro Gemini" ou quando o AGENTS.md do projeto pedir delegação.
---

# Delegação ao AGY no dia a dia

O AGY Bridge entrega trabalho ao Antigravity CLI, que roda sempre o **Gemini 3.8 Flash**. A divisão de papéis é fixa: você entende o pedido, desenha o contrato, verifica o resultado e responde ao usuário; o Flash digita. O ganho vem de duas fontes: tokens de saída que você não gasta e tempo em que você trabalha em paralelo. Uma delegação que vira espera parada, ou cujo pedido é mais longo que o código, perdeu o sentido.

## Quando delegar

Delegue uma unidade com **contrato verificável** e tamanho que compense:

- Uma função ou módulo cuja entrada, saída e casos de teste você consegue escrever em poucas linhas.
- Testes para código que já existe.
- Código repetitivo, adaptação de um padrão já presente no projeto, edições mecânicas em vários arquivos.
- Documentação, comentários de API, tradução de mensagens.
- Pesquisa na web ou leitura de uma base de código para juntar informação (`access: "read"`).

Faça você mesmo quando:

- A alteração tem menos de umas 80 linhas, ou explicá-la custaria mais que escrevê-la.
- A decisão depende de conversar com o usuário ou do histórico desta conversa.
- É depuração que exige navegador, sessão logada ou observar o sistema rodando.
- Toca o núcleo de autenticação, dados persistidos, pagamentos ou segurança. Nesses casos, o Flash pode no máximo escrever testes.
- O AGY já errou duas vezes na mesma unidade. Insistir custa mais que fazer.

**Modo Full:** se o usuário pedir que o AGY faça a execução principal, delegue toda parte executável e concentre-se em contrato, coordenação e revisão. Full não amplia permissões.

## Como escrever o pedido

1. Passe em `workspace` o **caminho absoluto do projeto ativo**, nunca a pasta do plugin. Sem pasta conhecida, pergunte ao usuário.
2. Se o projeto tiver `.agy-bridge.json` com `context`, o servidor já manda o AGY ler esses arquivos. Não repita o conteúdo deles; cite só o que for específico da tarefa.
3. Escreva o **contrato** antes do pedido: assinatura, o que recebe e devolve, erros esperados, casos de teste concretos, arquivos que a tarefa pode tocar e o critério de pronto. Se o contrato não couber em poucas linhas, a unidade ainda não está pronta para delegar.
4. Use este esqueleto, adaptando:

```
Objetivo: <uma frase>.
Contrato: <assinatura, entradas, saídas, casos de teste>.
Arquivos que você pode editar: <lista>. Não edite nenhum outro.
Siga o estilo do código vizinho: nomes, formatação, densidade de comentários.
Regras:
- Não mude comportamento fora do pedido; não renomeie, reformate nem "melhore" código alheio.
- Não invente funções, APIs ou dependências. Se algo necessário não existir, pare e relate.
- Não adicione dependências nem arquivos de configuração.
- Preserve acentos e a codificação dos arquivos.
- Não use subagentes.
Verificação: rode <comando de teste> e cole a saída real, inclusive falhas.
Resposta final curta: arquivos alterados, o que foi feito, saída dos testes, dúvidas e ações bloqueadas.
```

5. Chame `start_task` com `access: "write"` para produzir ou editar e `access: "read"` para investigação. `scope: "broad"` cria um commit de checkpoint antes de mudanças extensas (exige Git). `isolated: true` cria um worktree separado, mas exige o repositório limpo, o que raramente acontece no meio do trabalho; no dia a dia, prefira a divisão de arquivos descrita abaixo.

## Trabalhar em paralelo

- `start_task` devolve um `waitCommand`. **Rode-o em segundo plano** pelo terminal (Bash com `run_in_background`). Ele termina junto com a tarefa e o cliente acorda você com o resultado, sem nenhuma consulta de status no meio.
- Enquanto isso, trabalhe em **outros arquivos**: ligar a interface à função delegada, escrever a documentação, preparar a próxima unidade. Não edite os arquivos entregues ao AGY até ele terminar.
- Sem nada útil para fazer em paralelo, use `wait_task` em vez de chamar `task_status` repetidamente.
- Tarefas simultâneas só em unidades independentes, cada uma dona dos seus arquivos. O servidor roda até cinco AGY globais e serializa escritas na mesma pasta.

## Verificar em camadas

`success` significa que o executor terminou, não que o código está certo. Verifique do mais barato ao mais caro e pare quando a confiança bastar:

1. Leia `status`, `blockedActions`, `warnings` e `checks`. `needs_review` ou `error` exigem investigar a causa antes de qualquer uso.
2. Confira `changedFiles` contra os arquivos autorizados. Arquivo inesperado é sinal de que ele saiu do contrato. (Em pastas não Git esse campo vem nulo; se outra pessoa editou a mesma pasta durante a tarefa, a lista pode incluir essas edições.)
3. Rode você mesmo os testes e o build. Não confie na saída relatada.
4. Olhe o `diffStat`. Um diff muito maior que o esperado costuma indicar reformatação ou "melhoria" não pedida.
5. Leia linha por linha só o que tem risco: lógica condicional nova, tratamento de erro, ordem de carregamento, integração entre módulos.

Erros típicos do Flash para procurar primeiro: comportamento perdido ao mover código (um `return` antecipado, um caso raro, um listener), API inventada, mudanças extras fora do pedido, testes relatados como aprovados sem terem rodado e acentos corrompidos.

Para correção pontual, use `continue_task` na mesma conversa, citando o erro exato. Para abandonar, `cancel_task`. Em tarefa isolada, revise o worktree e só então chame `integrate_task`.

## Transparência

Sempre diga ao usuário, numa linha, o que foi delegado e como foi verificado, por exemplo: "A função `parseProcesso` foi escrita pelo AGY; testes e build passaram, revisei o tratamento de datas." Se você refez algo que o AGY entregou, diga também.

## Limites de autoridade

O AGY roda com aprovação automática somente dentro da política do guard. Ele pode ler, pesquisar e editar dentro do projeto e rodar apenas comandos de consulta Git, os testes e builds conhecidos e os comandos exatos listados em `commands` no `.agy-bridge.json`. O guard bloqueia subagentes, acesso fora do projeto, arquivos sensíveis, os caminhos em `protected` e ações como publicação, deploy, `git push` e reescrita de histórico. O AGY não pode editar o `.agy-bridge.json`.

**Não tente contornar o guard**, nem por prompt nem por comando alternativo. Se uma ação bloqueada for necessária, execute-a você mesmo, somente com a autorização e os cuidados que ela exigiria normalmente. Um checkpoint torna alterações amplas reversíveis, mas não autoriza uma ação irreversível.
