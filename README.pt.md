# dsh-browser-cdp — O navegador do agente visível (conexão CDP)

[简体中文](README.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Italiano](README.it.md) | [Русский](README.ru.md) | [Español](README.es.md) | [Português](README.pt.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue" alt="DSH >= 0.2.0-rc.1">
  <img src="https://img.shields.io/badge/DSH--better--sidebar-%3E%3D0.12.2(optional)-red" alt="dsh-better-sidebar >= 0.12.2 (optional)">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?logo=node.js&logoColor=white" alt="Node >= 22">
</p>

> **Repositório**: `github.com/drscrewdriver/dsh-browser-cdp` ｜ Histórico de versões: ver [CHANGELOG.md](CHANGELOG.md)

### Matriz de compatibilidade de versões

| Dependência | Versão mínima | Versão recomendada | Notas |
|---|---|---|---|
| **DSH** (DeepSeek Harness) | `0.2.0-rc.1` | `≥ 0.2.0-rc.1 <0.2.1-0` | Linha 0.2.0: as peer dependencies são fixadas de forma sincronizada em `>=0.2.0-rc.1 <0.2.1-0`; o host mantém retrocompatibilidade com a API de plugins (o composer/`forkSession` de 0.2.0 é uma extensão de assinatura, o plugin é apenas chamador, sem mudanças necessárias). A superfície de ajustes declarativa introduzida desde 0.1.7 (campos Config `.volatile()` que geram automaticamente o formulário de ajustes) continua no 0.2.0. Para DSH `0.1.2-rc.1` ~ `0.1.7` use a linha **0.17.x**; para 0.1.0-rc.x / 0.1.1-rc.x use v0.8.0 ou anterior |
| **dsh-better-sidebar** | `0.12.2` (opcional) | `≥ 0.17.1` | Sem ele, retrocesso automático à esfera de observação flutuante; `< 0.12.2` funciona, mas a interceptação de links externos (`urlTarget`) se degrada silenciosamente |
| **Node.js** | `22` | — | Incluído com o ambiente do harness |

**Notas de adaptação a todas as versões do DSH**: esta versão (**desde v0.18.0, linha 0.2.0**) aponta para DSH `0.2.0-rc.1+`: em relação à linha 0.1.7 (v0.17.x) **zero mudanças de código**, apenas troca de dependências/metadata — o host 0.2.0 é retrocompatível com a API de plugins, e este plugin entrega as seleções pela fachada `ctx.get('conversation').input` (sem chamar `submit()`, sem override), ficando fora do alcance das mudanças de 0.2.0. A superfície de ajustes declarativa, introduzida no 0.1.7, funciona assim: o plugin não registra mais nenhuma seção de ajustes (a API de registro `ctx.settings` foi removida pelo host); em vez disso, os campos configuráveis são marcados com `.volatile()` no esquema Config e a página de ajustes do host gera o formulário automaticamente; mudanças nos campos volatile têm efeito quente via o evento `loader/volatile-update`, sem recarregar o plugin. As APIs essenciais do host (`defineTool`, `ctx.tools.register`, `ctx.subprocess.spawn`, `ctx.webServer.register`, `ctx.inject`, a fábrica CJS `ModuleLoader`, `cordis.patch.yml`) conservam sua forma desde 0.1.2. Para DSH `0.1.2-rc.1` ~ `0.1.7` use a linha **0.17.x**.

**Notas de adaptação ao dsh-better-sidebar**: este plugin registra uma aba na barra lateral e escuta os links externos pelo serviço `ctx.betterSidebar` (obtido de forma defensiva com try-catch). Versões de introdução das APIs-chave:

| API | Uso neste plugin | Versão de introdução no better-sidebar |
|---|---|---|
| `registerTab()` / `openTab()` / `ctx.betterSidebar` | Registro + abertura de aba | v0.9.0+ |
| `TabDescriptor.single` | Aba de instância única | v0.9.0+ |
| `TabDescriptor.urlTarget` | Interceptação de links externos | **v0.12.2+** (abaixo disso, a interceptação de links falha silenciosamente) |

---

**Detalhes do suporte a versões do DSH**: principais mudanças de v0.8.2 → v0.8.3: fusão de 6 PRs da comunidade (adaptação root/xvfb/macOS headless, compatibilidade rc.1, estabilidade no Windows), correção da vulnerabilidade das rotas `/api/bcdp/*` sem autenticação, da falha de inicialização do cliente em hosts sem dsh-better-sidebar (#29), da regressão de inicialização a frio no Windows (falsa detecção de Xvfb introduzida pelo #22) e da ausência de `runtimeArgs`/`chromeArgs` na lista branca de ajustes da gateway. Pontos de adaptação: renomeação do runtime do cliente (`@deepseek-ai/dsh-client-store`), id de registro do módulo cliente e nome da linha de carga conforme o nome declarado do pacote, `dsh.client.inject` declarando apenas linhas reais do grafo de módulos, `webServer` entregue por injeção aninhada (serviço opcional) e sincronização com o modo aba da barra lateral (dsh-better-sidebar).

**Suporte a barra lateral ([dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar))**: quando o host tem `dsh-better-sidebar` instalado (recomendado ≥ v0.12.2), a janela de observação em tempo real é registrada como **aba nativa da barra lateral** — «Navegador do agente» aparece no menu «+» da barra lateral, abre com um clique e fica ancorada junto à gaveta da barra lateral; a aba abre automaticamente na primeira chamada do agente a uma ferramenta `bcdp_*` (desde v0.8.5 a abertura é restrita à sessão chamante — em multi-sessão ela não aparece mais na sessão errada). Sem `dsh-better-sidebar`, há retrocesso automático ao modo **esfera de observação flutuante** no canto inferior direito (`#dsh-ego-fab`). As duas formas compartilham o mesmo conjunto de capacidades: streaming SSE em tempo real / clique / entrada / captura de downloads. A janela de observação oferece ainda um botão «Pop-out»: o navegador do agente rodando headless é substituído com um clique por uma janela com interface do mesmo Profile (as abas são preservadas), útil para assumir o controle manualmente.

**Importação de estado de sessão (novidade na v0.8.5)**: a ferramenta `bcdp_login_import` copia **por domínio** os cookies de sessão do seu Chrome/Edge/Brave cotidiano para o navegador do agente (inicialização headless do binário real + leitura transparente via CDP, compatível com a App-Bound Encryption do Chrome 127+, sem decodificação offline; se o navegador de origem estiver em execução, ele pode ser fechado elegantemente antes da importação, e a janela é restaurada no próximo início). Os valores dos cookies não aparecem em nenhum log ou saída; antes de importar, a base de cookies de origem é respaldada automaticamente e restaurada em caso de esvaziamento anômalo. Combinado com o Profile persistente em disco por padrão, o estado de sessão importado sobrevive a reinícios de forma permanente.

Um **proxy de navegador CDP**: incorpora uma runtime compatível com ego (um Chromium para agentes de IA; procedência e licença em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) no DeepSeek Harness, controla o navegador com **38 ferramentas estruturadas `bcdp_*`** e o acompanha de um **frontend de observação em tempo real** — enquanto o agente opera páginas em segundo plano, você vê cada página que ele visita como uma transmissão ao vivo e pode até intervir diretamente.

**Uma particularidade própria (self-observation)**: o agente usa precisamente este Chromium — mesmo quando controla **o próprio DSH** (gestão de sessões, painel de tarefas, ajustes), a janela de observação mostra tudo ao vivo e você pode assumir o controle a qualquer momento. Não se trata apenas de «ver o agente trabalhar na web»: até a manipulação da própria interface do DSH pelo agente é integralmente visível e controlável.

**Pronto para usar**: o pacote do plugin traz uma runtime compatível com ego (`runtime/`, MIT de terceiros, ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — sem navegador adicional, sem compilação manual; o wrapper `--no-sandbox` vem com o pacote: root / Docker / máquinas sem tela iniciam em um passo.

---

## Nossas vantagens reais (não slogans, mas capacidades verificáveis no código e diante da concorrência)

Outros plugins que conectam o ego ao DSH extraem dele apenas **3 ferramentas** — um script `run`, um guia `help`, uma checagem `status` — e o navegador continua sendo uma **caixa-preta em segundo plano**. Este plugin segue outro caminho: **abrir a caixa-preta e, desde o primeiro momento, dar plenamente as capacidades de «ver» e de «controlar»**.

| Capacidade | Este plugin (este repositório) | Plugin similar |
|---|---|---|
| Número de ferramentas estruturadas | **38**, responsabilidade única, invocação determinística | **3** (`run`/`help`/`status`) |
| Janela de observação em tempo real (duplo backend CDP JPEG / FFmpeg H.264 + barra de abas + gaveta de histórico) | ✅ Sim | ❌ Não |
| Manipulação **direta** com o mouse do navegador real a partir da janela de observação (clique/arrastar/scroll devolvidos ao CDP) | ✅ Sim | ❌ Não |
| **Seleção de um elemento na janela de observação → captura e referência no campo de entrada da conversa** (bloqueio estruturado `[CDP-PICKS]`, sinalização manual do alvo) | ✅ Sim | ❌ Não |
| Guarda de instância única do worker + autorreparação de travamentos/duplicatas | ✅ Sim | ❌ Não |
| Captura de downloads `bcdp_download` / detecção de captchas `bcdp_captcha`/`bcdp_page_info` | ✅ Sim | ❌ Não |
| Adaptação a plataformas (detecção automática Linux/macOS/Windows + retrocessos root/headless/`--no-sandbox`) | ✅ Todas as plataformas | Somente host de pré-visualização Windows, configuração manual |
| Persistência em disco do estado de sessão `bcdp_auth_flush` | ✅ Sim | ⚠️ Apenas menção em nível de documentação |

**Três diferenças-chave:**
- **Ver**: nos outros casos é uma caixa-preta que «ao termina conta o resultado»; nós transmitimos ao vivo — **você vê o agente operar** e detecta na hora se ele trava num captcha ou pega um caminho errado.
- **Controlar**: nos outros casos só leitura; nossa janela de observação **manipula diretamente** o mesmo navegador do agente — se precisar, você assume o controle (zoom/arrastar/clique), sem interromper o agente nem recomeçar.
- **Apontar com precisão**: você **seleciona** um elemento da página na janela de observação; o plugin captura seu `backendNodeId`/`tag`/`id` e descrição semântica, e o incorpora como bloqueio estruturado `[CDP-PICKS]` ao rascunho do campo de entrada da conversa (seleções múltiplas na mesma página são mescladas e numeradas automaticamente) — o agente recebe um alvo exato, sem precisar adivinhar «a que botão você se refere».

> A comparação acima baseia-se em fatos públicos verificáveis: o código deste repositório (`bin/cdp-cast-worker.mjs` streaming em tempo real + devolução de entradas CDP, `lib/index.js` com 38 ferramentas registradas, `lib/cast-server.js` ponte para o host, `deliverPickToConversation` em `lib/client.js` para as referências de seleção) e o código-fonte/README publicamente visível do plugin similar. Este documento não menospreza ninguém — apenas afirmamos quais capacidades implementamos e verificamos além delas.

**Diante da própria runtime incorporada (um CLI headless), isto é o que acrescentamos (tudo verificável no código deste repositório):**

| Capacidade | Descrição (código correspondente) |
|---|---|
| **Frontend de observação** | A runtime incorporada sozinha é um CLI headless (apenas scripts heredoc + saída textual); acrescentamos **streaming SSE em tempo real + barra de abas + gaveta de histórico + manipulação direta com o mouse a partir da janela de observação + seleção de elementos com referência no campo de entrada** (`bin/cdp-cast-worker.mjs`, `lib/cast-server.js`, `createPickControl`/`deliverPickToConversation` em `lib/client.js`), convertendo «ver», «controlar» e «apontar» em capacidades de primeira classe |
| **Pronto para usar + autossuficiente em todas as plataformas** | `resolveEgoEnv` detecta automaticamente Chrome/Edge/Brave, wrapper `--no-sandbox` embutido, zero configuração sob root / Docker / sem tela (`lib/index.js`); não é preciso instalar antes um host GUI |
| **Camada de robustez** | Tentativas automáticas na inicialização a frio (só se repetem falhas CDP transitórias, erros reais não são engolidos), guarda de instância única do worker + reinício automático após travamento, teardown do plugin em fire-and-forget sem bloquear a saída do host, teto do cache de quadros no frontend (`withWarmupRetry` / `makeEnsureWorker` / `frameCache`) |
| **Ferramentas de operação** | `bcdp_doctor` (diagnóstico do ambiente), `bcdp_captcha` (detecção de captcha), `bcdp_auth_flush` (persistência de sessão), `bcdp_login_import` (importação de sessão do navegador do sistema), `bcdp_http` (requisições no contexto do navegador), etc. — uma camada que os helpers do CLI nativo não oferecem |
| **self-observation** | Mesmo quando o agente controla a própria interface do DSH, tudo é visível ao vivo e o controle pode ser assumido |

> Não pretendemos igualar os snapshots a nível de kernel nem a experiência multiwindow nativa do app de macOS; este repositório resolve: «trazer as mesmas capacidades de navegador ao DSH + Linux/WSL — e torná-las visíveis».

---

## Que problema resolve

Navegadores comuns não foram pensados para agentes, e grande parte das interações web (estados de sessão, captchas, renderização dinâmica, formulários, sites que exigem sessão humana) só pode ser enfrentada com um navegador real — é a intenção do ego: **«deixar o agente usar o seu navegador já com sessão iniciada, sem te incomodar»**, que este plugin leva ao DSH.

Este plugin o conecta ao DSH e resolve o ponto mais doloroso — **você não vê o que o agente faz nem pode intervir** — com uma janela de observação:

> 🌐 Um clique na bolinha abre a transmissão; 🟦 barra de abas para trocar/fechar; 🕘 gaveta de histórico para revisar; 🔍 zoom e deslocamento; 🖱️ assumir diretamente o controle do navegador real a partir da janela. **Em uma frase: o agente trabalha no navegador, você vê tudo e pode assumir o controle a qualquer momento.**

### Alguns cenários típicos de início

- **Documentação / coleta de dados**: peça ao agente para entrar no CNKI / Google Scholar e coletar página a página; pela janela de observação você vê ele rolar, clicar em «próxima página», baixar PDFs — se travar no caminho, você percebe na hora.
- **Formulários e sessões**: o agente preenche um formulário pela metade, na janela de observação aparece um captcha — você assume o controle, resolve o captcha e devolve o comando ao agente para continuar.
- **QA / testes de fumaça**: peça ao agente para percorrer com cliques o seu próprio produto; a janela de observação vira uma «gravação de tela que fala», com o adicional da revisão do histórico.
- **Ver o agente controlar o próprio DSH** (self-observation): quando o agente gerencia sessões / ajusta os ajustes, tudo é visível na janela de observação e você pode intervir.

---

## Pré-requisitos

| Requisito | Notas |
|---|---|
| Node ≥ 22 | Incluído com o ambiente do harness |
| **Qualquer Chrome / Chromium / Brave / Edge** | Detecção automática, ou `EGO_LINUX_CHROME` para indicá-lo; sob root com o wrapper incluído |
| DSH + dshx | Mecanismo de carregamento de plugins |
| DSH Web com interface gráfica (para a janela de observação) | Sessões headless continuam podendo usar as ferramentas `bcdp_*`, simplesmente sem janela de observação |

## Instalação

**Método 1: instalação direta do GitHub (recomendado)**

```sh
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp
# Também se pode fixar a um commit / tag específico:
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp#v0.9.0
```

> A instalação `github:` obtém o tarball do repositório via pnpm passando por `codeload.github.com`, **sem publicar nada no registro npm**; usa diretamente o `lib/` **pré-compilado e versionado** do repositório (`files` contém apenas `lib/`, `bin/`, `runtime/`, `cordis.patch.yml`, `dsh-plugin.json`), por isso **nenhum script de build é ativado** e devDependencies não são necessárias. A entrada do host `lib/index.js`, o cliente `lib/client.js` e o worker `bin/cdp-cast-worker.mjs` são todos distribuídos com o repositório.

**Método 2: tarball local / URL git**

```sh
dshx install dsh-browser-cdp <dsh-browser-cdp.tgz>      # tarball ou URL git, ambos válidos
dshx list                                                # deve mostrar: [on] dsh-browser-cdp
```

> **Nota sobre a renomeação do pacote**: o nome do pacote deste plugin é **`dsh-browser-cdp`** (nomes anteriores: `dsh-ego-browser`, alias `@dsh-external/ego-browser`). Desde o DSH Desktop 2.0.5 existe uma checagem de coerência «nome de dependência do profile == nome real do pacote»: se o profile ainda referencia o nome antigo, a inicialização cai em modo de recuperação. Após atualizar, renomeie **tanto** a chave de dependência no `package.json` do profile **como** a entrada em `dsh.profile.bundles` para `dsh-browser-cdp`:

   ```diff
   - "dsh-ego-browser": "<fonte github anterior>",
   + "dsh-browser-cdp": "github:drscrewdriver/dsh-browser-cdp",
   ```

   ```diff
   - "dsh-ego-browser",
   + "dsh-browser-cdp",
   ```

Nos ajustes da janela de observação podem ser escolhidos `captureBackend=auto|cdp|ffmpeg` (padrão `auto`, atualmente resolvido para CDP), os níveis de qualidade, FPS/qualidade JPEG/largura máxima do CDP, bem como FPS/largura máxima/bitrate/codificador/caminho personalizado do FFmpeg. O plugin verifica primeiro o caminho personalizado, o PATH do sistema e o cache gerenciado; o download do GitHub pode substituir `https://github.com` por `githubMirror`, por exemplo `https://gh-proxy.com/github.com`. O bitrate do FFmpeg vai de 500 a 20000 kbps, com padrões 2000/4000/8000 kbps para os níveis baixo/equilibrado/alto.

Sem nenhuma configuração do lado do host: `resolveEgoEnv` detecta automaticamente root / ausência de tela e aplica os retrocessos. As rotas do host para a janela de observação (`/api/bcdp/spaces` etc.) só são registradas se existir um servidor HTTP; em headless são um no-op seguro.

## Formas de conexão: endpoint CDP / CLI ego local

A lista de conexões do painel de ajustes é **ordenada** — **a ordem é a prioridade**, e o item ativado governa cada chamada `bcdp_*`. Há dois tipos de itens:

| Tipo | O que faz | Restrições |
|---|---|---|
| **Endpoint CDP** | Passa ao runtime incorporado (injeção de `EGO_LINUX_CDP_URL`) o endereço de um navegador com porta de depuração já aberta, e ele se **adere** a ele | Vários permitidos |
| **CLI ego local** | O CLI ego da máquina gerencia **por si mesmo** o seu navegador ego local — **nenhum endpoint é injetado** | **Somente máquina local, no máximo um em nível global** |

**Por que o segundo tipo existe**: o `EGO_LINUX_CDP_URL` injetado é um contrato privado da **runtime incorporada (linha Linux)**; o `ego-browser` nativo que acompanha o app `ego lite` no macOS **simplesmente não o lê**. Se «endpoint CDP» fosse o único tipo, usuários de macOS não poderiam aproveitar seu ego já com sessão iniciada — teriam que conectar a uma porta remota ou deixar a runtime incorporada iniciar um Chromium comum. O tipo CLI local fecha exatamente essa lacuna.

Ordem de resolução (com `cliPath` vazio): caminho explícito → `ego-browser` no PATH → helper dentro do pacote do app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime incorporada do plugin.

Dois padrões que vale conhecer:

- **`--sdk-path` está desativado por padrão**: por padrão usa-se o harness que o CLI traz; só ao ativá-lo o pacote harness deste plugin é injetado. Se o CLI não reconhecer esse flag, o plugin registra uma pista e **repete automaticamente uma vez sem ele** — toda a cadeia não fica por isso inutilizada.
- **A sonda de disponibilidade passa uma vez por um heredoc real** (o mesmo canal usado para o trabalho real), portanto **não é gratuita**: a sonda pode desencadear a inicialização a frio do navegador subjacente (medidos ~1,3 s com a runtime incorporada).

Relação com outros interruptores:

- `cdpMode`: `auto` segue o item ativado (ambos os tipos valem); `remote` **só aceita endpoints CDP** e avisa explicitamente `mode-kind-mismatch` se o item ativado for um CLI local; `local` passa pelo lançador local gerenciado.
- `remoteEnabled` (interruptor geral remoto) **só governa o CDP remoto**, sem efeito sobre as conexões CLI locais.
- `allowLocalFallback` / `localHeadless` / `localUserDataDir` atuam apenas sobre o retrocesso dos endpoints CDP e os inícios gerenciados.

`bcdp_doctor` informa a contagem de tipos da sequência atual, o caminho realmente resolvido do CLI e sua forma, bem como (se a antiga `dsh-ego-browser` estiver instalada na mesma máquina) um aviso de coexistência.

## Lista de ferramentas (38, prefixo `bcdp_`, índice completo em `bcdp_help`)

| Categoria | Ferramentas |
|---|---|
| Espaços de tarefas | `bcdp_space` (open/close/list/handoff/takeover) `bcdp_status` |
| Leitura de páginas | `bcdp_snapshot` (árvore semântica) `bcdp_page_info` `bcdp_read_element` |
| Navegação/espera | `bcdp_navigate` (reutiliza a aba) `bcdp_wait` (duration/selector/url/response/load/function/request/event) |
| Interação | `bcdp_click` `bcdp_fill` `bcdp_hover` `bcdp_drag` `bcdp_select` `bcdp_check` `bcdp_key` `bcdp_scroll` |
| Execução/depuração | `bcdp_js` (avaliação na página) `bcdp_cdp` (CDP cru) `bcdp_script` (heredoc; verbatim = raw, sem preâmbulo) |
| Saídas | `bcdp_screenshot` `bcdp_download` `bcdp_upload` |
| Sessão/segurança | `bcdp_auth_flush` (persistência de sessão) `bcdp_login_import` (importação de sessão entre navegadores) `bcdp_captcha` `bcdp_dialog` |
| Metaferramentas | `bcdp_help` `bcdp_doctor` `bcdp_http` |
| Revisão (JEV/Laya, serviço externo de julgamento opcional) | `bcdp_jev_status` `bcdp_jev_frame` `bcdp_jev_ask` `bcdp_jev_run` `bcdp_jev_attempt` |

## Como usar a janela de observação

A **🌐 bolinha permanente** no canto inferior direito → clique para abrir:

- **Vista principal**: transmissão ao vivo da página atual do agente; clique/arrastar/roda atuam diretamente sobre a página, Ctrl+roda para zoom, Ctrl+arrastar para deslocar, duplo clique para restaurar. Após um clique na vista, pode-se digitar diretamente com o teclado: IME chinês, colar, Tab/Enter/setas e atalhos Ctrl/Cmd suportados.
- **Seleção de elemento** (referência por seleção): pressione o botão da barra de ferramentas para entrar no modo seleção e clique em qualquer elemento da vista ao vivo — o plugin captura seu `backendNodeId`/`tag`/`id` e descrição semântica, e o incorpora como bloqueio estruturado `[CDP-PICKS]` ao rascunho do campo de entrada da conversa; seleções múltiplas na mesma página são mescladas automaticamente no mesmo bloqueio e numeradas em sequência, e o agente as usa com precisão pelo número. Funciona tanto na bolinha flutuante quanto na aba da barra lateral.
- **Barra de abas**: linha horizontal no topo, clique para trocar, `×` para fechar.
- **Gaveta de histórico** (🕘): revisar o rastro de visitas em ordem cronológica.
- Durante as ações, a linha de URL embaixo mostra os avisos no local e se restaura em 2 segundos.
- Após fechar o painel, ocultar a aba da sidebar ou desmontar o componente, a produção de imagens para ao fim da cortesia de 1,5 segundos. Que a janela do DSH passe para segundo plano sozinha não interrompe o streaming, para evitar reconstruir WGC/FFmpeg repetidamente ao voltar ao primeiro plano; um fechamento anômalo fica coberto pelo prazo de graça do lease do worker de 120 segundos.

### Backends de imagem

- `cdp`: JPEG via `Page.startScreencast`, 20 FPS por padrão. Cada quadro-fonte é imediatamente reconhecido (ACK) com o ID de quadro fornecido pelo Chrome; só o último quadro pendente é mantido; só a aba sendo vista é capturada, e páginas estáticas voltam por padrão a uma captura a cada 3 segundos.
- `ffmpeg`: no Windows `gfxcapture(hwnd)` captura diretamente a superfície D3D11 da janela Chrome alvo; nas demais plataformas usa-se um recorte da fonte de tela. Depois codificação H.264 fragmented MP4 → pedaços binários HTTP → MediaSource `<video>`, sem passar por Base64/SSE.
- `auto`: por padrão o CDP é escolhido; se a detecção falhar, o FFmpeg não é baixado automaticamente. O FFmpeg só é selecionável após instalado e superada a checagem de capacidades; se um backend FFmpeg salvo deixar de ser válido, a sessão de observação retrocede ao CDP mostrando o motivo.
- No Windows o FFmpeg deve incluir `gfxcapture`. O plugin emparelha o HWND pelo PID do navegador, o título do target e os limites de janela CDP; a captura da página alvo continua mesmo que a janela seja movida ou fique coberta, e é proibido retroceder à gravação da área de trabalho. Se o alvo for uma aba em segundo plano da mesma janela Chrome, um erro explícito é emitido em vez de mostrar a aba visível ou roubar o foco. No macOS a permissão «Gravação de Tela» é necessária no primeiro uso; no X11 Chromium e FFmpeg devem compartilhar o mesmo `DISPLAY`; no Wayland, ante a falta de entrada Portal/PipeWire, aparece um aviso para voltar ao CDP.

A instalação gerenciada de FFmpeg vai para `~/.dsh/cache/ego-browser/ffmpeg/`, sem escrever nada no diretório do plugin. Windows/Linux usam uma tag de release BtbN fixa; macOS usa assets fixos do release do GitHub `ffmpeg-static` (seus binários Intel/Apple Silicon procedem, respectivamente, de Evermeet/OSXExperts). Todos os downloads fixam o SHA-256 do recurso; só o executável principal do FFmpeg é extraído, sem instalar `ffprobe` nem `ffplay`. Em Windows/Linux o desempacotamento usa o `tar` do sistema; se faltar, um erro explícito aparece antes do download.

> Nota sobre o estado de sessão: os cookies dos espaços de tarefas são isolados entre si — inicie sessão no espaço correspondente. Após reiniciar o DSH, o estado de sessão em execução é apagado (os cookies de execução do Chrome só são escritos em disco ao fechar elegantemente), será preciso iniciar sessão de novo — escanear o QR code é rápido.

## Como funciona

- **Camada de ferramentas**: cada ferramenta arma seus parâmetros num script JS, que é entregue por stdin ao `ego-browser nodejs` via `ctx.subprocess`, com o host manejando o Chromium compartilhado por CDP. Os resultados são analisados graças à linha sentinela `@@DSH_RESULT@@`. Todos os `bcdp_*` são serializados com um mutex dentro do processo, e os erros são normalizados de forma uniforme.
- **Janela de observação**: `lib/client.js` gerencia o lease do watcher, o `<img>` JPEG e o `<video>` MSE; `lib/cast-server.js` retransmite o SSE de metadados, a API watch e o vídeo binário com contrapressão; no worker, o `CaptureManager` garante um único backend ativo e um único target atual. O plano de controle CDP (abas, viewport, entrada, captcha) é independente do backend de imagem.

## Pipeline estilo JEV: deixar o LLM governar o loop do navegador (fase 10)

O **contrato de quadro** «um quadro ≡ captura de tela + DOM numerado + intenção + progresso das ações», junto com a **costura de julgamento** «o juiz responde só com números, jamais com seletores», concretiza-se num pipeline executável, testável e arquivável. O julgamento vem de um serviço externo **Laya / JEV** (ver abaixo), e o loop é governado por este plugin.

**Quatro ferramentas** (`defineTool` do lado do host; as requisições de julgamento saem por HTTP do processo do plugin, sem passar pela sessão do agente):

| Ferramenta | O que faz | Quando usá-la |
|---|---|---|
| `bcdp_jev_status` | **Execute-a primeiro**: disponibilidade da cadeia de julgamento + diagnóstico de configuração, **não envia nenhuma requisição** | Primeiro passo quando se suspeita de problema de config/cadeia |
| `bcdp_jev_frame` | Captura um quadro (captura de tela + candidatos numerados + intenção), para ver o que o juiz verá | Depurar o conteúdo dos quadros, conferir a numeração de candidatos |
| `bcdp_jev_ask` | Monta o corpo da requisição; `dryRun` é true por padrão, `round=control\|chapter\|pick\|evaluate` permite examinar por níveis antes de enviar | Ver com clareza a requisição de julgamento antes de enviá-la |
| `bcdp_jev_run` | Executa o loop completo e devolve o rastro passo a passo (candidatos / top / orçamento / acerto de cada passo) | Quando se quer realmente deixá-lo agir |

**A cadeia por padrão é `laya → rule`**. O JEV por ora não pode ser registrado, por isso não é escrito por padrão; quando for possível, bastará reintroduzir `jev` na ordem de preferência `judgePrefer` e preencher `jevUrl`. Sem chave, o `bcdp_jev_status` imprime por iniciativa própria como erguer o serviço localmente (`ENGINE=laya … uvicorn laya_api.main:app`, porta **8000** e não 7789, `ALLOW_DEV_LOGIN=true` para criar uma chave). Julgadores indisponíveis são **pulados sem serem chamados** (o laya exige autenticação sem ramo anônimo, faltar a chave implica inevitavelmente um 401); cada pulo e cada falha entram no rastro, jamais retrocessos silenciosos; `refuse` é um resultado, não uma exceção.

**Redução em três níveis (o LLM governa o processo em vez de adivinhar tudo de uma vez)**:
1. `control` — agir ou não (5 opções fixas: `pick_button` / `sleep` / `next` / `prev` / `done`);
2. `chapter` — que capítulo (agrupamento por contêineres AX, subindo pela cadeia paternal dos `childIds` até o ancestral estruturado mais próximo, como `form#1` / `form#2`; com um único capítulo esta rodada é pulada);
3. `pick` — que número escolher dentro do capítulo + um `score` de risco.

A divisão em capítulos não é decorativa: os limiares são distribuídos em cubos conforme o número de candidatos, e **decompor um 20-pra-1 em «uns-poucos-pra-1 × uns-poucos-pra-1» faz ambas as rodadas caírem em cubos mais estritos** (`top≥0.5` e `top−second≥0.15`), mais controlável que um único 20-pra-1 (`top≥0.6`). O juiz **responde só com números**; coordenadas/seletores são remediados a cada vez pela camada de execução (`DOM.getBoxModel` + reverificação do ponto com `DOM.getNodeForLocation` antes do clique); os retângulos do quadro nunca servem de base ao clique.

**O contexto de julgamento é isolado**: só se admitem os quatro segmentos `INTENT` / `PROGRESS` / `FRAME` / `HISTORY`, **jamais o prefixo de sessão da sessão do agente**; qualquer segmento extra provoca um erro imediato na montagem (por asserção, não por convenção). O `PROGRESS` (número de passos / tentativas e resultados por capítulo / ações realmente logradas / orçamento restante) é **gerado mecanicamente** pelo próprio loop, não escrito pelo modelo — progresso escrito por um modelo é o segundo canal de alucinação mais difícil de detectar.

**Interruptor de avaliação `jevEvaluate` (ligado por padrão, pode ser desligado no painel de ajustes)**: após cada passo executado, o juiz reavalia o progresso: `inprogress` / `done` / `fail`. Ante `fail` ou um «done sem verificar», o próximo passo não é adivinhado: **passa-se a `escalate`** — com uma lista ordenada de `RecoveryOption` (por exemplo, primeiro `reload` para recarregar, porque uma renderização obsoleta pode ocultar uma confirmação já escrita), deixando o LLM decidir entre recuperar ou parar.

**Estados terminais do loop**: `done` (autoverificação contra `successCriteria`) / `blocked` (parado pelo orçamento) / `exhausted` (orçamento esgotado, com `exhaustedKind`) / `stuck` (mesma âncora e mesma ação 3 vezes seguidas sem mudanças) / `unavailable` (sem juiz) / `error` / `escalate`.

> Registro honesto do estado atual: esta fase demonstrou que **protocolo, limiares, terminação, capítulos, montagem e isolamento** estão corretos (coberto pelos testes unitários `bcdp_jev_*`), mas **o percurso de ponta a ponta sobre um navegador real ainda não foi executado** (T10.22 pendente); a **precisão** do julgamento não foi medida em campo (os cubos de limiares servem para calibrar, não provam que as escolhas sejam acertadas). Os elementos operados arquivados conservam as características de localização como `class` (apenas os tokens de envoltório do inspetor são despojados), para devolvê-las ao LLM num escalate e facilitar a recuperação.

## Desenvolvimento

O código-fonte está em `src/` (TypeScript), os artefatos de build em `lib/` (bundles de host + cliente) e `bin/cdp-cast-worker.mjs` (bundle do worker).

```sh
pnpm typecheck   # barreira de tipos tsc (tsconfig.json principal + tsconfig.client.json cliente)
pnpm test        # testes unitários vitest
pnpm run build   # três bundles tsdown: lib/index.js + lib/client.js + bin/cdp-cast-worker.mjs
```

> Edite diretamente `src/` (`src/index.ts` camada de ferramentas, `src/client/index.ts` frontend, `src/worker/cdp-cast-worker.ts` worker). Adicione novas ferramentas em `registerActionTools` com `t({...})`, complete o índice `bcdp_help` (`src/help.ts`) e execute `pnpm typecheck && pnpm test && pnpm run build`. `lib/` e `bin/cdp-cast-worker.mjs` são artefatos de build (pré-compilados e versionados), não os edite à mão.

`node_modules/` contém apenas links simbólicos para um checkout do DSH (resolução de tipos em compilação); em execução, o harness resolve `@deepseek-ai/dsh-tools`.

## Limitações conhecidas (ditas com honestidade)

- **Windows**: adaptado em nível de plugin desde a v0.4.0; a runtime incorporada para Windows continua sendo majoritariamente comunitária — a estabilidade de fluxos complexos de vários passos pode ser inferior à do macOS.
- **Captura FFmpeg por plataforma**: o Windows já usa `gfxcapture(HWND)`, que exige um build recente com esse filtro; um FFmpeg antigo no PATH é pulado com a sugestão de baixar uma versão compatível. Linux usa `x11grab`, macOS `avfoundation` como recorte de tela; ScreenCaptureKit no macOS e um helper Portal para Wayland são melhorias futuras.
- **Ambiente de instalação**: os pacotes peer do DSH deste repositório não estão todos no registro npm público. Um `pnpm install` comum pode falhar ao resolver os peers `@deepseek-ai/*`; a instalação via profile do DSH deve fornecer esses peers. O CDP não depende do FFmpeg e não baixa binários durante a instalação do plugin.
- **Qualidade dos snapshots**: no Linux a árvore semântica é reconstruída via CDP `DOMSnapshot`, não a nível de kernel como no macOS — cenários complexos com iframe/canvas podem degradar.
- **Confiabilidade do host (Linux)**: PRs da comunidade não fundidos — o estado de abas/espaços pode se perder entre chamadas CLI cruzadas; o plugin vai defendido: fluxos simples são estáveis, os complexos podem exigir novas tentativas.
- **Persistência do estado de sessão**: os cookies de execução do Chrome só são escritos em disco ao fechar elegantemente; após um fechamento forçado e reinício, será preciso iniciar sessão de novo.
- O esquema de saída é permissivo (`additionalProperties: true`); o cliente se guia pelos valores realmente devolvidos.

## Licença e atribuição

O plugin em si está sob MIT. A runtime incorporada integra código MIT de terceiros; os builds FFmpeg opcionalmente baixáveis carregam obrigações GPL-3.0-or-later. Antes de usar ou redistribuir, leia as licenças das fontes de build e a informação sobre obtenção do código-fonte — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Cadeia de suprimentos e permissões

Fatos determinísticos fornecidos para inclusão em diretórios e revisão:

- **Arquivos de execução**: `lib/` (artefatos de build, gerados deterministicamente do TypeScript de `src/` com `npm run build` via tsdown), `bin/` (scripts executáveis de entrada do worker e do ffmpeg-probe), `cordis.patch.yml` (camada de montagem), `dsh-plugin.json` (manifesto). Os `*.map` são apenas sourcemaps de depuração, sem papel em execução, declarados excluídos.
- **Artefatos nativos/executáveis**: `runtime/` incorpora uma runtime compatível com ego (MIT de terceiros; procedência e inventário arquivo por arquivo em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — é a função central do plugin (host Chrome/CDP gerenciado e autossuficiente), um artefato executável transportado de propósito, não um subproduto de build. `runtime/PATCHES.md` documenta todos os patches locais aplicados à runtime incorporada.
- **Dependências**: a única dependência em execução é `@deepseek-ai/schemastery` (uma implementação equivalente é fornecida pelo host DSH); as peer dependencies são todas serviços do host `@deepseek-ai/dsh-*`. Os módulos externos do bundle cliente são resolvidos pela tabela de módulos do host, sem arrastar dependências npm.
- **Serviços externos**: sem telemetria, sem chamadas a APIs externas. O único comportamento de rede é **opcional**: o instalador de FFmpeg baixa um build do GitHub (ou do espelho configurado pelo usuário) por instrução do usuário; verificação de fontes e obrigações de licença: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Fronteiras de falha**: sem webServer no host (TUI/headless) as rotas watch são puladas com segurança; se o worker não iniciar, as rotas watch devolvem um JSON com `ok:false` em vez de ficar penduradas; os processos do navegador terminam junto com o teardown do host (`--stop` em fire-and-forget, sem bloquear a saída do host).
- **Permissões**: o campo `permissions` do manifesto está vazio — as leituras/escrituras de arquivos do conjunto de ferramentas ficam confinadas aos diretórios de espaços gerenciados pelo ego e à área de trabalho do usuário; o acesso à rede passa pelo navegador do agente gerenciado, não pelo processo do host.

---

## Links amigos

Também obras do ecossistema de plugins do DeepSeek Harness, nos recomendamos mutuamente:

