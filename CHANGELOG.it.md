## [0.18.0] - 2026-09-29 — Linea DSH 0.2.0-rc.1 (compat/0.2.0: adattamento puramente di metadata, zero modifiche al codice)

### Aggiunte
- **Implementazione `captureWithinBudget` del worker di rendering** (correzione del blocco su macchina reale della linea 0.2.0): il `capture` di `bin/cdp-render-worker.mjs` invocava finora una funzione mai definita (la catena di cattura su macchina reale falliva sempre, e veniva mascherata dalla sonda gated). Ora implementata: scala di qualità JPEG (partenza a 72, passo 12, minimo 24, superamento del budget riportato onestamente con `overBudget`) + sottocampionamento geometrico via `scale.maxWidth` + percorsi a colpo singolo per PNG/senza budget; `data` viene restituito in base64 per consumo da parte della catena di giudizio JEV. Prova reale: Chrome/153 collegato realmente, budget raggiunto al primo tentativo (attempt 1, q=72).
- **Apertura del semi-`noImplicitAny` lato client**: `tsconfig.client.json` sale a `noImplicitAny: true`, tutti i 401 implicit-any vengono resi espliciti (`scripts/fix-implicit-any.mjs` codemod posizionale preciso + rifiniture manuali); le annotazioni di tipo non hanno alcun effetto a runtime, `client-input.test.ts` risincronizzato via regex sulle sorgenti.
- **Sonde gated abilitate su macchina reale**: sonda CDP remota (4/4) e sonda di rendering (1/1) eseguite con successo contro un vero Chrome/153 locale — ciclo discovery→attach→inspect→input→binding + catena di cattura con budget. cli-probe e login-import e2e restano legati alla runtime Linux vendored, gate mantenuti (N/A su questa macchina).

### Modifiche
- **Cambio di generazione delle peerDependencies (sostitutivo)**: le sei `@deepseek-ai/dsh-client-locale` / `dsh-client-store` / `dsh-client-ui-settings-plugins` / `dsh-client-ui-slots` / `dsh-settings` / `dsh-tools` passano da `>=0.1.7-rc.1 <0.1.8-0` → `>=0.2.0-rc.1 <0.2.1-0`; la linea 0.1.7 resta congelata come 0.17.x, per DSH 0.1.2-rc.1 ~ 0.1.7 usare 0.17.x.
- **`engines.dsh` sincronizzato in entrambi i punti**: sia il `engines.dsh` di primo livello sia il `dsh.engines.dsh` annidato passano a `>=0.2.0-rc.1 <0.2.1-0` (il cancello a runtime legge solo i peer, i metadata restano coerenti).
- **Cambio di generazione delle devDependencies**: `@deepseek-ai/dsh-tools` e `@deepseek-ai/dsh-sandbox` passano dalla linea 0.1.7 → `>=0.2.0-rc.1 <0.2.1-0`, il typecheck risolve così i tipi dell'host 0.2.0 — il «tutto verde» prova la compatibilità 0.2.0, non un residuo 0.1.7.
- **Giustificazione dello zero codice**: il composer/`forkSession` di 0.2.0 è un'estensione di firma retrocompatibile, questo plugin consegna le selezioni tramite la facciata `ctx.get('conversation').input` (senza chiamare `submit()`, senza contratto di override), quindi fuori dal perimetro d'impatto.
- Badge/matrice di compatibilità delle versioni/note di adattamento del README riscritti in chiave 0.2.0.

### Verifica
- Doppio typecheck tsconfig + build + vitest (656 passed / 11 skipped) contro `dsh-tools@0.2.0-rc.1`, tutto verde; `npm ls` senza invalid / conflitti tra peer.

### Altro
- Versione in `dsh-plugin.json` 0.17.0 → 0.18.0 (il campo restava indietro rispetto al package.json, allineato al passaggio in questa versione).
- Albero delle dipendenze ricostruito integralmente da npmmirror, `package-lock.json` rigenerato e committato.

## [Unreleased] — Pipeline in stile JEV: DOM+capture+intenzione → giudizio Laya/JEV (fase 10 / R5-R6, branch stage9-ego-cli)

### Aggiunte
- **Pipeline in stile JEV (T10.1–T10.19)**: contratto di frame (screenshot + DOM numerato + intenzione + avanzamento delle azioni) + giunzione di giudizio (restituire solo numeri, mai selettori).
  - Worker di rendering `bin/cdp-render-worker.mjs`: client CDP a connessione singola, `attachPage()` (enable di `Page/Runtime/DOM/Accessibility` nell'ordine M0.3), `gatherInteractive(limit)`, `captureWithinBudget()` (scala di qualità JPEG + sottocampionamento + `overBudget` riportato onestamente).
  - Tre primitive `noul`/`choice`/`score` (`src/jev/wire.ts`) + limiti di protocollo (`choice.criteria` non vuoto e ≤255, tabella vuota rifiuta sempre, perché un `criteria` vuoto è un 422 mal interpretato come fallimento del modello) + `validateQuestions()` che riporta tutto in una volta + `THRESHOLD_BUCKETS`/`bucketFor`.
  - Giunzione di giudizio `JudgeProvider` + catena di degradazione `jev → laya → rule → refuse` (**i non disponibili vengono saltati senza chiamarli**, ogni fallimento di salto entra nella trace; `refuse` è un risultato, non un'eccezione).
  - Superficie a quattro strumenti `bcdp_jev_status` / `bcdp_jev_frame` / `bcdp_jev_ask` (`dryRun` true per default, `round=control|chapter|pick` per gradi) / `bcdp_jev_run` (trace passo a passo). `attachGate()` intercetta in modo uniforme «nessun browser attivo»; `bcdp_doctor` guadagna cinque righe sulla catena di giudizio.
  - Ciclo `src/jev/loop.ts`: i sei effetti tutti iniettati, `BudgetLedger` verifica prima di spendere, terminazione a sei stati (incluso `exhaustedKind`), insieme di esclusione strutturalmente efficace, soglia di ricattura, `#PROGRESS` generato meccanicamente.
- **Priorità a laya (revisione del 2026-09-24)**: per default `judgePrefer='laya,rule'` (senza jev, poiché JEV non è registrabile); `jevUrl` vuoto significa non partecipazione. Senza chiave, `bcdp_jev_status` stampa il lancio locale (`ENGINE=laya … uvicorn laya_api.main:app`, porta 8000, `ALLOW_DEV_LOGIN=true`).
- **Capitolazione delle azioni (riduzione in tre livelli)**: il worker deduce dalla catena genitoriale AX dei `childIds` l'antenato strutturato più vicino come capitolo (whitelist `CHAPTER_ROLES`, numerazione per ordine di documento a parità di role: `form#1`/`form#2`); `control → chapter → pick`, con un solo capitolo il turno dei capitoli viene saltato; soglie suddivise in bucket per numero di candidati (20 → «pochi × pochi», entrambi i turni cadono nei bucket severi).
- **Isolamento del contesto di giudizio**: whitelist a quattro segmenti `INTENT/PROGRESS/FRAME/HISTORY` + asserzione post-assemblaggio `assertJudgeIsolation()` (qualsiasi titolo maiuscolo nudo è rifiutato); `IntentStateInput` è strutturalmente privo di campo session — **chi governa l'UI del browser non porta il prefisso di sessione completo**.
- **Interruttore di valutazione `jevEvaluate` (attivo per default, commit `208ae38`)**: dopo ogni passo, giudizio `inprogress/done/fail`; `fail` o «done non verificato» → `escalate`, con lista ordinata di `RecoveryOption[]` (`reload` per primo, un rendering stantio può nascondere una conferma già scritta), derivata da `recoveryFor(reason, lastAction)`.
- **class degli elementi operati conservata (commit `f79a272`)**: quando `act` colpisce un solo elemento, `DOM.getOuterHTML` viene recuperato pigramente e normalizzato via `bin/record-normalize.mjs` — le regole di riscrittura sono ammesse, ma i tratti di localizzazione come `class`/`id`/`role`/`aria-*`/`data-testid` sono **conservati**, si potano solo i token di guscio dell'ispettore (come `trae-browser-inspect-draggable`) e lo `style`; l'outerHTML completo entra in `Escalation.actedOn` per il recupero da parte del LLM, la reference compatta in HISTORY.

### Verifica
- Test complessivi 630 passed / 11 skipped (sonde gated); entrambi i `tsc` superati; `lib/index.js` da 206.613 → 316.544 → 317.402 B (prova in byte che i moduli sono cablati).
- Parapetti: `tests/worker-dispatch.test.ts` (asserisce che `act/reload/scroll/fill` cadono tutti su funzioni dichiarate — proprio la classe di bug che `ed6eccf` lasciò passare in silenzio), `tests/record-normalize.test.ts` (fissa class conservato / potatura dei token chrome / permanenza degli attributi di localizzazione).

### Limiti noti (onestà senza trucco)
- **Ancora niente end-to-end su macchina reale** (T10.22 da fare): gli unit test coprono protocollo/soglie/terminazione/capitoli/assemblaggio, non la catena reale.
- **Accuratezza del giudizio non misurata**: i bucket di soglia servono alla calibrazione, non provano che le scelte siano giuste.
- **Whitelist dei capitoli non calibrata su siti reali**: `CHAPTER_ROLES` deriva dalla tabella dei ruoli AX; se un sito mette tutti i controlli in `div` senza nome, tutto ricade nel capitolo unico `page`, degradazione al secondo livello (degradazione nota, non un errore).
- **`render.ts` si aggancia di nuovo a ogni chiamata**: le connessioni persistenti tipo session richiederebbero un contratto di spawn riprendibile dall'host, oggi inesistente — il costo è documentato.

## [Unreleased] — Polimorfismo dei tipi di connessione: oggetto di connessione CLI ego locale (fase 9 / R7, branch stage9-ego-cli)

### Aggiunte
- **Tipizzazione della sequenza di connessioni**: `BrowserLink = CdpLink | EgoCliLink` (campo discriminante `kind: 'cdp' | 'ego-cli'`). L'ordine dell'array **resta la priorità**, `activeTargetId` può puntare a entrambi i tipi.
- **Connessione CLI ego locale** (`kind='ego-cli'`, **solo macchina locale, al massimo una a livello globale**):
  - Catena di risoluzione del CLI a quattro livelli: `cliPath` esplicito → `ego-browser` nel PATH → helper nel bundle dell'app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime incorporata;
  - **Esplorazione della forma di spawn**: prima **esecuzione diretta**, in caso di `EACCES`/`ENOEXEC`/`ENOENT` ripiego su `node <path>` (il vero CLI è un eseguibile nel bundle dell'app, `ego-browser-v2`/la versione incorporata è JS — entrambe le forme esistono realmente, indovinare l'estensione renderebbe tutto inutilizzabile);
  - **Nessuna iniezione di `EGO_LINUX_CDP_URL`**: questa env appartiene solo al porting Linux incorporato, il CLI nativo macOS non la legge; è esattamente questa la ragione d'essere del tipo;
  - **La sonda di prontezza passa per un heredoc minimo** (lo stesso canale `nodejs` del lavoro vero); `--status` serve solo come scorciatoia **opportunistica** con breve timeout di 2 s (in caso di `unknown option` o non-JSON del CLI, degrado silenzioso, **senza verdetto di fallimento**);
  - Cinque codici di fallimento e **nessun ripiego silenzioso**: `cli-not-found` / `cli-not-executable` / `cli-probe-timeout` / `cli-probe-failed` / `cli-sdk-path-unsupported`.
- **`--sdk-path` come capacità facoltativa**: non trasmesso per default (si usa il harness ufficialmente abbinato del CLI); se l'attivazione esplicita viene rifiutata (`unknown option`) → annotato `cli-sdk-path-unsupported` e **un solo tentativo automatico senza quel flag**.
- Novità in `bcdp_doctor`: `links: n (cdp x, ego-cli y)`, `cli: <path> (<origin>, shape <shape>)`, `naming: … legacy ego_* aliases OFF/ON` e avviso `conflict:` se il plugin upstream è installato sulla stessa macchina.

### Modifiche (Breaking)
- Chiave di configurazione `cdpTargets` → **`links`** (la vecchia chiave viene letta come riserva per una versione, le sue righe equivalgono a `kind='cdp'`, **zero perdite**).
- Combinazione `cdpMode='remote'` + elemento attivato che è un CLI locale → `mode-kind-mismatch` esplicito (niente più deviazione silenziosa verso un altro elemento).
- La semantica di `remoteEnabled` si restringe al **solo CDP remoto**: le connessioni CLI locali restano inalterate.

### Correzioni
- Il separatore di percorsi e il separatore di PATH di `makeWhich` seguono ora la **piattaforma simulata** (prima i valori dell'host via `node:path` — una ricerca darwin/linux su Windows assemblava `dir\file` e non trovava mai nulla).

## [0.16.0] - 2026-09-23 — Chiusura della fase 2b + interruttore di disattivazione morbida del CDP remoto

### Aggiunte
- **Interruttore generale `remoteEnabled` (T2.18)**: disattivare temporaneamente il CDP remoto senza cancellare la sequenza di target — una volta spento, la sequenza resta intatta ma ogni esplorazione e connessione remota si fermano; le chiamate `bcdp_*` ricevono l'errore esplicito `remote-disabled`; interruttore visibile nella scheda impostazioni e in `bcdp_doctor`; riattivabile in ogni momento. Ortogonale a `allowLocalFallback` (con il remoto spento, auto può ricadere sul launcher locale).
- **`cdpMode=local` agganciato al launcher dedicato (chiusura 2b)**: la modalità locale ora avvia via M0.9 un browser gestito e ne inietta l'endpoint, la runtime incorporata vi si aggancia invece di avviarsi a freddo da sola; la cache viene marcata `endpointSource: local`.
- **Due nuove righe in `bcdp_doctor`**: `remote CDP: enabled/DISABLED` e `attach: <status> (source: …) @ <endpoint>` (visibilità completata nei tre punti, T2.16).

## [0.15.0] - 2026-09-23 — Launcher locale del browser (fase 2b / M0.9)

### Aggiunte
- **Avvio locale gestito**: quando `allowLocalFallback` è attivo e l'endpoint attivato è irraggiungibile, avvio automatico del Chrome/Chromium/Edge locale (scoperta esplicita → tabella dei candidati per piattaforma), iniezione di `http://127.0.0.1:<port>` e prosecuzione del lavoro; il badge di aggancio mostra `endpointSource: local-fallback`; **ritorno inverso vietato**.
- **Riuso in singleton** (T2.13): `launcher.json` registra pid/porta/profile; vengono riusate solo le istanze avviate da noi e ancora rispondenti.
- **Arresto e recupero** (T2.14): su win32 `taskkill /T /F` uccide l'albero completo (0 orfani misurati); il reaper di inattività recupera per via anche le istanze locali.
- **Impostazioni**: `localHeadless`, `localUserDataDir` (predefinito `~/.dsh/cache/dsh-browser-cdp/chrome-profile`, mai il profile quotidiano).
- **Politica delle porte** (T2.11): una porta libera viene preassegnata e passata esplicitamente, senza dipendere dai meccanismi non verificati DevToolsActivePort/porta 0.
- **Risoluzione dei conflitti di etichette**: titolo della tab/della sfera della finestra di osservazione «Agent 浏览器» → «CDP 浏览器» (analisi in findings A.5).

## [0.14.0] - 2026-09-23 — Referenze di selezione aggregate per pagina in blocchi dizionario, con la connessione CDP di origine

### Modifiche
- **Aggregazione per pagina**: una referenza trasporta solo il contenuto di una sola pagina web — gli elementi multipli della stessa pagina si fondono in **un solo blocco**, le selezioni su pagine diverse producono nuovi blocchi.
- **Involucro dizionario** (per analogia con gli allegati immagine pre-trasformati in blocchi): il blocco nella bozza ha questa forma:
  `[CDP-PICKS page="…" targetId="…" endpoint="…"]` + JSON (`cdpEndpoint`/`targetId`/`pageUrl`/`pageTitle`/`elements[]`) + `[/CDP-PICKS]`.
- **Origine rintracciabile**: il blocco contiene `cdpEndpoint` (il worker lo ricava da `active.wsUrl` togliendo `/devtools/*`) + `targetId`; ogni voce di `elements[]` porta un `backendNodeId` — `bcdp_cdp` può interrogare direttamente la struttura DOM dell'elemento via `DOM.describeNode({backendNodeId})`; si aggiungono `pageUrl`/`pageTitle`.
- worker: nuovo `PickElement.source` (`Target.getTargets` recupera i metadata di pagina + `getEndpoint` inietta la sorgente di connessione).
- Continuità semantica: nessun invio automatico (v0.13.0), continuazione della numerazione `n` sulla stessa pagina.

## [0.13.0] - 2026-09-23 — Consegna delle selezioni per referenze numerate, eliminato l'invio automatico

### Modifiche (Breaking)
- **Niente più invio automatico**: il percorso submit() di «Aggiungi alla conversazione» viene rimosso del tutto — qualsiasi azione di selezione si limita a scrivere nella bozza del campo di immissione, **l'invio resta sempre nelle mani dell'utente** (Invio nel campo o clic su invia).
- **Referenze numerate**: ogni selezione aggiunge alla bozza `[pick N] <descrizione dell'elemento>`, N prosegue automaticamente la sequenza dei `[pick N]` già presenti nel campo — le selezioni multiple formano un elenco ordinato.
- **La barra fluttuante passa a una sola azione**: «Riferisci nella conversazione (Ctrl+J o ↵)» — le due scorciatoie sono equivalenti, nello stato confermato appare «✓ Riferito nel campo di immissione».

## [0.12.0] - 2026-09-23 — De-ego: identità di proxy browser CDP (fase 8)

### Modifiche (Breaking)
- **33 strumenti `ego_*` → `bcdp_*`**: `bcdp_status` / `bcdp_navigate` / `bcdp_doctor` … (prefisso derivato dall'id del plugin, libero nell'ecosistema). Gli script che citano i vecchi nomi possono transitare dal nuovo setting `legacyEgoToolNames: true` (registra in più gli alias `ego_*`; mutuamente esclusivo con il plugin upstream ego-browser).
- **Route HTTP `/api/ego/*` → `/api/bcdp/*`**, gateway delle impostazioni `/ego/api/*` → `/bcdp/api/*` (pannello sincronizzato).
- **Rinomina delle risorse**: `bin/ego-cast-worker.mjs` → `bin/cdp-cast-worker.mjs`, `bin/ego-chrome-wrapper.sh` → `bin/cdp-chrome-wrapper.sh` (logiche di corrispondenza/pulizia dei processi worker sincronizzate).
- **Chiave di configurazione** `egoCliArgs` → `runtimeArgs` (la vecchia chiave viene letta automaticamente per una versione, nessuna perdita di impostazioni).
- **Testi**: l'autodenominazione del pannello EN/ZH unificata in «CDP 浏览器代理 / CDP browser bridge», senza più inizio in ego; README sincronizzato.
- Il cablaggio interno (variabili d'ambiente `EGO_LINUX_*`) e il nome della directory della runtime vendored **non cambiano deliberatamente** (sicurezza degli aggiornamenti).
- Effetto collaterale: **possibile coesistenza** con l'upstream `Fisfzy/ego-browser` (nomi degli strumenti/route tutti sfalsati).

## [0.11.1] - 2026-09-23 — Correzioni: due giudizi errati dello stato di selezione nel pannello

### Correzioni
- Lo stato intermedio `picked` del worker (catturato, in attesa di azione) veniva scambiato dal pannello per un fallimento mostrando «selezione fallita» — ora compare correttamente la descrizione dell'elemento.
- All'armamento del pannello la base delle consegne veniva allineata a `picks`, inghiottendo la consegna della selezione fatta **prima dell'armamento** — la base arretra di un grado, la selezione in attesa di azione viene necessariamente consegnata.

# Changelog

Tutte le modifiche visibili all'utente sono raggruppate sotto il rispettivo numero di versione. Il formato segue [Keep a Changelog](https://keepachangelog.com/), la semantica delle versioni segue [SemVer](http://semver.org/).

## [0.11.0] - 2026-09-23 — Consegna M1.6 alla conversazione + percorso di ripiego della selezione per coordinate

### Aggiunte
- **Consegna dei risultati di selezione nella conversazione (M1.6 / T5.6–T5.7)**: le due azioni della barra fluttuante di pagina ora scrivono davvero nella conversazione — «Commenta nella conversazione» scrive la descrizione dell'elemento nella bozza del campo di immissione (l'utente completa il commento e invia da sé); «Aggiungi alla conversazione» scrive nella bozza e **invia automaticamente** (lo stesso percorso adjudication del pulsante invia). Prima dell'invio viene verificato `phase === 'plain'`; una sola consegna per selezione; il risultato (✓ inviato alla conversazione / ✓ scritto nel campo / consegna fallita + motivo) viene mostrato in feedback sulla riga di stato della finestra di osservazione.
- **Percorso di ripiego della selezione per coordinate (T5.1b)**: in modalità selezione, fare clic sullo screenshot in diretta della finestra di osservazione = selezionare — le coordinate convertite vengono inviate al worker, con risoluzione del punto colpito via `DOM.getNodeForLocation` (senza dipendere dal canale eventi Overlay), percorrendo la stessa pipeline descrizione/misura/iniezione UI. Supportato sia nella barra laterale sia nella finestra fluttuante.
- worker: nuova `POST /api/pick/click {targetId, x, y}`; l'host inoltra in sincronia `/api/ego/pick/click`.

### Note
- Un clic sul vuoto che non tocca alcun nodo segnala esplicitamente «selezione fallita (no-node-at-point)», senza ritorno silenzioso a idle (fixture dei clic sul vuoto, T5.8).

## [0.10.0] - 2026-09-23 — Fondamenta CDP P0 + selezione di elementi (corpo R6) + Set-of-Marks (R4)

### Aggiunte
- **Selezione di elementi (corpo R6)**: la barra strumenti della finestra di osservazione guadagna un interruttore «Seleziona elemento» (uno nella barra laterale e uno nella finestra fluttuante, entrambi a sinistra di «Apri la pagina reale»). Una volta attivato, si selezionano elementi nella vera pagina scelta: cornice di selezione azzurra 2 px + barra fluttuante incollata all'elemento, con due azioni «Commenta nella conversazione Ctrl+J» / «Aggiungi alla conversazione ↵», poi compare sul posto «✓ Trasferito alla conversazione» e si ritira dopo 2,5 s; al termine di un'azione la modalità selezione si riarma automaticamente, le selezioni in serie non richiedono il ritorno al pannello. Cambiare scheda / chiudere il pannello esce dalla selezione e ripulisce la UI iniettata.
- **Cattura Set-of-Marks (meccanismo + gateway R4)**: `POST /api/ego/marks` restituisce in una chiamata screenshot + mappa numerata degli elementi interattivi in ordine di documento (filtro dell'albero AX, `n = 1..N`, con rect del viewport e descrizione semantica su una riga), evidenziazione di un singolo elemento opzionale. Implementazione puramente CDP, zero iniezioni nella pagina; la mappa numerata è l'alternativa al vincolo di Overlay che può evidenziare un nodo alla volta (vincolo misurato).
- **Fondamenta della sessione CDP permanente (P0)**: sotto `src/cdp/` — endpoint (normalizzazione/scoperta degli endpoint, 8 codici di errore strutturati), session (accoppiamento degli id di comando/timeout per comando/riconnessione con backoff/**riesecuzione della sequenza enable dopo la riconnessione**), events (distribuzione per dominio/affinità di stato dei domini/ordine `DOM.enable → Overlay.enable`), dom, input (**nessun percorso di scrittura diretta di `.value`**, rivisitazione del punto di clic), page (semantica delle coordinate documento per il clip della cattura, `highlightConfig` forzato nel processo, `Runtime.addBinding`).
- **Sonde su macchina reale** (attivate da `CDP_PROBE_URL`, saltate per default): scoperta 19 ms → connessione 7 ms → comando 1–5 ms → ritorno binding 42 ms, prova su tutta la catena.

### Note
- **Confine di consegna**: il «trasferito alla conversazione» della barra fluttuante di pagina è per ora uno stato UI; il cablaggio lato host per scrivere nel campo di immissione della conversazione (`conversation.input.for(actx).setDraft/submit`) non è terminato, i risultati di selezione sono attualmente osservabili via `lastPick`/`lastAction` di `GET /api/ego/pick`.

## [0.9.1] - 2026-09-23 — Correzione: target CDP che spariscono dal pannello dopo il salvataggio

### Correzioni
- **Dopo un salvataggio riuscito del pannello impostazioni, l'intera sequenza di target CDP spariva dall'interfaccia (i dati erano in realtà scritti)**: nel ricostruire la bozza delle impostazioni con la config restituita dal server nel callback di successo del salvataggio, tre campi erano stati dimenticati — `cdpTargets` / `activeTargetId` / `cdpMode` (presenti in `load()`, assenti in quel percorso). Dopo «aggiungi target → inserisci endpoint → salva», i target ricadevano subito su «ancora nessun target», mentre `~/.dsh/settings.yaml` conteneva i target giusti e il giusto `activeTargetId`. I tre campi sono stati completati nel percorso di successo del salvataggio, allineati a `load()`.
  > Nota d'indagine: `ALLOWED_KEYS` lato `/ego/api/set` come `sanitizeJsonArray` funzionavano normalmente, il problema stava solo nella ricostruzione della bozza lato client; né il gateway né lo schema perdevano campi.

## [0.9.0] - 2026-09-23 — Sequenza di target CDP + attivazione (R1) + nome del pacchetto unificato in dsh-browser-cdp

### Aggiunte
- **Sequenza di target CDP e attivazione (R1)**: nuove configurazioni `cdpTargets` (sequenza ordinata) / `activeTargetId` (attivazione a punto singolo) / `cdpMode` (`auto`/`local`/`remote`) / `cdpProbeTimeoutMs`. Ogni strumento `ego_*` pilota **il** endpoint attivato, non il browser locale.
- **Editor di sequenza nel pannello impostazioni**: aggiunta/rimozione/modifica dei target + ordinamento verticale, attivazione via radio, pulsante «sonda» per voce e badge di raggiungibilità (stato in tempo reale via polling da `/ego/api/cdp-status`). La validazione degli endpoint accetta solo `http(s)://host:port` o `ws(s)://…`, uno schema illegale produce un errore esplicito invece di un'interpretazione silenziosa.
- **Catena di attivazione esplicita**: `resolveEgoEnv` inietta `EGO_LINUX_CDP_URL` secondo `cdpMode`; le modifiche delle impostazioni (e il primo avvio) innescano `refreshAttach` per riverificare l'endpoint attivato, e quando l'endpoint cambia `setAttachEndpoint` riavvia il cast worker perché si riagganci allo stesso browser. La tabella di decisione `decideAttach` garantisce che un fallimento non ricada **mai silenziosamente** sul browser locale — sotto `auto`/`remote`, senza attivazione o se irraggiungibile, si restituisce sempre un errore strutturato.
- **Nuovi endpoint del gateway**: `POST /ego/api/cdp-status` (lettura dello stato di attivazione in tempo reale), `cdp-refresh` (riverificare manualmente e rinfrescare l'aggancio del worker), `cdp-probe` (sonda a colpo singolo su un endpoint qualsiasi, risultato riscritto nei campi `probe*` del target).
- **Nome del pacchetto unificato in `dsh-browser-cdp`**: `cordis.patch.yml`, `dsh-plugin.json` (`id`/`name`/Scene·SettingsSection id/namespace), namespace delle impostazioni, id della tab sidebar lato client (`dsh-browser-cdp:watch`), testi di locale e prefissi dei log tutti allineati.
- **Pubblicazione del repository su `github.com/drscrewdriver/dsh-browser-cdp`**: `package.json#repository` e `dsh-plugin.json#source` ripuntati dal repository upstream `Fisfzy/dsh-ego-browser` (MIT, attribuzione conservata) a questo repository. Installazione diretta da GitHub supportata: `dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp` (pnpm recupera il tarball via `codeload.github.com`, nessuna pubblicazione nel registro), possibilità di fissare con `#v0.9.0` / `#<sha>`.

### Test
- Nuovo `tests/cdp-targets.test.ts` (26 casi): `normalizeEndpoint` / `sanitizeTargets` / ausiliari di sequenza / `probeEndpoint` (fetch iniettabile, senza leggere l'orologio reale) / `decideAttach` / `refreshAttach`+cache. Copertura completa dei percorsi di analisi, sonda e decisione di `cdp-targets.ts`.

## [0.8.5] - 2026-09-18 — Import dello stato di accesso + recupero a riposo + lotto di correzioni della finestra di osservazione

### Aggiunte
- **Import dello stato di accesso dal browser di sistema (#46)**: nuovo strumento `ego_login_import` + blocco «importa lo stato di accesso dal browser di sistema» nella scheda impostazioni + route `POST /api/ego/login-import`. Copia per dominio i cookie di accesso del Chrome/Edge/Brave quotidiano nel browser dell'agent: avvio headless del vero binario con il vero Profile (alias di junction per aggirare il vincolo CDP della directory predefinita di Chromium ≥136, soddisfacendo insieme l'aggancio di percorso dell'App-Bound Encryption), lettura via CDP `Storage.getCookies`, filtraggio, scrittura nel Profile persistente via `Storage.setCookies`. Supporto per `source/domains/profile/closeSource/dryRun`; se il browser di origine è in esecuzione si può chiuderlo con grazia prima dell'import (la finestra si ripristina al prossimo avvio); **backup automatico del database dei cookie di origine prima dell'import, ripristino automatico in caso di svuotamento rilevato**; i valori dei cookie non entrano né nei log né negli output.
- **Recupero automatico a riposo (#47, opt-in)**: nuova impostazione `idleTimeoutMin` (predefinito 0, disattivato). Dopo N minuti senza chiamate `ego_*`, arresto con grazia `--stop` del browser in background (a riposo misurati ~425 MB), al prossimo appel avvio a freddo in 2-4 s. Guardare la finestra di osservazione non conta come attività (annotato nel testo delle impostazioni).
- **Pulsante «Pop-out» della finestra di osservazione (#51)**: la finestra fluttuante e la tab della barra laterale guadagnano un pulsante che chiama il comando runtime `ego-browser --open` — l'istanza headless viene sostituita sul posto da una finestra con interfaccia dello stesso Profile (schede conservate), un'istanza con finestra viene portata in primo piano. La conclusione che l'anteprima CDP in modalità headless è già utilizzabile è stata verificata anche in pratica.

### Correzioni
- **Cattura del viewport tutta bianca dopo lo scorrimento (PR #50)**: l'origine del clip di `Page.captureScreenshot` è in coordinate documento; la cattura del viewport era fissata a `{x:0,y:0}`, e dopo lo scorrimento il clip cadeva in una zona non dipinta (`captureBeyondViewport: false`), da qui l'immagine vuota. Ora si usa `pageInfo().sx/sy` (`scrollX/scrollY`) come origine del clip; anche il boundingBox del viewport del locator riceve l'offset di scorrimento, in linea con il followClip di `spaces-server`.
- **Il link esterno della chat veniva catturato dalla finestra di osservazione e non si renderizzava (#48)**: la dichiarazione `urlTarget` della tab della barra laterale era troppo larga (rivendicava tutto l'http(s)) mentre quella tab è solo un'immagine in streaming. Dichiarazione rimossa, i link esterni tornano alla scheda browser incorporata.
- **Dopo il riavvio del browser tutti gli `ego_*` segnalavano task space not found**: l'id numerico dello space ricordato lato plugin restava appeso dopo il riavvio. Nuovo `runWithStaleSpaceRetry`: alla rilevazione di questo errore, ricostruzione automatica per nome dello space e una sola ripresa (copertura completa degli strumenti di azione + ego_cli/ego_captcha/ego_script).
- **In multi-sessione la finestra di osservazione si apriva nella sessione sbagliata (#53, PR #54)**: `markEgoToolCall` trasporta l'id della sessione chiamante, l'apertura automatica localizza la barra laterale per sessione; la guardia a uso singolo diventa per sessione, il flusso di rilevamento resta permanente.

### Comunità
- Integrati i PR #50 (correzione screenshot, hpqc032), #52 (i18n inglese della finestra di osservazione, M4cd1r; abbiamo aggiunto una correzione del valore predefinito di `wt()` per ripristinare il typecheck), #54 (portata di sessione, xiaochaZ).

## [0.8.4] - 2026-09-15 — Correzioni della catena di avvio del worker della finestra di osservazione + integrazioni di PR comunitari

### Correzioni
- **La finestra di osservazione non partiva mai su DSH ≥ 0.1.5 (#34 / #38 / #43)**: allo spawn del worker mancava il `cwd` obbligatorio per il subprocess provider di 0.1.5, e l'eccezione veniva inghiottita da un `catch` nudo, così `ensureWorker()` restituiva sempre null. Aggiunto `cwd`.
- **Il worker si uccideva all'avvio (difetto 2 di #34 / #40)**: la corrispondenza per sottostringa lasca di `stopSiblingWorkers()` scambiava il subprocess runner di DSH per un worker paritario, e `taskkill /T` ammazzava in blocco il proprio albero di processi — il worker moriva prima di scrivere `ego-cast.json`. La corrispondenza si stringe su «l'argomento di script diretto di node è ego-cast-worker.mjs», con esclusione della propria catena di antenati.
- **Sull'host Electron (DSH Desktop) tutti gli `ego_*` segnalavano no @@DSH_RESULT@@ (#42)**: con un env esplicito passato allo spawn mancava `ELECTRON_RUN_AS_NODE`, e il processo figlio partiva come una seconda applicazione Electron. `resolveEgoEnv` e lo spawn del worker aggiungono automaticamente `ELECTRON_RUN_AS_NODE=1` quando esiste `process.versions.electron`.
- **Risposta vuota di /api/ego/stream quando il worker è giù (#39, PR #44)**: `proxyWorkerStream(-1)` va in cortocircuito su SSE silenzioso (scrive l'header `text/event-stream` e resta in silenzio sulla connessione lunga), senza innescare il `ERR_SOCKET_BAD_PORT` che strappava la connessione; con 42 righe di nuovi test.
- **Su Windows EGO_LINUX_HEADLESS veniva ignorato in silenzio (#35)**: il `EGO_LINUX_HEADLESS=1` esplicito ha ora priorità sull'inferenza predefinita `hasDisplay=true` di win32, coerente con la guida CLI / la documentazione README.
- **Avvio web del client interamente bloccato su host senza dsh-better-sidebar**: l'elenco statico di inject del client rimuove `betterSidebar` (il loader avrebbe atteso per sempre il servizio assente), sostituito da rilevamento via `ctx.get` + montaggio immediato della sfera di osservazione fluttuante + promozione a tab della barra laterale via `ctx.inject` quando il servizio compare (grazie allo schema del PR #45).

### Aggiunte
- **Interruttore di isolamento sandbox degli spazi di lavoro `isolateSpaces` (PR #31)**: disattivato per default, gli spazi di lavoro riutilizzano il Profile persistente su disco e lo stato di accesso sopravvive ai riavvii (copre la richiesta di #1); attivandolo si ritorna all'isolamento sandbox in memoria. Le descrizioni degli strumenti `ego_space_open`/`ego_space_close` si iniettano dinamicamente secondo la modalità; corretta l'impossibilità di persistere le impostazioni booleane del gateway.

### Altro
- Corretti i segnaposto del template `allowBuilds` non compilati in `pnpm-workspace.yaml` che impedivano a pnpm 11 di installare; aggiunta una fixture di config per `isolateSpaces` nei test.
- Integrati i PR #36 (matrice di compatibilità delle versioni del README), #31, #44; chiuso il #45 ormai superato.

## [0.8.3] - 2026-09-07 — Compatibilità DSH 0.1.2-rc.1 + correzioni sicurezza/stabilità

### Sicurezza
- **Corrette le route `/api/ego/*` senza autenticazione**: le route esatte venivano colpite prima della barriera di fiducia del prefisso `/api` dell'host, così `GET /api/ego/stream` lasciava uscire frame in diretta senza credenziali e `POST /api/ego/input` consentiva di immettere input senza credenziali (pilotaggio intersito). Avvolgimento uniforme di webServer.register: tutte le route ego richiedono un cookie `dsh-auth-*` SameSite=Strict, che le pagine malevole naturalmente non portano; la guardia agisce solo sulle route del plugin stesso, senza inquinare le registrazioni degli altri plugin sul singleton dell'host.

### Correzioni
- **Errore di avvio del client su host senza dsh-better-sidebar (#29)**: l'`inject` dichiarato in modo rigido e l'accesso nudo alla proprietà `ctx.betterSidebar` sollevavano «without inject» con resolver severo. La dichiarazione resta (è una condizione di risoluzione) + l'accesso viene avvolto in try/catch con passaggio esplicito del parametro — un host senza sidebar ricade sulla sfera fluttuante invece di congelarsi tutto.
- **Regressione dell'avvio a freddo su Windows**: il supporto Xvfb di #22 faceva passare il default da headless ad avvio di Xvfb in assenza di `DISPLAY`, ma Windows ha una sessione desktop e nessun Xvfb → avvio a freddo fallito con «no X display / no Xvfb binary». `ensureXDisplay` e l'`hasDisplay` d'ingresso guadagnano un ramo win32 (la sessione desktop conta come display, le finestre con interfaccia si aprono direttamente, ritorno al comportamento di adattamento di v0.4.0).
- **Whitelist delle impostazioni del gateway senza `egoCliArgs`/`chromeArgs`**: `/ego/api/set` scartava in silenzio questi due campi di configurazione, impossibili da persistere — aggiunti a `ALLOWED_KEYS`.

### Integrazioni (PR comunitari + locale)
- Integrati 6 PR comunitari: `#20` esecuzione root, `#22` xvfb, `#16` rilevazione headless macOS, `#24` correzione schemastery `link:`, `#28` compatibilità DSH 0.1.2-rc.1/v0.1.3-alpha.1 (peer/engines inasprite), `#13` stabilità Windows.
- Corretto l'errore di sintassi JSON del manifesto causato da una virgola mancante in dsh-plugin.json (sorgente del blocco di inclusione nelle directory).
- Aggiunto il LICENSE MIT; completate le note supply chain/permessi; i `*.map` non sono più tracciati.
- Audit ufficiale build-dsh-plugin superato: `status: READY_FOR_PINNED_SOURCE_VERIFICATION`, `route: direct`, `blockers: 0`.

### Compatibilità
- `engines.dsh: >=0.1.2-rc.1`; peer dependencies tutte fissate su `>=0.1.2-rc.1`.
- Su DSH 0.1.2-rc.1 (Windows/web profile) completati installazione, avvio, chiamata reale di `ego_navigate` e accettazione del pannello di osservazione in diretta; `0.1.2-alpha.x` dichiarati installabili ma non testati; `<0.1.2-rc.1` → usare v0.8.0 e precedenti.

## [0.8.1] - 2026-08-28 — Compatibilità DSH 0.1.2-alpha.1

### Modifiche
- **Migrazione della metà client a `@deepseek-ai/dsh-client-store`**: 0.1.2-alpha.1 rinomina `@deepseek-ai/dsh-client-runtime` (incluso il sotto-percorso `/client`) in `@deepseek-ai/dsh-client-store` (il grafo di moduli client usa il nome di pacchetto nudo come id di modulo statico). La firma di `createSnapshotStore` non cambia.
- **Id di registrazione del modulo client = nome di pacchetto dichiarato `dsh-ego-browser`**: in 0.1.2 l'id delle righe del boot manifest è generato dal `name` del package.json, e il nome della specifica di riga del loader deve coincidere (verifica di uguaglianza del nome `nearestPackage`); un mount via alias (chiave di caricamento junction `@dsh-external/ego-browser`) veniva giudicato «not a client row» dallo scanner → il pannello di osservazione spariva in silenzio. Il banner ID di tsdown e il nome di riga in `cordis.patch.yml` sono unificati al nome del pacchetto dichiarato; il `dsh-ego-browser` nel `dsh-plugin.json` resta invariato.
- **`dsh.client.inject` dichiara solo le vere righe del grafo**: in 0.1.2 `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots` sono moduli statici (fuori dal grafo di moduli); dichiararli come archi di iniezione lasciava la voce in pending silenzioso (modulo non materializzato, pannello non montato, nessun errore). Restano solo locale / ui-settings-plugins, le due vere righe del grafo.
- **Il servizio opzionale webServer passa alla consegna tramite iniezione annidata**: il resolver rigoroso dei servizi di 0.1.2 restituiva undefined per `ctx.get('webServer')` senza dichiarazione di iniezione → route di osservazione `/api/ego/*` silenziosamente non registrate → livello dati del pannello in 401/stato vuoto. Passaggio a `ctx.inject(['webServer'], cb)` (route registrate solo quando il servizio c'è; gli host TUI/headless senza server web restano tools-only senza blocco).
- **Peer dependencies allineate alla famiglia 0.1.x** (client-locale / client-ui-slots / client-ui-settings-plugins / dsh-settings / dsh-tools dichiarate `>=0.1.1-rc.2`), `engines.dsh: >=0.1.2-alpha.1`.
- Verificato dopo le correzioni: moduli client normalmente materializzati, tab sidebar «Agent 浏览器» e flusso di osservazione/presa in carico utilizzabili, route `/api/ego/*` a 200, streaming in diretta su `streaming`, catene di clic/immissione sull'immagine raggiungibili (pointerdown → `/api/ego/input` → dispatch CDP).

## [Unreleased]

Doppio pipeline d'immagine per la finestra di osservazione: correzione della radice del protocollo CDP, aggiunta di un backend opzionale FFmpeg H.264/fMP4.

### Aggiunte / miglioramenti
- **Parametri di avvio personalizzati**: la scheda impostazioni guadagna due campi, «parametri CLI aggiuntivi per ego-browser» e «parametri di avvio aggiuntivi per Chrome». I primi si aggiungono all'argv di `ego-browser nodejs` e fanno effetto dalla prossima chiamata di uno strumento `ego_*`; i secondi vengono pontati via `EGO_LINUX_EXTRA_ARGS` al `launch()` della runtime vendored, con effetto solo al prossimo avvio a freddo del browser (il browser è un singleton residente — serve `ego-browser --stop` o un riavvio di DSH perché si riavvii). Entrambi i lati mettono in lista nera i flag che romperebbero il piano di controllo autogestito del plugin (`--status`/`--stop`/`--help`/`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` ecc.); per `--proxy-server` passare per `EGO_LINUX_PROXY`. `ego_doctor` riporta i parametri attualmente in vigore.
- FFmpeg passa a installazione esplicita su richiesta: CDP non dipende più da `ffmpeg-static` e non lo installa più. La pagina impostazioni rileva prima il percorso personalizzato, il PATH di sistema e la cache gestita; l'opzione FFmpeg resta disattivata finché la verifica di compatibilità non è completata, con download a un clic a versione fissa e verifica SHA-256.
- Nuovo `githubMirror`: sostituisce `https://github.com` con la base HTTPS indicata dall'utente; su Windows/Linux tag di release BtbN fissato, su macOS asset di piattaforma fissi. Il download entra in una directory temporanea di `~/.dsh/cache/ego-browser/ffmpeg/`; la pubblicazione atomica avviene solo dopo verifica, estrazione e sonda di capacità tutte riuscite.
- L'immagine di osservazione guadagna un proxy di immissione da tastiera parziale: testo normale e incolla via `Input.insertText`, l'IME cinese viene inviato in una volta al termine della composizione, i tasti di controllo e le scorciatoie via `Input.dispatchKeyEvent`. Il focus viene preso solo dopo un clic sull'immagine di osservazione, senza rubare l'immissione di DSH stesso.
- Nuova impostazione `ffmpegBitrateKbps` (500-20000 kbps); predefiniti 2000/4000/8000 kbps per basso/bilanciato/alto. L'encoder usa bitrate obiettivo, bitrate di picco e buffer VBV, sostituendo il valore predefinito di circa 200 kbps di `h264_mf` e il `libx264 crf=28`.
- La finestra di DSH passata in background non spezza più watch/SSE/video; il TTL del lease sale a 120 secondi, e le richieste start/switch/renew vengono deduplicate in single-flight, per evitare che la throttling dei timer in background generi catture scadute e alternanza senza fine di `starting`.
- `CaptureManager` + lease del watcher: contemporaneamente un solo backend attivo e un solo target osservato; a pannello nascosto la cattura si ferma.
- Il backend CDP distingue correttamente l'ID di ACK del frame e la session flattened del target, gli errori di protocollo sono visibili; 20 FPS per default, limitazione latest-frame, retroguardia a target singolo, rimozione del ridisegno forzato delle animazioni trasparenti.
- Backend FFmpeg: Windows usa `gfxcapture(hwnd)` per catturare direttamente la superficie D3D11 della finestra Chrome, le altre piattaforme conservano il crop della sorgente di visualizzazione; codifica in H.264 fragmented MP4, riproduzione via HTTP binario e MediaSource, isolamento dei dati dei processi vecchi per generation.
- Nuove impostazioni: `captureBackend`, fasce di qualità, FPS CDP/FFmpeg, larghezza massima e encoder; migrazione centralizzata dei vecchi campi.
- Nuovi test unitari: parser MP4, ACK CDP, CaptureManager, migrazione di configurazione, argv per piattaforma.

### Limiti di piattaforma
- Windows richiede un FFmpeg che includa `gfxcapture`; l'HWND viene abbinato via PID del browser, titolo del target e confini della finestra CDP; anche con la finestra coperta o spostata la pagina target resta catturata, e il ripiego su `gdigrab desktop` è vietato. Il comportamento a finestra minimizzata resta deciso da Windows Graphics Capture.
- Linux X11 usa `x11grab`, macOS `avfoundation` come crop dello schermo; occlusione e permessi di sistema incidono ancora su entrambe le piattaforme.
- Wayland: senza input Portal/PipeWire utilizzabile del FFmpeg in bundle, messaggio esplicito `unsupported-ffmpeg-pipewire`, niente `kmsgrab` root, nessun cambio silenzioso sull'intero desktop e nessuna finzione di successo.

### Correzioni
- **Mouse a tratti del tutto senza richieste / tastiera sempre inutilizzabile**: il piano di controllo non dipende più da `streamState` né dalla sincronizzazione spaces, invia solo in base al target dell'immagine corrente; il worker conserva la verifica finale dei target stanti. Prima il frontend non aveva alcun ascoltatore di tastiera né supporto di protocollo — l'intero percorso text/keyDown/keyUp viene qui colmato.
- **FFmpeg in esecuzione ma la tab mostrava CDP**: lo stato di cattura viene ora unificato da SSE, risposta watch, spaces capture e watch/status; in assenza di backend si conserva il valore corrente, la sovrascrittura per default su CDP è vietata.
- **Finestra about:blank residua dopo `space_open`**: lo space di lavoro aperto con successo diventa lo space attivo più recente; gli strumenti successivi che omettono `space` (navigate/click/fill ecc.) riutilizzano quello space invece di ricadere sul fisso `dsh-agent` creando una seconda finestra. Alla chiusura dello space attivo si torna ai valori predefiniti della configurazione.
- **watch/start 502 e input 500**: la sonda di capacità del binario FFmpeg e di `gfxcapture` passa a sottoprocesso asincrono, la salute del worker non è più bloccata durante l'avvio; il timeout del proxy worker per watch start/switch sale a 30 secondi, coprendo il tetto completo di finestra, encoder e init MP4. L'host passa attraverso lo status HTTP del worker e l'errore JSON tali e quali, e restituisce 502 solo se il worker è davvero irraggiungibile. L'input è validato sia lato client sia lato worker; un target invalido restituisce 409 `capture-target-stale`, non più confezionato come 500.
- **FFmpeg scelto nelle impostazioni ma la tab mostrava ancora CDP**: quando più fibre caricavano il plugin insieme, il ponte impostazioni registrato dopo, davanti a un namespace duplicato, ricadeva per errore su una composition config vuota, e il cast worker riceveva `captureBackend:auto`. Ora lo stesso servizio impostazioni condivide uno scope unico; la scheda impostazioni, il gateway e il cast-server leggono sempre la stessa configurazione persistita. Un worker a riposo che riceve un aggiornamento di configurazione pubblica subito il nuovo stato del backend, senza conservare la vecchia etichetta CDP.
- **FFmpeg su Windows non registra più la finestra in primo piano dell'utente**: prima i parametri erano fissi — `gdigrab ... -i desktop` — con un ritaglio per coordinate di pagina solo all'avvio, così appena Chrome passava in background, DSH o un'altra applicazione che copriva l'area finivano in streaming. Ora il target viene prima risolto in HWND via `Browser.getWindowForTarget` e l'enumerazione Win32 delle finestre di primo livello, poi `gfxcapture` cattura la superficie della finestra isolata; le diverse finestre Chrome dei diversi spazi di lavoro ricevono HWND distinti. Una tab in background della stessa finestra segnala `ffmpeg-target-not-visible`, senza mostrare la tab sbagliata né rubare il focus di propria iniziativa.
- L'encoder di Windows privilegia il percorso hardware D3D11 di `h264_mf`; la sonda dell'encoder usa una pipeline reale con HWND, per evitare che un fotogramma di prova software dichiari falsamente indisponibile l'encoder hardware. `fps/setpts` espliciti fissano 30 FPS, la frammentazione fMP4 scende a 100 ms, e `skip_trailer` evita l'errore del parser `mfra` negli arresti con grazia.
- **Lo stato di accesso sopravvive ai riavvii di DSH (fedele alla filosofia dell'ego-lite originale)**: prima, dopo un riavvio manuale / un'uccisione forzata di DSH bisognava riaccedere — alla ricezione di SIGTERM/SIGINT il worker si limitava a staccarsi senza scrivere su disco, e la grazia di 4 s del `--stop` al teardown del plugin non bastava, finendo spesso nel ripiego di crash SIGTERM. Ora, prima di spegnersi, il worker invia al browser un CDP `Browser.close` (chiusura con grazia, il journal dei cookie viene fuso nel profile su disco), e la grazia del teardown del plugin sale a 8 s, abbastanza per chiudere con grazia fino in fondo. **Verificato in pratica**: dopo riavvio con grazia l'accesso resta integralmente conservato; anche dopo uccisione forzata (SIGKILL) lo stato di accesso di lunga durata è scritto su disco e rileggibile al riavvio.

### Rifacimento ingegneristico
- **Migrazione da JS puro → TypeScript (PR #14)**: le sorgenti traslocano da `lib/` a `src/` (`src/index.ts` livello strumenti, `src/client/index.ts` frontend, `src/worker/ego-cast-worker.ts` worker), `lib/` e `bin/ego-cast-worker.mjs` diventano artefatti di build (precompilati e versionati). La catena di build diventa `pnpm typecheck` (barriera dei tipi tsc, tsconfig.json + tsconfig.client.json) + `pnpm test` (vitest) + `pnpm run build` (tre bundle tsdown). I test migrano in parallelo da `tests/*.test.mjs` a `.test.ts` con aggiunta di `vitest.config.ts`. `lib/` non si modifica più a mano.

## [v0.8.0] - 2026-08

Integrazione della tab sidebar: quando `dsh-better-sidebar` è disponibile, la finestra di consultazione in diretta si registra come tab nativo della sidebar invece che come finestra fluttuante.

### Aggiunte
- **Integrazione della tab dsh-better-sidebar**: `apply()` rileva opportunisticamente il servizio sidebar via `ctx.get('betterSidebar')` (non `ctx.betterSidebar` — ciò richiederebbe una dichiarazione `inject`, farebbe del sidebar una dipendenza rigida e senza di esso avrebbe impedito a tutto il plugin, scheda impostazioni compresa, di caricarsi); se disponibile, registra via `registerTab()` una tab `ego-browser:watch` (`single: true`, residente), altrimenti ricade sulla finestra fluttuante originaria. È il modello documentato di consumo dei servizi opzionali di DSH (vedi nota approval-seam, postmortem 0001).
- **Apertura automatica della tab alla prima chiamata di uno strumento `ego_*`**: i percorsi execute di `defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` chiamano `markEgoToolCall()` per incrementare il contatore lato host, contatore distribuito con la risposta di `/api/ego/spaces`. `LivePreviewController` rileva il salto 0 → >0 e chiama `ctx.get('betterSidebar').openTab({ type: 'ego-browser:watch' })`, la tab si schiude automaticamente. Il flag `autoOpened` garantisce una sola apertura per sessione.
- **Componente tab React `EgoBrowserTab`**: rende il contenuto della tab sidebar con `React.createElement` + `bindSnapshotSelector` (testata / barra delle schede / vista principale in diretta / strato cronologia / fasce di avviso login e captcha). La traccia di navigazione passa dal cassetto laterale allo strato sovrapposto (il pulsante cronologia prende l'intera area di contenuto della tab, un clic su una voce entra nell'anteprima o torna alla diretta), adattato alla larghezza ridotta della sidebar.
- **Classe vanilla `LivePreviewController`**: estratta dal codice DOM imperativo della finestra fluttuante — polling / SSE / cache dei frame / zoom / mappatura inversa delle coordinate di immissione / logica di inseguimento automatico — perché il componente React vi si abboni via `subscribe`+`getSnapshot` e inoltri gli eventi pointer/wheel tramite chiamate di metodi. Il controller tiene direttamente la ref del `<img>` per sostituire `src` sul posto alla frequenza di fusione rAF, senza costringere React a un nuovo render per frame.
- **`dsh-better-sidebar` non è elencato come peer dependency**: consumo opportunistico via `ctx.get()`, senza dichiarazione `inject`, quindi anche senza peer da dichiarare. Con il sidebar installato, tab; senza, ritorno alla finestra fluttuante — entrambi i deployment restano puliti.

### Scelte di progetto (dette con franchezza)
- **Ibrido piuttosto che riscrittura totale**: React tiene la struttura dell'UI (testata / schede / fasce di avviso / strato cronologia), il controller vanilla tiene la pipeline dei frame in tempo reale (SSE / fusione rAF / mappatura inversa delle coordinate / inoltro degli input). Circa 1000 righe di logica di streaming fragile non sono state riscritte in hook React, per limitare il rischio di regressioni.
- **Cronologia come strato sovrapposto**: il cassetto laterale della finestra fluttuante dava due colonne molto strette alla larghezza ridotta della sidebar (~300-400 px); lo strato sovrapposto sfrutta meglio lo spazio.
- **Race condition (nota, accettata)**: se `dsh-better-sidebar` si carica dopo ego-browser, `ctx.betterSidebar` può valere ancora `undefined` quando gira `apply()`, e si ricade sulla finestra fluttuante. Il loader di moduli di DSH di solito carica in ordine di dipendenza, e il sidebar, plugin UI di base, si carica per primo; altrimenti basta rinfrescare la pagina.
- **Il codice della finestra fluttuante resta com'è**: `mountFloatingWatch()` è lo spostamento meccanico del corpo dell'effect originario, senza cambi di logica, garantendo un'esperienza identica a 0.7.x in assenza di sidebar.

## [v0.7.1] - 2026-08

Versione di correzione: un singolo `ego_space_open` non apre più due finestre del browser.

### Correzioni
- **`ego_space_open` non apre più due finestre del browser**: prima, all'avvio, `"about:blank"` veniva passato come argomento posizionale, aprendo una scheda residua nel browser context predefinito; e `ego_space_open` passa per `useSpace+ensureRealTab`, che apre un'altra scheda nel proprio browser context — Chrome isola i contesti diversi in finestre distinte, e l'utente vedeva due finestre. Ora `LAUNCH_FLAGS` guadagna `--no-startup-window` e `launch()` non passa più un URL posizionale: l'avvio parte a zero schede; la prima scheda la crea `ego_space_open` (o qualsiasi strumento strutturato `ego_*` che passi per `useSpace+ensureRealTab`) nel proprio contesto — resta l'unica finestra che l'utente vede. Il vecchio commento asseriva che `--no-startup-window` avrebbe rotto tutte le operazioni `page.*` — era la conclusione di prima dell'introduzione del routing `useSpace+ensureRealTab`, ormai invalida per gli strumenti strutturati. **Regressione nota (accettata)**: se l'heredoc in `ego_cli` / `ego_script` chiama direttamente `page.*` senza prima passare per `taskSpaces.useOrCreate`, ora solleva `"no active tab to attach session"` — il messaggio d'errore è chiaro, e l'uso raccomandato resta indenne.

## [v0.7.0] - 2026-08

Piccola versione: effetto respiro della spia di stato della finestra di osservazione + governo della memoria del frontend + correzioni di timeout degli strumenti e di multipiattaforma.

### Aggiunte
- **Effetto respiro della spia di stato della finestra di osservazione**: il puntino verde del badge del FAB resta acceso quando l'agent sta realmente guidando il browser (`busy`), e respira al riposo (alone verde periodico di 2,4 s) quando è aperto ma fermo; il punto di stato «consultazione in diretta» del pannello segue la stessa logica busy/respiro. La vecchia semantica «busy=giallo, idle=verde» si capovolge in «verde al lavoro, respiro al riposo».

### Correzioni
- **Il parametro `timeoutMs` di `ego_script` veniva ignorato**: il timeout per esecuzione dichiarato nello schema non ha mai fatto effetto, tutte le esecuzioni usavano la grazia predefinita di 15 s del plugin. Ora `timeoutMs` attraversa `runEgoScript` e fa davvero effetto, con ritorno al predefinito in caso di assenza o invalidità.
- **Governo della memoria del frontend**: `frameCache` della finestra di osservazione (l'ultimo JPEG dataURL di ogni scheda) e `pageMeta` si accumulavano senza limiti per `targetId` — una lenta perdita nelle sessioni lunghe/tra tante schede. Ora il cache delle schede chiuse viene potato in base alla tabella delle schede vive, e `frameCache` riceve un tetto di sicurezza `MAX_CACHED_FRAMES=12` con priorità alle più vecchie.
- **Il ripiego della home codificata `/root` passa a `os.homedir()`**: nella rilevazione dei percorsi di stato, la home POSIX predefinita passa dal `/root` fisso al `os.homedir()` corretto multipiattaforma, eliminando la trappola per gli ambienti non root/contenitori.

### Ingegneria
- Nuovo `.gitattributes`: fine riga LF unificate (`* text=auto eol=lf`), eliminando gli scatti CRLF dell'albero di lavoro causati da `core.autocrlf` su Windows e i falsi giudizi di diff/cp.

## [v0.6.1] - 2026-04

Versione di correzione: catena di autoriparazione + stabilità del worker della finestra di osservazione, usabilità della barra di onboarding del pannello.

### Correzioni
- **La disinstallazione del plugin non blocca più l'uscita dell'host / non rompe più l'autoriparazione**: il teardown di `ctx.effect` passa da `await ego-browser --stop` (15 s di grazia, che trattenevano l'uscita dell'host) a fire-and-forget — l'host può essere rialzato pulito da `dsh-web-guard` entro 10 s e un turn interrotto può proseguire automaticamente.
- **Guardia a istanza singola del worker della finestra di osservazione + pulizia degli stati stanti**: lo stesso `ego-cast-worker.mjs` poteva partire insieme dalla directory di installazione e da un clone di dev, e `ensureWorker` ne avviava un altro quando il pid noto era morto — `ego-cast.json` puntava così costantemente a un worker morto/in ritardo e il pannello perdeva lo streaming. Ora, all'avvio, il worker enumera e ferma gli altri processi omonimi (via `powershell -EncodedCommand` su Windows, `ps` su POSIX), cancella il `ego-cast.json` stantio e fa del proprio `{port,pid}` l'unica autorità.
- **Fasce di onboarding per login/captcha chiudibili manualmente**: aggiunto un pulsante ×; le due fasce si mostrano in mutua esclusione (captcha prioritario), niente più «impossibile da chiudere» né «doppia fascia che schiaccia l'immagine».
- **La finestra di osservazione segue attivamente la pagina su cui l'agent sta operando**: prima il pannello prendeva «l'ultimo ridisegno» (lastActive) come pagina corrente, i ridisegni delle pagine di animazione/video in background rubavano la vista, e la vista principale non saltava quando l'agent cambiava pagina. Ora il worker ottiene via DevTools `/json/list` la scheda attiva MRU del browser (stesso giudizio di `tabs.mjs` della runtime ego), la marca `active: true` e la mette per prima in `/api/spaces` come nel SSE; l'inseguimento automatico del frontend segue solo la pagina attiva e ignora i frame dei ridisegni in background.

## [v0.6.0] - 2026-04

Govern della salute del codice (convergenza di ingegneria).

- Eliminata la bomba di sovrascrittura della build: rimosso il vecchio `src/` (561 righe di versione superata) e `tsconfig.json`, stabilendo **`lib/` come unica fonte di autorità**. `npm run build` passa da «compilazione tsc di src→lib (la versione vecchia sovrascriveva, tutti gli strumenti si perdevano)» a «verifica sintattica di `lib/` (`node --check`)».
- Unificata la registrazione degli strumenti: `ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` passano al percorso `withEgoLock` + ritento a freddo degli altri strumenti (sicurezza di concorrenza).
- Fine del fork: le nuove capacità (cattura dei download, rilevamento captcha, 30+ strumenti) fanno fede con `lib/`.

## [v0.5.0] - 2026-04

Streaming in tempo reale + operazione diretta del browser dalla finestra di monitoraggio.

- Corretto il bug chiave dello streaming in tempo reale: `screencastFrame` leggeva il campo sbagliato, i frame in diretta non sono mai passati davvero per il SSE. Corretto — le pagine dinamiche sfiorano 10~30 fps.
- L'inoltro in streaming di cast-server passa a `node:http` (il buffering delle risposte chunked da parte di fetch ritardava il primo frame).
- Il mouse della finestra di monitoraggio opera direttamente il browser dell'agent: scorrimento con rotella, clic/trascinamento sul browser reale (`/api/ego/input` → CDP `Input.dispatchMouseEvent`), Ctrl+rotella per lo zoom, Ctrl+trascinamento per lo spostamento, doppio clic per il reset, coordinate in mappatura inversa sul viewport reale con correzione del letterbox.
- Nuovo `/api/ego/stream` (SSE): frame in tempo reale + elenco delle pagine.
- Fascia di invito al login + «Connesso, salva» (innesca `/api/ego/flush` per scrivere su disco); corretto il percorso della directory di stato di `ego_auth_flush` su Windows.

## [v0.4.0] - 2026-04

Multipiattaforma (adattamento Windows concretizzato).

- Supporto nativo Windows: `IS_WIN` + `windowsChromeCandidates()` rilevano automaticamente le directory di installazione di Chrome/Edge/Brave e `PATH`/`%PATHEXT%`.
- Il servizio iniettato passa alla scelta binaria `webServer`/`httpServer`, la finestra di osservazione si monta anche su Windows.
- Percorsi di stato multipiattaforma: Windows `%LOCALAPPDATA%\ego-lite-linux`, POSIX `$XDG_STATE_HOME/ego-lite-linux`.

## [v0.3.0] - 2026-04

Correzioni e miglioramenti.

- Ritento automatico all'avvio a freddo: ogni azione `ego_*` avvia un nuovo sottoprocesso `ego-browser`, e la fase di preriscaldo della sessione produceva talvolta `CDP channel is not open` / timeout DevTools. Integrati fino a 3 ritenti con backoff progressivo, solo per gli errori transitori di avvio a freddo; gli errori veri passano subito.

## [v0.2.0] - 2026-04

Punto forte: il frontend di osservazione in tempo reale.

- `lib/client.js`: UI in vetro satinato scuro, bolite 🌐 permanente in basso a destra, un clic mostra l'immagine in diretta dell'agent.
- Gestione delle schede: barra delle schede orizzontale + `×` per scheda per chiudere (chiude davvero la scheda del browser).
- Zoom/trascinamento/reset, polling dinamico (attivo 2 s / fermo 8 s), navigazione che riusa la scheda.
- `bin/ego-cast-worker.mjs`: si aggancia al browser usato dall'agent, spinge i frame via CDP in tempo reale, si riavvia automaticamente dopo un crash.
- Pronto all'uso: `bin/ego-chrome-wrapper.sh` incluso nel pacchetto, `--no-sandbox` automatico sotto root/headless.
