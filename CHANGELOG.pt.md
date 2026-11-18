## 1.14.0 (2026-11-18)

**Roteamento multi-sessão da janela de observação (#15): dois sessões operando o navegador em paralelo, cada janela de observação mostra a sua própria página.**

- Três camadas de uma vez: o backend de captura passa de alvo único para um `Map` por targetId (cada alvo observado mantém seu próprio `Page.startScreencast`, sem `stop` mútuo); `CaptureManager` troca `#activate` por `#ensureWatched` (diferença de conjunto: novos start, remoções stopTarget); o focus store é fatiado por sessão — a janela segue «a aba que ESTA sessão dirige», preservando o comportamento global 1.13.x quando não há registro.
- Nova configuração `multiSessionWatch` (padrão ligado): desligar devolve o comportamento global pré-1.14 — uma chave de retrocesso única. ffmpeg é monofluxo por natureza: sob ffmpeg só o alvo mais recente é observado, com `singleStream: true` explícito, sem degradação silenciosa.
- Gate: typecheck limpo; `npm test` 1331 passed / 13 skipped (10 casos novos); os três artefatos rebuildados.
- i18n: add Portuguese (pt-BR) locale — package metadata and README/CHANGELOG mirrors.

## 1.13.2 (2026-11-18)

**Canal de publicação de volta a `latest`: corrige «issue fechado, mas a instalação padrão não recebe o reparo».**

- Com `publishConfig.tag = dsh-0.2.1`, `npm i dsh-browser-cdp` (que lê `latest`) ficou parado em 1.11.0 durante cinco publicações; agora o canal padrão é `latest` e as tags por host line são mantidas explicitamente via `--tag` no publish.
- A barreira de `tests/manifest.test.ts` foi corrigida para validar só formatos conhecidos (`latest` / `next` / `dsh-X.Y.Z`) — ainda pega dist-tags errados. Somente metadata; typecheck limpo, 1324 passed / 13 skipped.

## 1.13.1 (2026-11-17)

> 1.13.0 não pôde ser publicado por resquício de metadados staged-publish do registry npm (`409 Cannot publish over previously staged version`, cf. npm/cli#9889); publicado como 1.13.1, código idêntico ao 1.13.0.

## 1.13.0 (2026-11-17)

**`cdpMode=local` não abre mais janela «ao ligar o DSH», e o navegador gerenciado passa de fato a ser usado.**

- Issue upstream #14. Novo `localLaunchPolicy` (`eager` / `on-demand` / `manual`), **padrão `on-demand`**: após iniciar o DSH há 0 processos de navegador gerenciado; o lançamento é adiado até a primeira chamada `bcdp_*` que toque a página.

## 1.12.2 (2026-11-15)

**Corrige «fechou mas o painel não atualiza».**

- No canal ego-cli o `×` sumia o tab no navegador mas a barra de abas do painel segurava a linha: eventos `spaces` só viajavam carona na transmissão de quadros, que retorna cedo sem imagem. Mudança estrutural agora notifica imediatamente, sem esperar o próximo screenshot.

## 1.12.1 (2026-11-15)

**Corrige o `×` do painel sem efeito no canal ego-cli.**

- A causa não era permissão, era um portão duro: `closeCliTab` retornava `channel-cannot-close` sempre em ego-cli (409 medido). Novo `buildEgoCloseTabScript` fecha pelo mesmo heredoc de painel das ações size/navigate/switch.

## 1.12.0 (2026-11-15)

**Tipografia das seções de ajustes: destino de conexão no topo, grupos de revisão (JEV / Laya) recolhíveis.**

- `FamLinks` movido antes de `FAM_FIELD_GROUPS` com `first: true` — a ordem é prioridade, é a configuração de primeira classe da seção.
- Grupo `gJudge` recolhível (`foldable`): `<button aria-expanded>` + `▸/▾`, contagem de campos no cabeçalho; linhas recolhidas não são renderizadas de todo (nada de CSS-hiding com inputs focáveis por Tab).

## 1.11.0

**Entrada de ajustes vira seção própria de nível superior + correção de crash na engrenagem.**

- `mountOwnSettingsSection` (`settings.section`) + `mountSettingsSectionIcon`; hosts antigos retrocedem à engrenagem flutuante.
- Crash do `mountGen1SettingsGear` em hosts strict-resolver (acesso `remote.settings` sem inject) corrigido.

## 1.10.0 (2026-11-14)

**Entrada troca de `bcdp_status` para `bcdp_help`; a explicação do fluxo muda para o skill empacotado `bcdp-browser`.**

- Ferramenta residente passa a ser `bcdp_help` (504 chars, tabela local pura, zero efeito colateral); `bcdp_status` recua ao lote act — «ler a documentação» não deve virar «abrir o navegador».
- `bcdp_help` ganha `backend` / `space` / `injection` na resposta (registrados no schema de saída estrito) e linha de estado no topo do texto.

## 1.9.22 (2026-11-13)

**O ↻ do painel agora sincroniza de fato o «alvo ativo» — e sem efeitos colaterais.**

- `#dsh-ego-refresh` tinha DOM desde o 1.9.x mas nunca ganhou listener de click; rota nova `POST /api/bcdp/sync` com roteamento por canal no host.

## 1.9.21 (2026-11-13)

**Quebra de linha forçada na barra de tabs + fechamento otimista do `×` + badge de versão.**

- `renderTabs()` escreve estilo inline por item (`flexWrap=wrap` etc.), imune a folha de estilo do host/cache antigo; `×` remove a linha primeiro, faz POST e reconcilia em 700 ms.

## 1.9.20 (2026-11-13)

**Causa real de o estreitamento de janela do 1.9.19 não ter funcionado: a cadeia `??` parava no 0; fechar tab agora some do painel na hora.**

- `focusedWindowId` vindo null→0 não é nullish, e `a ?? b ?? c` parava no 0; troca para cadeia `||`. `broadcastCliSpaces()` empurra eventos só-de-`spaces` após fechar.

## 1.9.19 (2026-11-13)

**Barra de tabs do painel: deixa de tratar tabs de duas janelas como duplicatas; quebra linha; `×` fecha de verdade.**

- O Tabbit reporta «todos os tabs de todas as janelas»; `_tabbitWindowId` passa a estreitar a listagem à janela do tab do agente, e a captura segue o tab correto (não o about:newtab).

## 1.9.18 (2026-11-13)

**A face de observação para de gastar a cota da face de operação: ledger de receipts do Tabbit + recuperação ativa + não queima quando ninguém olha.**

- Limites medidos do tabbit-cli 1.21.21: 1024 receipts por task, depois todo `nodejs` devolve stdout vazio e o CLI só entra, não sai. Ledger local por task (`src/cdp/tabbit-receipts.ts`) + reciclagem proativa.

## 1.9.17 (2026-11-13)

**Causa do «após reiniciar tem que chamar status primeiro»: duas coisas — conexão pronta e superfície destravada — presas na mesma ferramenta; e três escritores disputando o «tab atual» são separados.**

- `bcdp_status` passa a ler o cache de attach com `refresh:true` forçando sonda; a sonda de diagnose do tabbit não roda mais no mount (ela dá tempo de partida ao navegador). Custo real: heredoc de subprocesso ~300 ms no caminho CDP; `diagnose` com grace de 20 s sob lock do ego no caminho tabbit.
- A face residente encolhe (441 ≤ 600 chars), o teste de orçamento de schema continua verde.

## 1.9.16 (2026-11-12)

**Repara a chave morta do `bcdp_snapshot`: `maxChars` declarado no schema da ferramenta.**

- O clamp 256..20000 e o eco `maxCharsUsed` existiam desde 1.9.12, mas o campo nunca foi declarado nas properties — o host filtra por schema e o modelo nunca conseguia passá-lo. Agora declaradо como optional integer com semântica documentada (só tabbit).

## 1.9.15 (2026-11-12)

**Causa do «painel mostra um segundo e volta ao vazio»: duas fontes de dados brigando no mesmo SSE.**

- Evidência por gravação: assinante SSE falso + subprocesso real + tabbit real, 18 s de eventos gravados (`.tempscript/probe-panel-events.mjs`). O worker de gravação CDP era içado sem portão de canal e retransmitia `spaces: []` a cada ~5,5 s com um targetId morto.

## 1.9.14 (2026-11-12)

**Corrige contrato de saída: `bcdp_status` / `bcdp_script` deixam de ser rejeitados pelo host no canal tabbit.**

- `backend`/`raw` não estavam registrados nos schemas estritos (`additionalProperties: false`); `bcdp_script` no caminho de falha inventava `text` e omitia campos obrigatórios. Campos registrados; ramo de erro volta ao contrato (`error`/`stderr`/`output`).

## 1.9.13 (2026-11-12)

**Causa do piscar da janela: a linha que o painel segue não é o tab que a rodada capturou.**

- `active` do CLI é o MRU do navegador, a captura segue o tab dirigido pelo agente; a discrepância expulsava o quadro recém-capturado do cache. `rowsWithPrimaryActive()` marca o tab capturado como ativo no broadcast.

## 1.9.12 (2026-11-12)

**Resultos transbordados não ficam mais silenciosamente vazios: leitura por blocos via `resource`.**

- O limiar `INLINE_RESULT_THRESHOLD_BYTES = 16 KiB` do runtime do fabricante é hardcoded e só é *anunciado*; `result?.value ?? result` tomava o objeto-referência como valor. Agora o recurso é lido de volta em fatias.

## 1.9.11 (2026-11-12)

**Corrige o «pisca e fica vazio» da janela: listagem de tabs vazia não apaga mais a base do painel.**

- `lastCliSpaces = spaces.length > 0 ? spaces : null` caía na linha sintética única cujo targetId não batia com o binding real do Tabbit → tela branca até a próxima rodada. Lista antiga agora é preservada.

## 1.9.10 (2026-11-11)

**Canal Tabbit ganha quatro capacidades; injeção lazy ganha portão «por canal ativo».**

- Prioridade definida por mineração de 139 sessões / 1003 chamadas `bcdp_*`: `bcdp_js` 313 (31%), `bcdp_script` 72, `bcdp_click` 43 + `bcdp_fill` 15. Adicionados `bcdp_js` (IIFE via `page.evaluate`), `bcdp_http`, etc. (`src/cdp/tabbit-cli-link.ts`).

## 1.9.9 (2026-11-10)

**Rota Tabbit ganha o modo «todos»: abas em segundo plano também geram quadro (captura rotativa).**

- `tabTracking: all` antes só valia no polling ego-cli; o polling Tabbit agora planeja por modo e rotaciona a captura entre os tabs do espaço.

## 1.9.8 (2026-11-10)

**Banner de login/verificação: texto auxiliar encolhe proporcionalmente, sem truncar nem esconder.**

- Reverte o «reticências + esconder em largura estreita» do 1.9.7; `loginSelfPersist` volta com o texto cheio (zh/en); razão 2:1 de largura com `min-width: 0` + quebra, sem coluna de 1 caractere.

## 1.9.7 (2026-11-10)

**Banner de login/verificação deixa de espremer-se numa coluna de texto em larguras estreitas.**

- Causa: `note` com `flex: none; white-space: nowrap`; correção nos dois banners com `min-width: 0` e `overflow-wrap: anywhere`.

## 1.9.6 (2026-11-10)

**Fecha o buraco de imagem entre duas capturas (re-render causado pelo replay de buffer de 1 s).**

- O timer de hold repristinava `spaces` junto, recriando a vista por segundo e pintando o quadro antigo do cache por cima do novo; passa a repristinar **só o quadro** (`writeCliImages(..., false)`), lista de tabs só muda em rodada real de captura.

## 1.9.5 (2026-11-10)

**«Modo de rastreamento de tabs» entra no cartão de ajustes (grupo de captura e fluxo), em via dupla com o atalho do painel.**

- Campo `tabTracking: 'active' | 'all'` (`z.union` + `.volatile`) com padrão `active`; dropdown «só ativo / todos» no grupo de captura, com explicação zh/en.

## 1.9.4 (2026-11-10)

**Modo «todos» (captura todo tab do espaço) + clique na aba troca de verdade + moldura verde no aba ativa.**

- `GET/POST /api/bcdp/tracking`; no modo todos, uma rodada de heredoc percorre os tabs `attach → Runtime.evaluate → captureScreenshot` devolvendo `frames[]` (até 6 JPEGs), cada aba com sua imagem.

## 1.9.3 (2026-11-10)

**Multi-tab e a referência @ na mesma frequência: painel segue a lista real de tabs/o aba ativo; relatório de tabs no mesmo balde.**

- `buildFrameScript` passa a `browser.listTabs()` → escolhe o ativo → attach próprio para url/title; sentinela `@@BCDP_FRAME@@` carrega `targetId` + `tabs[]` + `fmt`, e as linhas reais viajam com o quadro.

## 1.9.2 (2026-11-10)

**Avisos de login/humanização nomeiam o backend real (endpoint CDP / navegador ego / Tabbit / Lightpanda).**

- `/api/bcdp/spaces` ganha `link: { kind, label, engine }` nos três ramos; `loginTitle`/`captchaHint` parametrizados por `{where}` com `whereCdp`/`whereEgo`/`whereTabbit`/`whereLocal`/`whereGeneric`/`loginHeadless`.

## 1.9.1 (2026-11-10)

**Sincronização de tamanho/presets/maximizar/regerar/URL nas duas rotas + UI de cliente (tasks 13/19/20/21).**

- Heredocs de painel para ego-cli (`buildEgoWindowSizeScript` / `buildEgoNavigateScript` em `src/cast/panel-actions.ts`); rotas `/api/bcdp/window-size` e `/api/bcdp/navigate` retrocedem ao `PanelActionRunner` injetado em vez de 409.

## 1.9.0 (2026-11-10)

**Sincronização de tamanho / presets / maximizar da janela de observação — capacidades de backend (funções puras + worker/rotas de host).**

- `src/worker/window-size.ts` novo: `clampViewportSize` / `widthWithDelta` / `computeWindowBounds` / `aspectHeight` + `ASPECT_RATIOS` (16:9/4:3/21:9/1:1/9:16), 14 testes unitários.
- Worker `POST /api/window-size` aceita `{width,height,delta,dy,aspect,maximize}` via `Browser.getWindowForTarget` + `setWindowBounds`, com cache de windowId (10 s).

## 1.8.3 (2026-11-10)

**Buffer de quadro da sidebar: repristina o último quadro a cada segundo (≥1 s sem buraco).**

- `broadcastCliFrame` lembra o último quadro; timer `cliFrameHoldTimer` de 1 s repristina quando «há cliente SSE + sem ws de screencast + ≥1 s do último quadro», inclusive com spaces sintéticos.

## 1.8.2 (2026-11-10)

**Diagnóstico de captura de quadros ego-cli + portão de exitCode relaxado (caça da raiz do seq=0).**

- `spawnCliFrameCapture` aceita o quadro se o marcador + base64 estiverem válidos mesmo com exitCode ≠ 0; `lastCliFrameDiag` (exitCode/stdoutLen/hasSentinel/tail de stderr) exposto no `bcdp_doctor` como linha `last frame try:`.

## 1.8.1 (2026-11-10)

**Corrige o polling de 3 s não arrancar no caminho ego-cli (poller sem auto-cura).**

- O `CliFramePoller` só era içado dentro de `triggerCdpRefresh()`, que não roda no cold start; após sucesso em `runWithStaleSpaceRetry` um retry kick (`maybeKickCliPoller`, cooldown 5 s, fire-and-forget) liga o attach e o poller.

## 1.8.0 (2026-11-10)

**macOS pronto para usar + `bcdp_wait_for_human` + hideCursor + viewport fixo + contagem real do flush (vantagens do dsh-ego-browser absorvidas).**

- `installPathCandidates()` no runtime varre `/Applications` + `~/Applications` (Chrome/Chromium/Edge/Brave/Tungsten Edge) após falha do `which`; `ensureXDisplay()` isenta `darwin` (Aqua/Quartz nunca exporta `$DISPLAY`, era classificado por engano como headless e tentava Xvfb).

## 1.7.12 (2026-11-08)

**Novo: relatório de âncora de página inteira por aba com @menção (tab-anchor-report).**

- Botão `@` em cada item da lista de abas: um clique = relatório completo da página (role+name+âncora de snapshot por elemento), arquivado em `picks/` do workspace; o composer fica só com `@"picks/<file>.json"`. Granularidade: busca por @ até o nível de **aba**; elementos seguem o caminho de picks por clique.

## 1.7.10 (2026-11-04)

**Corrige a janela de observação eternamente branca no canal tabbit: receipt de quadro degradado a `resource` era descartado em silêncio; `bcdp_screenshot` não devolve mais `[object Object]`.**

- O threshold de inline do tabbit degradava o base64 da captura a `{type, resourceId, byteLength}` sem `value`. Bytes de screenshot agora vão a arquivo (`buildFrameCaptureSnippet(outPath)`) e o host lê o arquivo; o receipt só transporta o caminho.

## 1.7.9 (2026-11-04)

**Intervalo do quadro degradado 5 s → 3 s; linha de diagnóstico por sessão no `bcdp_doctor`.**

- `CliFramePoller` passa a 3000 ms (`cliFrameIntervalMs` em `/spaces` idem); nova linha `session scope:` imprimindo `callingSessionId(exec)`, `cfg.activeSpace`, o que o poller observa e o default.

## 1.7.8 (2026-11-04)

**Corrige dois bugs medidos do 1.7.7: fonte de quadros degradada no espaço errado + sem feedback de imagem na janela.**

- O poller lia `cfg.activeSpace ?? cfg.defaultSpace` e caía no bucket `__global__` → espaço literal `default`, registrando um espaço extra; correção com o espaço da sessão chamante.
- `/api/bcdp/stream` sem worker era fluxo mudo; o cliente só começava o polling depois de *ver* `cliFrameMode` (ovo-galinha). Polling do lado do cliente desde o mount.

## 1.7.7 (2026-11-04)

**Fonte de quadros degradados do ego-cli: sem CDP screencast, uma captura CLI a cada 5 s preenche a área de imagem.**

- `CliFramePoller` (`src/cast/cli-frame-poller.ts`) reusa o mesmo canal `ego-browser nodejs` das ferramentas reais com script passivo; rota `GET /api/bcdp/cli-frame` (image/png ou 204, trust-fence de sempre); `/spaces` sintetiza a linha `__cli_frame__` com `cliFrameMode` quando não há worker.

## 1.7.4 (2026-10-28)

**Raiz do issue #4: posição de bola flutuante/painel persiste por proporção de viewport (percentil) + re-posicionamento em resize.**

- `{fx, fy}` normalizados (4 casas, canto superior esquerdo); após reiniciar/maximizar/trocar resolução-escala a bola segue o canto gravado; listener `resize` re-deriva e clampa à tela, painel re-ancorado.

## 1.7.3 (2026-10-28)

Adendo de enumeração de hosts para DSH 0.2.1-rc.4 (bump só de declaração; plano de contrato com diff zero). Mesma string adicionada em `engines.dsh`/`dsh-plugin.json`/README.

## 1.7.2 (2026-10-26)

**Duas coisas: P0 de roteamento de canal («ego desabilitado e tudo ainda passa por ego, endpoint CDP ativo único inalcançável») e remoção do interruptor useSdkPath (OFF só garantia quebrar).**

- O cache de attach parava de herdar campos de roteamento de `previous`: uma única sonda bem-sucedida do ego-cli colava `linkKind`/`cliPath`/`cliShape`/`endpointSource` no cache do processo para sempre.
- Novo `resolveEffectiveLink` reconfirma o canal prioritário após eventos links: item ativo disponível vence; ativo pendurado (aponta para linha desabilitada/apagada) → **primeiro link enabled da ordem assume** (priority-fallback, logado + linha `channel:` no doctor, nunca em silêncio).

## 1.7.0 (2026-10-25)

**Duas coisas: três correções de fork externo absorvidas e a superfície residente reduzida a uma única entrada de destravamento.**

- `bcdp_status` vira a **única** ferramenta residente: lote core encolhe de 6 para 1; `space`/`navigate`/`help`/`doctor` migram ao lote act (13), `snapshot` ao observe (5). Sessões que não tocam o navegador baixam o schema residente de ~4,9 mil chars.
- `bcdp_script` deixa de estar disponível no cold start: a isenção «lote escape fura o portão de atividade» foi removida; para obtê-la, chame `bcdp_status` uma vez.

## 1.6.2 (2026-10-25)

**Corrige: o mount do plugin não dá mais cold start no navegador ego (gate de sonda `allowProbeColdStart`, padrão desligado).**

- A sonda inicial de CDP no link ativo rodava um heredoc autoritativo (`<cli> nodejs` + script sentinela) cuja cadeia de inicialização do runtime **abria o navegador por traz**; o toggle novo faz a sonda limitar-se a `--status`/formatação read-only, só executando o heredoc se `--status` provar navegador já rodando.

## 1.6.0 (2026-10-21)

**Mudança de comportamento padrão: isolamento por sessão vira o default.** Uma chamada `bcdp_*` **omitindo `space`** não cai mais no `default` compartilhado entre sessões, e sim no espaço próprio da sessão, `dsh-agent-<primeiros 8 do id>`; só **explícito** `space: 'default'` atinge o bucket compartilhado.

- `defaultSpace` vazio colapsa para `':auto'`; `deriveSlotDefaultName` perde o gate de `isolateSpaces` — nomenclatura de espaço e isolamento de Profile são eixos independentes.

## 1.5.0 (2026-10-21)

**Mudança destrutiva**: três famílias de ferramentas consolidadas (grupo de plano `bcdp-tool-consolidation`) por `op`; contagem **41 → 34**, schema total **24.093 → 22.224 chars** (1.869 economizados, teto inalterado). Nomes antigos **deprecados**, não removidos.

- `bcdp_wait_for_selector/url/response/page` → `bcdp_wait` com `op=selector|url|response|load|function|request|event`; `bcdp_space_open/close` → `bcdp_space` com `op=open|close` (`list|handoff|takeover` inalterados).

## 1.4.1 (2026-10-21)

Nomenclatura de espaços e isolamento concorrente endurecidos (grupo de plano `bcdp-space-ns-hardening`, A/B/C/D1/E/F/G). Tiering por risco; a geração de ids do snapshot do SDK (D3) fica fora desta rodada, substituída pela solução D1 na camada do plugin.

- `Config.defaultSpace` (escalar zod `.volatile()`): valor vazio colapsa para `DEFAULT_SPACE='default'`, hot-update sem re-registro; `cfg.activeSpace` = vivo por sessão, separado do campo resolvido.
- `createSessionSpaceTracker` + `GLOBAL_SESSION_KEY='__global__'`: um tracker único vira `Map<string,Slot`> por sessionId.

## 1.2.4 (2026-10-21)

- **`--sdk-path` atravessa até a execução das ferramentas**: antes só a sonda carregava o flag, `runEgoScript` não — todo script começava com `ReferenceError: taskSpaces is not defined` sob `ego-cli` + `useSdkPath: true`.
- **`bcdp_status` vira sonda de fachada**: nada de `--status` (não existe no CLI oficial); sonda `nodejs` no mesmo canal do trabalho real checando `taskSpaces`/`browser`/`page`; campo `facades` na saída; timeout 25 s → 15 s (~300 ms medidos).
- **Sonda de prontidão sem falso positivo**: com `useSdkPath` ligado exige `taskSpaces`/`browser` ambos `object` além do sentinela; desligado mantém o critério antigo, runtime vendored intocado.

## 1.2.2 (2026-10-18)

- hosts: adendo de enumeração 0.2.1-rc.2 no plano de declaração (34/34 peers `@deepseek-ai/*` verificados por npm um a um na rc.2; este plugin não toca `ctx.web` provider nem a `conversation.input.model.label` slot, código inalterado, publicação só de metadata; célula rc.2 da fazenda em espera).

## [1.2.0] - 2026-10-15 — 工具分级注入（默认 lazy）+ 设置开关胶囊化与乐观锁写入

> **Impacto de upgrade (de 1.1.5)**: o modo padrão passa de «registrar 38 ferramentas no mount» para **`lazy`** — sessões que não tocam o navegador ficam só com 6 ferramentas centrais residentes; as demais são injetadas por interruptor após a primeira chamada `bcdp_*.` **Nomes e assinaturas zero mudanças**, só o momento de aparição; scripts que esperam qualquer `bcdp_*` incondicionalmente devem voltar `toolInjection` a `always`.

- `src/toolTiers.ts`: a política «qual ferramenta sob qual condição» vira função pura num só lugar + controlador `createTierInjector` (`offer`/`reapply`/`surface`) recebendo apenas um callback `register`, sem Cordis, testável fora do host. Quatro níveis: **core** (6: `status`/…), **act**, **observe**, **escape**.
- Um interruptor-selo por nível (mesma forma e polaridade do «tool seal» do prime-memory): `toolInjection` (`lazy` padrão / `always`), `toolBrowse`, `toolExtended`, `toolJudge`, todos volatile + `.default()` no schema; ON = registro liberado, OFF = não registrado.

## [0.18.21] - 2026-10-04 — Lightpanda 受管行类型：按系统拉起 serve，有头/无头分型，顺序即优先级（同 0.17.25 同源）

- **Novo tipo de conexão `lightpanda` (singleton local, mesma regra do ego-cli)**: «Adicionar Lightpanda (gerenciado)» no painel, ordenável/ativável; o plugin cuida de içar/reusar/parar o serve. win32 via WSL2 (`wsl.exe -- lightpanda serve …`, env de telemetria pela WSLENV), linux/macos direto.
- **Tipagem headed/headless e semântica de ordem** (badge `LP·headless` + dica na linha): CDP endpoint/Chrome local/ego CLI são headed — suporte humano possível (digitar conta, passar captcha); Lightpanda é headless — sem intervenção humana, só para experimentos rápidos. Ordem = prioridade.
- Singleton de motor mutuamente exclusivo: Chrome gerenciado e Lightpanda disputam o mesmo slot gerenciado; win32 não faz pkill direcionado dentro do WSL.

## [0.18.20] - 2026-10-04 — Lightpanda 作为可选后端（P0）：识别投影 + 全链降级（同 0.17.24 同源）

- **Identificação de motor + projeção de capacidades**: `src/cdp/capabilities.ts` como fonte única (`engineOf` reconhece o prefixo `Browser: Lightpanda/…` do `/json/version`, `capabilitiesFor` projeta; unknown/chrome = capacidades completas). Reconhecimento em probe e attach.
- **Motor viaja entre processos** pela env `BCDP_CDP_ENGINE` (seguindo o precedente `EGO_LINUX_CDP_URL`): o host projeta uma vez, worker/render só leem.
- Sonda em máquina real `tests/cdp-probe/lightpanda.probe.test.ts` (auto-skip sem `LP_PROBE_URL`; 8 asserções: reconhecimento / navigate+lifecycleEvent / evaluate+AXTree / png sai + jpeg estruturado -32000 / cookies roundtrip / Over…).

## [0.18.19] - 2026-10-03 — 真机反馈⑩：点选特征采集换轨——纯文本链接读元素自身可见文本（同 0.17.23 反向同源）

- Causa: `describeNode` só lia o name de atributos; o texto visível de `<a>News</a>` está no textContent, invisível na profundidade 0 — todo link de texto puro vinha com `name=""`.
- `readNodeText` novo (resolveNode + callFunctionOn lendo o texto próprio do elemento, espaços colapsados, 60 chars); fallback quando name vazio na cadeia de pick — descrição/slug/arquivo de arquivamento sincronizados. Best-effort: falha de leitura não invalida o pick.

## [0.18.18] - 2026-10-03 — 真机反馈⑨：归档文件名带元素特征 slug（同 0.17.21 反向同源）

- Nome do arquivo de arquivamento muda: `picks-<timestamp>.json` → `picks-<slug-do-primeiro-elemento>-<base36-5>.json` — slug de describe → name → tag, ~12 chars limpos ao whitelist de gateway `[A-Za-z0-9._-]`; caracteres CJK purgam para o fallback de timestamp. Elementos de feições iguais em páginas diferentes têm arquivos próprios.
- Rótulo da referência legível: chip mostra `🌐 <slug>` em vez do caminho completo.
- 691 passed / 11 skipped; `tsc` duplo verde; bundle confere o lógica de slug.

## [0.18.17] - 2026-10-03 — 真机反馈⑧：原子引用片插入（宿主附件同款）+ 归档加载失败显码（同 0.17.20 反向同源）

- `deliver` passa a **inserir chip de referência atômico** (`ReferenceChipNode` via `inputActions.captureInsert…`, o mesmo tipo dos anexos do host) — texto puro `@"picks/…"` só recebe corante do `FOLDER_REF_RE`; o host nunca substitui texto por chip sozinho.
- Contagem 0 vira tri-estado: carregando `…`, falha mostra código (`⚠ no-workspace / not-found / load-failed`), sucesso mostra número real; código também em `__dshBrowserCdpDeco`.
- Sessão do cartão: string do inject prioritária, props padrão (`sessionId`) como fallback.

## [0.18.16] - 2026-10-03 — @mention 引用模型：token 以 @ 开头（`@"picks/<file>.json"`）+ 归档会话级解析（同 0.17.19 反向同源）

- Formato de referência muda (correção do modelo 0.18.13): a linha longa `[🌐 CDP-PICKS → …]` vira **token curto `@"picks/<file>.json"`** — o campo substituído começa com @ (mesmo cerne das referências de arquivo do dsh-paste-dock), camada de exibição renderiza o chip.
- Mesma página mesclada: varre os @ do rascunho → lê cada arquivo e compara `cdpEndpoint` → reescreve o arquivo do acerto; token não carrega contagem, rascunho intocado na mesclagem (o cartão relê o arquivo a cada 5 s).
- Diretório `picks/` resolvido por sessão: requisições `picks-save/picks-load` levam `session`, gateway mapeia via `workspaceRegistry` (sem workspace ou múltiplos candidatos → 409 `no-workspace`, sem chute).

## [0.18.14] - 2026-10-03 — 包装卡样式重写：不透明实底 + input-traffic 同款限宽（同 0.17.17 反向同源）

- Cartão ganha folha `<style>` idempotente de classe: fundo sólido opaco (claro `#f7f7f9` / escuro `#1c1c1e`), contraste imune às variáveis translúcidas da pele do host.
- Largura limitada com a fórmula do input-traffic: `min(100% - gap lateral×2 - padding do dock×2, largura da coluna de conteúdo - padding×2)`.
- typecheck ok; 690 passed / 11 skipped.

## [0.18.15] - 2026-10-03 — 🌐 引用徽标：composer 卡内浮动标识（同 0.17.18 反向同源）

- Badge `🌐` flutuando no slot `conversation.input.overlay` (order 110) quando o rascunho contém nossa referência; hover mostra título da página/conexão/contagem; coexiste com o badge 📄 do paste-dock no mesmo slot.
- Componente sondado por sessão (`props.sessionId` + closure `getDraft` da fábrica); renderiza null quando não resolve.
- typecheck ok; 690 passed / 11 skipped.

## [0.18.13] - 2026-10-03 — 包装卡挂官方 dock 缝（todo 同级 order 0）+ 投递模型变更：块体归档为文件（同 0.17.15/0.17.16 反向同源）

- Cartão registrado como contribuidor da lista `conversation.input.dock` (id `dsh-browser-cdp.picks`, **order 0, mesmo nível do todo**); `✕` remove a referência do rascunho (input vazio não deixa texto). O pendure body-mount do 0.18.9 sai.
- Modelo de entrega muda (igual ao paste-dock): o bloco de picks é arquivado por `picks-save` em `<stateDir>/picks/<file>.json`, o composer guarda só a linha curta de referência; o modelo lê pelo caminho (`backendNodeId` alimenta `bcdp_cdp` diretamente). Mesma página mesclada.
- Leitura de rascunho corrigida: o valor vivo está no campo de fachada `input.draft`; `input.state.getSnapshot()` não tem a chave `draft` — a leitura desde 0.18.4 devolvia string vazio sempre; `readDraftText(input)` cobre as três costuras.

## [0.18.11] - 2026-10-03 — 包装卡定位诊断补丁（同 0.17.14 反向同源）

- Registro do dock leva `locale: 'dsh-browser-cdp'` + escreve `__dshBrowserCdpDeco.stage='registered'`; falha da fábrica de inject registrada como `inject-failed` + sessionId.
- Regex do cartão de picks relaxada: whitespace/quebras permitidos entre atributos da linha-cabeçalho (a forma quebrada do composer não escapa).
- typecheck ok; 691 passed / 11 skipped.

## [0.18.10] - 2026-10-03 — 包装卡改挂官方 dock 缝：与 todo 同级（order 0）、浮在对话区一侧（同 0.17.13 反向同源）

- Cartão deixa de ser peça pendurada no `body`: vira contribuidor do slot de lista `conversation.input.dock` — render nativo do host, rola com o fluxo; toda a lógica de fixed/rect/re-posicionamento/filtro de visibilidade removida.
- **Nível do `todo` (`order: 0`)**: borda superior da faixa, lado da área de conversa; **sem campo `priority`** (id de célula próprio, nada fictício).
- `✕` desfaz: remove o bloco CDP-PICKS correspondente do rascunho.

## [0.18.9] - 2026-10-03 — 真机反馈⑦：包装卡定位修正（同 0.17.12 反向同源）

- Cartão torto: o template invisível de composer do DOM do host era o primeiro alvo do seletor (retângulo 0,0), o cartão grudava no canto superior esquerdo sobre a área de mensagens. Agora: enumera todos os candidatos → filtra retângulos visíveis (≥120×32, dentro da tela) → pega o mais baixo (o composer vivo).
- typecheck ok; 690 passed / 11 skipped.

## [0.18.8] - 2026-10-03 — 真机反馈⑥：`sessions` 未声明 inject（用户诊断实锤；同 0.17.11 反向同源）

- Console do usuário reportou `window.__dshBrowserCdpDeco = { stage:'error', error:'cannot get property "sessions" without inject' }` — o resolver estrito recusa acesso nufo a serviço não declarado; cartão e entrega dependem de `ctx.sessions`.
- inject estático do cliente ganha `'sessions'` e `'conversation'` (núcleo da web UI do host, sempre carregado).
- typecheck ok (`noImplicitAny` do cliente); 690 passed / 11 skipped.

## [0.18.7] - 2026-10-03 — 真机反馈⑤：包装卡渲染重写（同 0.17.10 反向同源）

- O cartão do 0.18.4 não aparecia em máquina real: era injetado no contêiner React do composer (reclamado pela reconciliação) com falha engolida. Reescrito: `document.body` + `position:fixed` (posicionado pelo retângulo do composer, retângulo em três níveis de fallback); `window.__dshBrowserCdpDeco` (`stage`…) como trilho de diagnóstico.
- typecheck ok; 690 passed / 11 skipped.

## [0.18.6] - 2026-10-03 — 0.18.5 同内容重发（npmjs 暂存位卡住）

- 0.18.5 ficou preso em staged após aceito do registry (`EPUBLISHCONFLICT: previously staged "0.18.5"`, leitura 404), republicação recusada — renomeado para 0.18.6. Conteúdo idêntico ao 0.18.5 (cartão de composer + correção de regex de mesclagem).
- Se o 0.18.5 algum dia assentar no registry, conteúdos iguais; `dsh-0.2.0`/`latest` apontam para 0.18.6.

## [0.18.5] - 2026-10-03 — 真机反馈④：点选内容包装卡（composer 装饰）+ 同页合并正则修复（同 0.17.9 反向同源）

- **Cartão de embalagem no composer**: quando o rascunho contém um bloco CDP-PICKS, cartão decorado temático acima do input — `🌐` + conexão CDP + título da aba + chips de elementos (≤6, colapsa); âncora `[data-composer-input]` (estabilidade verificada entre 0.1.7-rc.2 ↔ 0.2.0-rc.2); segue o rascunho a cada 1 s com guardas. Chaves `pickCardTitle`/`pickCardElements` no dicionário embutido zh/en.
- Regex de mesclagem de mesma página (bug introduzido em 0.18.4): o prefixo `🌐` quebrava o match e o segundo pick na mesma página abria bloco novo; regex tolera o prefixo opcional.

## [0.18.4] - 2026-10-03 — 真机反馈③：点选投递到输入框修复（同 0.17.8 反向同源）

- **«Referenciar na conversa sem efeito no input»**: a entrega lia `sessions.list.getSnapshot().current` — campo removido pelo host desde 0.1.6-alpha.2, `undefined` eterno em 0.1.7/0.2.0 → `no-active-session` silencioso → rascunho nunca escrito.
- Correção: deriva a sessão atual como o host faz hoje (varredura `byId` com `retainedBy.mainView > 0`, igual à sidebar do host); `sessions.scope(id)` e `conversation.input.setDraft` verificados anel a anel no código-fonte do host 0.2.0.
- Linha-cabeçalho do bloco ganha `🌐` (`[🌐 CDP-PICKS …]`); corpo continua JSON puro. O chip de arquivo do composer é sistema fechado `ui-attachment` sem costura de terceiros — virar chip fica como pedido de feature ao host.

## [0.18.3] - 2026-10-03 — 真机反馈②：点选失败根因修复（与上游插件的状态文件互踩；同 0.17.7 反向同源）

- Verdade por traz de «alternar seleção → falha na seleção»: com `dsh-ego-browser` (upstream) instalado na mesma máquina e mesmo profile, os dois workers de cast **escreviam o mesmo `ego-cast.json`** — o painel deste plugin ponteava para o worker do upstream (sem as rotas `pick`/`marks`/`raise`) → 404.
- Arquivo de estado renomeado para **`dsh-browser-cdp.cast.json`** (escrita do worker, leitura do cast-server, leitura do `bcdp_auth_flush` — três costuras); nunca relê o nome compartilhado. Coexistência real a partir da próxima requisição.
- Detalhes da falha visíveis: code/message reais do worker no hover title do botão da barra (flutuante + aba da sidebar).

## [0.18.2] - 2026-10-03 — 真机反馈：本机 Chrome 固定行 + 激活模式同步 + 首行自动激活（同 0.17.6 反向同源）

- Nome-chave nu do botão `linksActivate` sem entrada no dicionário embutido bilingue desta linha (era ternário inline na era v1; a portação 0.18.1 passou a chamar por chave sem criar a chave) — chave adicionada.
- Alvo remoto alcançável era pisado pelo Chrome local: `cdpMode`/`allowLocalFallback` invisíveis ao usuário; o navegador local gerenciado vira linha fixa.
- **Linha fixa «Chrome local (lançamento gerenciado)»**: linha LOCAL permanente no fim da sequência — ativar = `cdpMode=local`, checkbox = `allowLocalFallback` (volatile nesta versão); com `cdpMode=local`, ativar qualquer alvo real volta automaticamente a `auto`.

## [0.18.1] - 2026-10-03 — FamLinks v2：连接目标编辑器 + 双设置挂载（自 0.17.5 反向同源移植）

- **CRUD de destinos de conexão dentro dos ajustes**: a área de links do cartão family vira editor completo — habilitar por linha, ativar, label/endpoint/caminho de CLI editados no lugar (rascunho + commit em onBlur/Enter, nunca escreve a disco por tecla), **sonda** por linha (`POST /bcdp/api/cdp-probe` grava o probe naquela linha), subir/descer, apagar.
- **Cartão na página de detalhes do plugin**: o mesmo `FamilySettingsCard` registrado por keyed slot em `plugins.bundle.config` (padrão thinking-levels b660785) — sem thinking-levels instalado, é a única entrada de ajustes.
- Linha do ego CLI: switch inline `useSdkPath`; alerta inline `mode-kind-mismatch` quando `cdpMode=remote`.

## [0.18.0] - 2026-09-29 — DSH 0.2.0-rc.1 线（compat/0.2.0：纯元数据适配，零代码改动）

- `captureWithinBudget` **implementado** no worker de render (bloqueio real da linha 0.2.0 corrigido): `capture` em `bin/cdp-render-worker.mjs` chamava função nunca definida (a cadeia real de captura falava sempre, mascarada pela sonda com portão). Escada de qualidade JPEG (72 inicial, passo 12, piso 24, estouro de orçamento reportado honestamente como `overBudget`) + redução geométrica por `scale.maxWidth` + caminho único para PNG/sem orçamento.
- **`noImplicitAny` do semi-cliente ligado**: `tsconfig.client.json` sobe para `true`, 401 implicit-any explícitos (codemod posicional `scripts/fix-implicit-any.mjs` + acabamentos manuais); anotações sem efeito de runtime.
- **Sondas com portão habilitadas em máquina real**: sonda CDP remota (4/4) e render (1/1) passando contra Chrome/153 local real — ciclo discovery→attach→inspect→input→binding + cadeia de orçamento. cli-probe e e2e de login-import seguem presos à runtime Linux vendored.

## [Unreleased] — JEV 风格管道：DOM+截图+意图 → Laya/JEV 判定（阶段 10 / R5-R6，分支 stage9-ego-cli）

- **Pipeline estilo JEV (T10.1–T10.19)**: contrato de quadro (captura + DOM numerado + intenção + progresso das ações) + costura de julgamento (responde só números, jamais seletores).
- Worker de render `bin/cdp-render-worker.mjs`: cliente CDP de conexão única, `attachPage()` (enable de `Page/Runtime/DOM/Accessibility` na ordem da M0.3), `gatherInteractive(limit)`, `captureWithinBudget()` (JPEG).
- Três primitivas `noul`/`choice`/`score` (`src/jev/wire.ts`) + limites de protocolo (`choice.criteria` não-vazio e ≤255; lista vazia lança, porque `criteria` vazio é 422 e lido erradamente como falha do modelo) + `validateQuestions()` reportando tudo de uma vez + `THRESHOLD_BUCKETS`.

## [Unreleased] — 连接类型多态化：本机 ego CLI 连接对象（阶段 9 / R7，分支 stage9-ego-cli）

- **Sequência de conexões tipada**: `BrowserLink = CdpLink | EgoCliLink` (campo discriminante `kind: 'cdp' | 'ego-cli'`). A ordem do array **continua sendo a prioridade**, `activeTargetId` pode apontar para qualquer tipo.
- **Conexão de ego CLI local** (`kind='ego-cli'`, **somente máquina local, no máximo uma global**): cadeia de resolução do CLI em quatro níveis — `cliPath` explícito → `ego-browser` no PATH → helper dentro do pacote do app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime embutida.

## [0.16.0] - 2026-09-23 — 阶段 2b 收尾 + 远端 CDP 软禁用开关

- **Interruptor geral `remoteEnabled` (T2.18)**: desliga o CDP remoto temporariamente sem apagar a sequência de alvos — a ordem fica intacta, mas toda sonda/conexão remota para; chamadas `bcdp_*` recebem erro explícito `remote-disabled`; visível no cartão de ajustes e no `bcdp_doctor`; reabrível a qualquer momento. Ortonormal a `allowLocalFallback`.
- `cdpMode=local` ligado ao lançador próprio (fecho da 2b): o modo local agora é lançado pela M0.9 com seu endpoint injetado, e a runtime embutida se adhere a ele, sem cold start próprio; cache marcado `endpointSource: local`.
- Duas linhas novas no `bcdp_doctor`: `remote CDP: enabled/DISABLED` e `attach: <status> (source: …) @ <endpoint>` (visibilidade tripla da T2.16).

## [0.15.0] - 2026-09-23 — 本地浏览器启动器（阶段 2b / M0.9）

- **Lançamento local gerenciado**: com `allowLocalFallback` ligado e o endpoint ativo inalcançável, inicia automaticamente o Chrome/Chromium/Edge local (descoberta explícita → tabela de candidatos por plataforma), injeta `http://127.0.0.1:<porta>` e segue trabalhando; badge de attach marca `endpointSource: local-fallback`.
- **Reuso de singleton** (T2.13): `launcher.json` grava pid/porta/profile; só reusa instância que o próprio plugin lançou e ainda responde.
- **Parada e recuperação** (T2.14): win32 `taskkill /T /F` mata a árvore inteira (0 órfãos medidos); o reaper de ociosidade recupera instâncias locais junto.

## [0.14.0] - 2026-09-23 — 点选引用按页聚合为字典块，附来源 CDP 连接

- **Agrupamento por página**: uma referência carrega conteúdo de uma única página — múltiplos elementos da mesma página mesclam no **mesmo bloco**, páginas diferentes geram blocos novos.
- **Envolucro de dicionário** (análogo ao pré-bloco dos anexos de imagem): `[CDP-PICKS page="…" targetId="…" endpoint="…"]` + JSON (`cdpEndpoint`/`targetId`/`pageUrl`/`pageTitle`/`elements[]`) + `[/CDP-PICKS]`.

## [0.13.0] - 2026-09-23 — 点选投递改为编号引用，取消自动发送

- **Envio automático abolido**: o caminho `submit()` de «adicionar à conversa» sai por inteiro — qualquer seleção só escreve no rascunho do input, **enviar é sempre decisão do usuário** (Enter ou botão).
- **Referência numerada**: cada seleção acrescenta `[pick N] <descrição do elemento>`, N continua automaticamente a sequência existente — seleções múltiplas formam lista ordenada.
- Barra flutuante vira ação única: «referenciar na conversa (Ctrl+J ou ↵)», equivalentes; confirmação mostra «✓ referenciado no input».

## [0.12.0] - 2026-09-23 — 去 ego 化：CDP 浏览器代理身份（阶段 8）

- **33 ferramentas `ego_*` → `bcdp_*`**: `bcdp_status` / `bcdp_navigate` / `bcdp_doctor` … (prefixo derivado do id do plugin, sem ocupação no ecossistema). Scripts com nomes antigos transitam via `legacyEgoToolNames: true` (aliases `ego_*` adicionais).
- **Rotas HTTP `/api/ego/*` → `/api/bcdp/*`**, gateway de ajustes `/ego/api/*` → `/bcdp/api/*` (painel sincronizado).
- **Renomeação de recursos**: `bin/ego-cast-worker.mjs` → `bin/cdp-cast-worker.mjs`, `bin/ego-chrome-wrapper.sh` → `bin/cdp-chrome-wrapper.sh` (matching/limpeza de processos do worker sincronizados).

## [0.11.1] - 2026-09-23 — 修复：面板点选状态两处误判

- O estado intermediário `picked` do worker (capturado, aguardando ação) era lido pelo painel como falha («seleção falhou») — agora mostra a descrição do elemento.
- Armar o painel realinhava a baseline de entrega a `picks` e engolia a entrega da seleção feita *antes* de armar; baseline desce um degrau, a seleção pendente é sempre entregue.

## [0.11.0] - 2026-09-23 — M1.6 投递到对话 + 坐标点选降级路径

- **Entrega do resultado da seleção na conversa (M1.6 / T5.6–T5.7)**: as duas ações da barra flutuante escrevem de fato — «comentar na conversa» escreve a descrição no rascunho (usuário completa e envia); «adicionar à conversa» escreve e **envia automaticamente** (mesmo caminho de adjudicação do botão de envio). Validação de `phase === 'plain'` antes de enviar; cada seleção entrega uma vez.
- **Caminho degradado de seleção por coordenada (T5.1b)**: no modo seleção, clicar na captura ao vivo da janela = selecionar — coordenada convertida e enviada ao worker, hit-test por `DOM.getNodeForLocation` (sem depender do canal de eventos Overlay), mesma esteira de descrição/medição/UI. Sidebar e flutuante suportam.
- Worker ganha `POST /api/pick/click {targetId, x, y}`; host expõe `/api/ego/pick/click` como encaminhamento.

## [0.10.0] - 2026-09-23 — CDP P0 底座 + 元素点选（R6 主体）+ Set-of-Marks（R4）

- **Seleção de elemento (corpo da R6)**: toggle «selecionar elemento» na barra da janela de observação (sidebar e flutuante, à esquerda de «abrir página real»). No alvo real, clique escolhe: moldura azul-céu de 2 px + barra flutuante junto ao elemento, duas ações «comentar Ctrl+J» / «adicionar ↵», confirmação «✓ transferido à conversa» recolhendo em 2,5 s; re-arma após a ação para seleção contínua.
- **Captura Set-of-Marks (mecanismo R4 + gateway)**: `POST /api/ego/marks` devolve captura + mapa dos elementos interativos numerados em ordem de documento (filtro por árvore AX, `n = 1..N`, com retângulo de viewport e descrição semântica de uma linha), destaque opcional de um elemento. CDP puro, zero injeção de página.
- **Base de sessão CDP residente (P0)**: em `src/cdp/` — endpoint (normalização/descoberta, 8 códigos de erro estruturados), session (pareamento de ids de comando, timeout por comando, reconexão com backoff e **replay da sequência de enable após reconectar**), events (dispatch de domínios, afinidade de domínios com estado, ordem `DOM.enable → Overlay.enable`), dom, input.

## [0.9.1] - 2026-09-23 — 修复：保存后 CDP 目标从面板消失

- Após salvar no painel, a sequência de alvos CDP desaparecia da interface (os dados já estavam gravados): o callback de sucesso reconstruía o rascunho a partir do config retornado omitindo `cdpTargets` / `activeTargetId` / `cdpMode` (`load()` tinha, este caminho não).
- Registro de diagnóstico: `ALLOWED_KEYS` e `sanitizeJsonArray` do lado `/ego/api/set` normais — o problema era só a reconstrução do rascunho no cliente, não a gateway nem o schema.

## [0.9.0] - 2026-09-23 — CDP 目标序列 + 激活 (R1) + 包名统一为 dsh-browser-cdp

- **Sequência de alvos CDP + ativação (R1)**: novas configurações `cdpTargets` (sequência ordenada) / `activeTargetId` (ativação única) / `cdpMode` (`auto`/`local`/`remote`) / `cdpProbeTimeoutMs`. Cada ferramenta `ego_*` dirige **o endpoint ativado**, não o navegador local.
- **Editor de sequência no painel**: CRUD + reordenação, rádio de ativação, botão «sonda» por item e badge de alcançabilidade (polling de `/ego/api/cdp-status`). Endpoint só aceita `http(s)://host:porta` ou `ws(s)://…`; scheme inválido erro explícito, sem chute silencioso.
- **Cadeia explícita de ativação**: `resolveEgoEnv` injeta `EGO_LINUX_CDP_URL` conforme `cdpMode`; mudança de config dispara `refreshAttach`, e mudança de endpoint religa o cast worker no mesmo navegador via `setAttachEndpoint`.

## [0.8.5] - 2026-09-18 — 登录态导入 + 空闲回收 + 观察窗修复群

- **Importar estado de login dos navegadores do sistema (#46)**: nova ferramenta `ego_login_import` + bloco no cartão de ajustes + rota `POST /api/ego/login-import`. Copia cookies por domínio do Chrome/Edge/Brave cotidiano ao navegador do agente (binário real headless + leitura transparente por CDP, compatível com App-Bound Encryption do Chrome 127+).
- **Recuperação automática por ociosidade (#47, opt-in)**: `idleTimeoutMin` (padrão 0 = desligado). N minutos sem chamadas `ego_*` param elegantemente (`--stop`) o navegador em segundo plano (~425 MB ociosos medidos); reabre em 2-4 s. Olhar a janela não conta como atividade (dito no texto do ajuste).
- **Botão «janela pop-out» (#51)**: chama `ego-browser --open` — a instância headless é trocada no lugar por janela com interface do mesmo Profile (abas preservadas); se já com interface, traz à frente.

## [0.8.4] - 2026-09-15 — 观察窗 worker 启动链修复 + 社区 PR 合并

- **Janela nunca iniciava em DSH ≥ 0.1.5 (#34 / #38 / #43)**: o spawn do worker não levava o `cwd` obrigatório do provider de subprocesso do 0.1.5, e o `catch` nu engolia a exceção — `ensureWorker()` eternamente null. `cwd` adicionado.
- **Worker se matava ao iniciar (#34 defeito 2 / #40)**: o matching frouxo de `stopSiblingWorkers()` tomava o runner de subprocesso do DSH como colega e o `taskkill /T` matava a própria árvore antes de escrever `ego-cast.json`. Matching restringido ao filho direto do node.
- **Todos os `ego_*` com `no @@DSH_RESULT@@` no host Electron (DSH Desktop) (#42)**: env explícito no spawn sem `ELECTRON_RUN_AS_NODE` iniciava um segundo Electron. `resolveEgoEnv` e o spawn do worker cobrem `process.versions.electron`.

## [0.8.3] - 2026-09-07 — DSH 0.1.2-rc.1 兼容 + 安全/稳定性修复

- **Vulnerabilidade das rotas `/api/ego/*` sem autenticação**: rotas exactas venciam a cerca de confiança de prefixo `/api` do host — `GET /api/ego/stream` despejava quadros ao vivo sem credencial e `POST /api/ego/input` aceitava entrada (pilotagem cross-site). Envoltório uniforme no `webServer.register`.
- **Client morria em host sem dsh-better-sidebar (#29)**: `inject` hard-declared + acesso nu a `ctx.betterSidebar` lançavam "without inject" no resolver estrito. Declaração preservada (é condição de resolução) + try/catch com passagem explícita.
- **Regressão de cold start no Windows**: o suporte a Xvfb do #22 passou a içar Xvfb quando `DISPLAY` faltava, mas Windows tem sessão de área de trabalho e não tem Xvfb → falha. `ensureXDisplay` e o `hasDisplay` de entrada isentam win32.

## [0.8.1] - 2026-08-28 — DSH 0.1.2-alpha.1 兼容

- **Semi-cliente migrado para `@deepseek-ai/dsh-client-store`**: o 0.1.2-alpha.1 renomeou `@deepseek-ai/dsh-client-runtime` (incluindo o subcaminho `/client`) para `@deepseek-ai/dsh-client-store` (o grafo de módulos do cliente usa o nome nu como módulo estático).
- **Id de registro do módulo cliente = nome de pacote declarado `dsh-ego-browser`**: a linha de boot manifest do 0.1.2 é gerada do `name` do package.json e exige que o nome da especificação da linha do loader seja igual (validação de igualdade `nearestPackage`).
- **`dsh.client.inject` declara somente pacotes reais do grafo**: no 0.1.2, `@deepseek-ai/dsh-client-store` / `dsh-client-ui-slots` são módulos estáticos (fora do grafo); declará-los como arestas de injecção fazia a composição da entrada ficar pendurada em silêncio (módulo não materializa, painel não monta, nenhum erro).

## [Unreleased]

Janela de observação ganha a esteira de tela dupla: correção da raiz do protocolo CDP e backend FFmpeg H.264/fMP4 opcional.

- **Parâmetros de inicialização personalizados pelo usuário**: o cartão de ajustes ganha «argumentos adicionais do ego-browser CLI» e «argumentos adicionais do Chrome». O primeiro é anexado ao argv do `ego-browser nodejs` (efeito na próxima chamada `ego_*`); o segundo cruza pela env `EGO_LINUX_EXTRA_ARGS` à runtime vendored.
- FFmpeg passa a ser baixado explicitamente: o CDP não depende nem instala `ffmpeg-static`. A página de ajustes detecta primeiro caminho personalizado, PATH do sistema e cache gerenciado; a opção FFmpeg fica desabilitada até a checagem de compatibilidade passar, com download one-click de versão fixa + verificação SHA-256.

## [v0.8.0] - 2026-08

Integração de aba na sidebar: com `dsh-better-sidebar` disponível, a janela de visualização ao vivo registra-se como aba nativa da barra lateral em vez de pop-up flutuante.

- **Integração com a aba do dsh-better-sidebar**: `apply()` sonda oportunisticamente `ctx.get('betterSidebar')` (não `ctx.betterSidebar` — isso exigiria declaração `inject` e transformaria a sidebar em dependência dura, sem a qual nem o cartão de ajustes carregava); disponível, registra via `r…`.
- **Primeira chamada `ego_*` abre a aba automaticamente**: os caminhos de execute de `defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` chamam `markEgoToolCall()`, contador no host entregue pela resposta de `/api/ego/spaces`.

## [v0.7.1] - 2026-08

Versão de correção: uma única chamada `ego_space_open` não abre mais duas janelas de navegador.

- `ego_space_open` abria um tab residual: o launch passava `"about:blank"` como argumento posicional, abrindo um tab no browser context padrão, e `ego_space_open` (`useSpace+ensureRealTab`) abria o seu próprio.

## [v0.7.0] - 2026-08

Versão menor: respiração do indicador da janela + governança de memória do frontend + correções de timeout/plataforma nas ferramentas.

- **Respiração do indicador**: o ponto verde do badge da FAB fica verde fixo quando o agente realmente dirige o navegador (`busy`) e «respira» (brilho verde de 2,4 s) quando ocioso (navegador aberto, sem operação); o ponto «navegando ao vivo» do painel sincroniza. A semântica antiga «busy=amarelo, idle=verde» é invertida.
- **`timeoutMs` do `ego_script` era ignorado**: a cobertura por execução declarada no schema nunca surtiu efeito — tudo usava o grace padrão de 15 s. Agora atravessa `runEgoScript`; ausente/inválido cai no padrão.

## [v0.6.1] - 2026-04

Versão de correção: cadeia de auto-cura + estabilidade do worker da janela de observação + usabilidade da barra-guia do painel.

- **Desinstalar o plugin não bloqueia mais a saída do host nem fere a auto-cura**: teardown do `ctx.effect` passa de `await ego-browser --stop` (grace de 15 s arrastando a saída) para fire-and-forget; o host pode ser limparamente religado pelo `dsh-web-guard` em 10 s e turn interrompido continua sozinho.
- **Guarda de instância única do worker + limpeza de estado stale**: o mesmo `ego-cast-worker.mjs` podia ser içado do diretório de instalação e do clone de dev, e `ensureWorker` içava outro quando o pid conhecido já morrera — `ego-cast.json` apontava eternamente para worker morto/atrasado e o painel perdia o stream.

## [v0.6.0] - 2026-04

Governança de saúde do código (convergência de engenharia).

- Bomba de sobrescrita de build desarmada: `src/` obsoleto (561 linhas velhas) e `tsconfig.json` removidos, firmando **`lib/` como única fonte autoritativa**. `npm run build` deixa de «compilar src→lib (versão velha sobrescrevendo, ferramentas somindo)» e passa a validar sintaxe do `lib/` (`node --check`).
- Registro de ferramentas unificado: `ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` seguem o mesmo caminho `withEgoLock` + retry de cold start das demais (segurança de concorrência).

## [v0.5.0] - 2026-04

Transmissão ao vivo + operação direta do navegador na janela de monitoramento.

- Bug crucial do streaming corrigido: `screencastFrame` casava o campo errado e nenhum quadro chegava a ir por SSE. Corrigido, páginas dinâmicas chegam perto de 10~30 fps.
- Encaminhamento de stream do cast-server migra para `node:http` (fetch bufferizava respostas chunked e atrasava o primeiro quadro).

## [v0.4.0] - 2026-04

Multiplataforma (suporte Windows consolidado).

- Suporte nativo Windows: `IS_WIN` + `windowsChromeCandidates()` sonda automaticamente diretórios de instalação Chrome/Edge/Brave e `PATH`/`%PATHEXT%`.
- Injeção de serviço passa a escolher entre `webServer`/`httpServer`, permitindo montar a janela de observação também no Windows.

## [v0.3.0] - 2026-04

Correções e reforços.

- Retry automático de cold start: cada ação `ego_*` içava um subprocesso `ego-browser` novo; durante o aquecimento da sessão ocorriam `CDP channel is not open` / timeouts de DevTools. Até 3 tentativas com backoff progressivo, apenas para erros transitórios de cold start — erros reais passam direto.

## [v0.2.0] - 2026-04

Destaques: frontend de observação ao vivo.

- `lib/client.js`: UI escura de vidro fosco, uma 🌐 bolinha permanente no canto inferior direito, abrir mostra a tela ao vivo do agente.
- Gestão de abas: barra horizontal de abas + `×` por aba (fecha o tab no navegador de verdade).
