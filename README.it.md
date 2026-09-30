# dsh-browser-cdp — Il browser dell'agent visibile (accesso CDP)

[简体中文](README.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Italiano](README.it.md) | [Русский](README.ru.md) | [Español](README.es.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue" alt="DSH >= 0.2.0-rc.1">
  <img src="https://img.shields.io/badge/DSH--better--sidebar-%3E%3D0.12.2(optional)-red" alt="dsh-better-sidebar >= 0.12.2 (optional)">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?logo=node.js&logoColor=white" alt="Node >= 22">
</p>

> **Repository**: `github.com/drscrewdriver/dsh-browser-cdp` (in precedenza `dsh-ego-browser`, derivato dal progetto upstream [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)) ｜ Cronologia delle versioni: vedi [CHANGELOG.md](CHANGELOG.md)

### Matrice di compatibilità delle versioni

| Dipendenza | Versione minima | Versione consigliata | Note |
|---|---|---|---|
| **DSH** (DeepSeek Harness) | `0.2.0-rc.1` | `≥ 0.2.0-rc.1 <0.2.1-0` | Linea 0.2.0: peer dependencies bloccate in modo sincrono su `>=0.2.0-rc.1 <0.2.1-0`; l'host garantisce la retrocompatibilità dell'API dei plugin (il composer/`forkSession` di 0.2.0 è un'estensione di firma, il plugin è solo chiamante, nessuna modifica necessaria). La superficie di impostazioni dichiarativa introdotta con 0.1.7 (campi Config `.volatile()` che generano automaticamente il modulo delle impostazioni) prosegue in 0.2.0. Per DSH `0.1.2-rc.1` ~ `0.1.7` usare la linea **0.17.x**, per 0.1.0-rc.x / 0.1.1-rc.x usare v0.8.0 o versioni precedenti |
| **dsh-better-sidebar** | `0.12.2` (opzionale) | `≥ 0.17.1` | Senza di esso ripiego automatico sulla sfera di osservazione fluttuante; `< 0.12.2` funziona ma l'intercettazione dei link esterni (`urlTarget`) si degrada silenziosamente |
| **Node.js** | `22` | — | Fornito con l'ambiente del harness |

**Note di adattamento a tutte le versioni di DSH**: questa versione (**da v0.18.0, linea 0.2.0**) è rivolta a DSH `0.2.0-rc.1+`: rispetto alla linea 0.1.7 (v0.17.x) **zero modifiche al codice**, puro ricambio di dipendenze/metadata — l'host 0.2.0 è retrocompatibile con l'API dei plugin, e questo plugin consegna le selezioni tramite la facciata `ctx.get('conversation').input` (senza chiamare `submit()`, senza override), restando quindi fuori dal perimetro d'impatto delle modifiche di 0.2.0. La superficie di impostazioni dichiarativa, introdotta con 0.1.7, funziona così: il plugin non registra più alcuna sezione di impostazioni (l'API di registrazione `ctx.settings` è stata rimossa dall'host); invece, i campi configurabili vengono marcati con `.volatile()` sullo schema Config e la pagina impostazioni dell'host genera automaticamente il modulo; le modifiche ai campi volatile hanno effetto a caldo tramite l'evento `loader/volatile-update`, senza ricaricare il plugin. Le API host fondamentali (`defineTool`, `ctx.tools.register`, `ctx.subprocess.spawn`, `ctx.webServer.register`, `ctx.inject`, la factory CJS `ModuleLoader`, `cordis.patch.yml`) mantengono la loro forma dal 0.1.2. Per DSH `0.1.2-rc.1` ~ `0.1.7` usare la linea **0.17.x**.

**Note di adattamento a dsh-better-sidebar**: questo plugin registra una tab della barra laterale e ascolta i link esterni tramite il servizio `ctx.betterSidebar` (ottenuto in modo difensivo con try-catch). Versioni di introduzione delle API chiave:

| API | Uso in questo plugin | Versione di introduzione in better-sidebar |
|---|---|---|
| `registerTab()` / `openTab()` / `ctx.betterSidebar` | Registrazione + apertura tab | v0.9.0+ |
| `TabDescriptor.single` | Tab a istanza singola | v0.9.0+ |
| `TabDescriptor.urlTarget` | Intercettazione link esterni | **v0.12.2+** (sotto questa versione l'intercettazione dei link fallisce silenziosamente) |

---

**Dettagli sul supporto delle versioni di DSH**: cambiamenti principali da v0.8.2 a v0.8.3: integrazione di 6 PR della community (adattamento root/xvfb/macOS headless, compatibilità rc.1, stabilità Windows), correzione della vulnerabilità delle route `/api/bcdp/*` senza autenticazione, dell'errore di avvio del client host senza dsh-better-sidebar (#29), della regressione dell'avvio a freddo su Windows (errata rilevazione Xvfb introdotta da #22), oltre all'aggiunta di `runtimeArgs`/`chromeArgs` alla whitelist delle impostazioni del gateway. Punti di adattamento: rinomina della runtime client (`@deepseek-ai/dsh-client-store`), id di registrazione del modulo client e nome della riga di caricamento allineati al nome del package dichiarato, `dsh.client.inject` che dichiara solo le righe reali del grafo dei moduli, `webServer` consegnato tramite iniezione annidata (servizio opzionale), e sincronizzazione con la modalità tab della barra laterale (dsh-better-sidebar).

**Supporto barra laterale ([dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar))**: quando l'host ha installato `dsh-better-sidebar` (consigliato ≥ v0.12.2), la finestra di osservazione in tempo reale si registra come **tab nativo della barra laterale** — «Browser dell'agent» compare nel menu «+» della sidebar, si apre con un clic e resta ancorato al cassetto della barra laterale; la tab si apre automaticamente alla prima chiamata di uno strumento `bcdp_*` da parte dell'agent (da v0.8.5 l'apertura è ristretta alla sessione chiamante — in multi-sessione non compare più nella sessione sbagliata). Senza `dsh-better-sidebar` si ripiega automaticamente sulla modalità **sfera di osservazione fluttuante** in basso a destra (`#dsh-ego-fab`). Le due forme condividono le stesse capacità: streaming SSE in tempo reale / clic / immissione / cattura dei download. La finestra di osservazione offre anche un pulsante «Pop-out»: il browser dell'agent in esecuzione headless può essere sostituito con un clic da una finestra con interfaccia dello stesso Profile (le tab vengono conservate), utile per subentrare manualmente.

**Import dello stato di accesso (novità v0.8.5)**: lo strumento `bcdp_login_import` copia **per dominio** i cookie di accesso dal vostro Chrome/Edge/Brave quotidiano al browser dell'agent (avvio headless del binario reale + lettura in transparenza via CDP, compatibile con l'App-Bound Encryption di Chrome 127+, senza decifratura offline; se il browser di origine è in esecuzione si può chiuderlo con grazia prima dell'import, la finestra si ripristina al prossimo avvio). I valori dei cookie non compaiono in alcun log né output; prima dell'import il database dei cookie di origine viene salvato automaticamente e ripristinato in caso di svuotamento anomalo. Insieme al Profile persistente su disco predefinito, lo stato di accesso importato sopravvive ai riavvii in modo permanente.

Un **proxy browser CDP**: integra [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite) (un Chromium per agenti IA) come runtime incorporata nel DeepSeek Harness, pilota il browser con **38 strumenti strutturati `bcdp_*`** e lo accompagna con un **frontend di osservazione in tempo reale** — mentre l'agent opera sulle pagine in background, voi vedete ogni pagina che visita come una diretta e potete persino intervenire direttamente.

**Una particolarità tutta nostra (self-observation)**: l'agent usa proprio questo Chromium — anche quando opera su **DSH stesso** (gestione sessioni, task board, impostazioni), la finestra di osservazione lo mostra in diretta e potete subentrare in qualsiasi momento. Non si tratta solo di «vedere l'agent lavorare sul web»: perfino la manipolazione dell'interfaccia di DSH da parte dell'agent è interamente visibile e controllabile.

**Pronto all'uso**: il pacchetto del plugin incorpora la runtime ego (`runtime/`, MIT, vedi [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — niente cloni del repository ufficiale, niente build manuali; il wrapper `--no-sandbox` è incluso nel pacchetto: root / Docker / macchine senza schermo partono in un lampo.

---

## I nostri veri punti di forza (non slogan, ma capacità verificabili sul codice e rispetto ai concorrenti)

Altri plugin che collegano ego-lite a DSH ne traggono solo **3 strumenti** — uno script `run`, una guida `help`, un check `status` — e il browser resta una **scatola nera in background**. Questo plugin prende la strada opposta: **aprire la scatola nera e, fin da subito, portare a pieno regime le capacità di «vedere» e «controllare»**.

| Capacità | Questo plugin (questo repository) | Plugin analogo (Da1dr1em/dsh-ego-browser) |
|---|---|---|
| Numero di strumenti strutturati | **38**, responsabilità unica, invocazione deterministica | **3** (`run`/`help`/`status`) |
| Finestra di osservazione in tempo reale (doppio backend CDP JPEG / FFmpeg H.264 + barra tab + cassetto cronologia) | ✅ Sì | ❌ No |
| Operazione **diretta** col mouse sul browser reale dalla finestra di osservazione (clic/trascinamento/scroll inviati al CDP) | ✅ Sì | ❌ No |
| **Selezione di un elemento nella finestra di osservazione → cattura e riferimento nel campo di immissione della conversazione** (blocco strutturato `[CDP-PICKS]`, indicazione manuale del bersaglio) | ✅ Sì | ❌ No |
| Guardia a istanza singola del worker + auto-riparazione da crash/duplicati | ✅ Sì | ❌ No |
| Cattura download `bcdp_download` / rilevamento captcha `bcdp_captcha`/`bcdp_page_info` | ✅ Sì | ❌ No |
| Adattamento alle piattaforme (rilevamento automatico Linux/macOS/Windows + ripieghi root/headless/`--no-sandbox`) | ✅ Tutte le piattaforme | Solo host di anteprima Windows, configurazione manuale |
| Persistenza su disco dello stato di accesso `bcdp_auth_flush` | ✅ Sì | ⚠️ Solo menzione a livello di documentazione |

**Tre differenze chiave:**
- **Vedere**: da altri parti è una scatola nera che «a fine lavoro racconta il risultato»; noi trasmettiamo in diretta — **guardate l'agent operare** e notate subito se resta bloccato su un captcha o prende la strada sbagliata.
- **Controllare**: da altre parti solo lettura; la nostra finestra di osservazione **pilota direttamente** lo stesso browser dell'agent — al bisogno subentrate voi stessi (zoom/trascinamento/clic), senza interrompere l'agent e ripartire da capo.
- **Indicare con precisione**: **selezionate** un elemento della pagina nella finestra di osservazione; il plugin ne cattura `backendNodeId`/`tag`/`id` e descrizione semantica e lo inserisce come blocco strutturato `[CDP-PICKS]` nella bozza del campo di immissione della conversazione (le selezioni multiple sulla stessa pagina vengono fuse e numerate automaticamente) — l'agent riceve un bersaglio esatto, senza dover indovinare «quale bottone intendete».

> Il confronto sopra si basa su fatti pubblici verificabili: il codice di questo repository (`bin/cdp-cast-worker.mjs` streaming in tempo reale + ritorno degli input CDP, `lib/index.js` con 38 strumenti registrati, `lib/cast-server.js` ponte verso l'host, `deliverPickToConversation` in `lib/client.js` per il riferimento delle selezioni) e il codice sorgente/README del plugin analogo (il cui `src/tools.ts` registra soltanto `ego_browser_run` / `ego_browser_help` / `ego_browser_status`). Questo documento non svaluta nessuno — affermiamo solo quali capacità abbiamo implementato e verificato in più.

**Rispetto a [ego-lite](https://github.com/CitroLabs/ego-lite) in sé, ecco cosa aggiungiamo (tutto verificabile sul codice di questo repository):**

| Capacità | Descrizione (codice corrispondente) |
|---|---|
| **Frontend di osservazione** | ego-lite da solo è un CLI headless (solo script heredoc + output testuale); vi abbiamo aggiunto **streaming SSE in tempo reale + barra tab + cassetto cronologia + operazione diretta col mouse dalla finestra di osservazione + selezione elementi con riferimento nel campo di immissione** (`bin/cdp-cast-worker.mjs`, `lib/cast-server.js`, `createPickControl`/`deliverPickToConversation` in `lib/client.js`), facendo di «vedere», «controllare» e «indicare» capacità di primo ordine |
| **Pronto all'uso + autosufficiente su tutte le piattaforme** | `resolveEgoEnv` rileva automaticamente Chrome/Edge/Brave, wrapper `--no-sandbox` incorporato, zero configurazione sotto root / Docker / senza schermo (`lib/index.js`); non serve prima installare un host GUI come richiede la via ufficiale |
| **Strato di robustezza** | Tentativi automatici all'avvio a freddo (solo gli errori CDP transitori vengono ritentati, gli errori veri non vengono inghiottiti), guardia a istanza singola del worker + riavvio automatico dopo crash, teardown del plugin in fire-and-forget che non blocca l'uscita dell'host, tetto alla cache dei frame lato frontend (`withWarmupRetry` / `makeEnsureWorker` / `frameCache`) |
| **Strumenti operativi** | `bcdp_doctor` (diagnostica dell'ambiente), `bcdp_captcha` (rilevamento captcha), `bcdp_auth_flush` (persistenza dell'accesso), `bcdp_login_import` (import dello stato di accesso dal browser di sistema), `bcdp_http` (richieste nel contesto del browser) ecc. — uno strato che gli helper CLI nativi non offrono |
| **self-observation** | Anche quando l'agent opera sull'interfaccia di DSH stessa, tutto è visibile in diretta e subentrabile |

> Non pretendiamo di eguagliare gli snapshot a livello kernel né l'esperienza multi-finestra nativa dell'app macOS ufficiale; questo repository risolve: «portare le stesse capacità del browser in DSH + Linux/WSL, in modo visibile».

---

## Quale problema risolve

I browser generici non sono pensati per gli agenti, eppure gran parte delle interazioni del web (stati di accesso, captcha, rendering dinamico, moduli, siti che richiedono una sessione umana) si può affrontare solo con un browser vero — è l'eredità della famiglia ego upstream: **«lasciare che l'agent usi il vostro browser già connesso, senza disturbare»** ([sito ufficiale](https://github.com/CitroLabs/ego-lite)).

Questo plugin lo collega a DSH e risolve il punto più doloroso — **non vedete cosa fa l'agent e non potete intervenire** — con una finestra di osservazione:

> 🌐 Un clic sulla piccola sfera apre la diretta; 🟦 barra tab per cambiare/chiudere; 🕘 cassetto cronologia per rivedere; 🔍 zoom e spostamento; 🖱️ subentro diretto al browser reale dalla finestra. **In una frase: l'agent lavora nel browser, voi vedete tutto e potete subentrare in qualsiasi momento.**

### Alcuni scenari tipici di avvio

- **Ricerca / raccolta dati**: chiedete all'agent di accedere a CNKI / Google Scholar e raccogliere pagina per pagina; dalla finestra di osservazione lo vedete scorrere, cliccare «pagina successiva», scaricare i PDF — se si blocca lungo la strada, ve ne accorgete subito.
- **Moduli e accessi**: l'agent compila un modulo a metà, nella finestra di osservazione compare un captcha — subentrate, risolvete il captcha e ridate il controllo all'agent perché continui.
- **QA / smoke test**: chiedete all'agent di cliccare in giro sul vostro prodotto; la finestra di osservazione diventa un «registratore di schermo che parla», con in più il replay della cronologia.
- **Guardare l'agent operare su DSH stesso** (self-observation): quando l'agent gestisce sessioni / aggiusta impostazioni, tutto è visibile nella finestra di osservazione e potete subentrare.

---

---

## Prerequisiti

| Requisito | Note |
|---|---|
| Node ≥ 22 | Fornito con l'ambiente del harness |
| **Qualsiasi Chrome / Chromium / Brave / Edge** | Rilevamento automatico, oppure `EGO_LINUX_CHROME` per indicarlo; sotto root con il wrapper incluso |
| DSH + dshx | Meccanismo di caricamento dei plugin |
| DSH Web con interfaccia grafica (per la finestra di osservazione) | Le sessioni headless restano utilizzabili con gli strumenti `bcdp_*`, solo senza finestra di osservazione |

## Installazione

**Metodo 1: installazione diretta da GitHub (consigliata)**

```sh
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp
# Si può anche bloccare su un commit / tag specifico:
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp#v0.9.0
```

> L'installazione `github:` recupera il tarball del repository via pnpm passando per `codeload.github.com`, **senza pubblicare nulla sul registro npm**; usa direttamente il `lib/` **precompilato e versionato** del repository (`files` contiene solo `lib/`, `bin/`, `runtime/`, `cordis.patch.yml`, `dsh-plugin.json`), quindi **non innesca alcuno script di build** e non richiede devDependencies. L'ingresso host `lib/index.js`, il client `lib/client.js` e il worker `bin/cdp-cast-worker.mjs` sono tutti distribuiti con il repository.

**Metodo 2: tarball locale / URL git**

```sh
dshx install dsh-browser-cdp <dsh-browser-cdp.tgz>      # tarball o URL git, entrambi validi
dshx list                                                # dovrebbe mostrare: [on] dsh-browser-cdp
```

> **Nota sulla rinomina del pacchetto**: il nome del pacchetto di questo plugin è **`dsh-browser-cdp`** (nomi precedenti: `dsh-ego-browser`, alias `@dsh-external/ego-browser`). Da DSH Desktop 2.0.5 è stata introdotta una verifica di coerenza «nome dipendenza del profile == nome reale del package»: se il profile referenzia ancora il vecchio nome, l'avvio finisce in modalità di ripristino. Dopo l'aggiornamento, rinominate **sia** la chiave di dipendenza nel `package.json` del profile **che** la voce in `dsh.profile.bundles` in `dsh-browser-cdp`:

   ```diff
   - "dsh-ego-browser": "github:Fisfzy/ego-browser",
   + "dsh-browser-cdp": "github:drscrewdriver/dsh-browser-cdp",
   ```

   ```diff
   - "dsh-ego-browser",
   + "dsh-browser-cdp",
   ```

Nelle impostazioni della finestra di osservazione sono selezionabili `captureBackend=auto|cdp|ffmpeg` (predefinito `auto`, attualmente risolto in CDP), le fasce di qualità, CDP FPS/qualità JPEG/larghezza massima, nonché FFmpeg FPS/larghezza massima/bitrate/encoder/percorso personalizzato. Il plugin rileva prima il percorso personalizzato, il PATH di sistema e la cache gestita; il download da GitHub può sostituire `https://github.com` con `githubMirror`, ad esempio `https://gh-proxy.com/github.com`. Il bitrate FFmpeg va da 500 a 20000 kbps, con valori predefiniti 2000/4000/8000 kbps per le fasce bassa/bilanciata/alta.

Nessuna configurazione richiesta lato host: `resolveEgoEnv` rileva automaticamente root / assenza di schermo e applica i ripieghi. Le route host della finestra di osservazione (`/api/bcdp/spaces` ecc.) vengono registrate solo se esiste un server HTTP; in headless sono un no-op sicuro.

## Modalità di connessione: endpoint CDP / CLI ego locale

L'elenco delle connessioni nel pannello impostazioni è **ordinato** — **l'ordine è la priorità**, e la voce attivata pilota ogni chiamata `bcdp_*`. Esistono due tipi di voci:

| Tipo | Cosa fa | Vincoli |
|---|---|---|
| **Endpoint CDP** | Passa l'indirizzo di un browser con porta di debug già aperta alla runtime incorporata (iniezione di `EGO_LINUX_CDP_URL`), che vi si **aggancia** | Più voci consentite |
| **CLI ego locale** | Il CLI ego della macchina pilota **da sé** il proprio browser ego-lite locale — **nessun endpoint iniettato** | **Solo macchina locale, al massimo uno a livello globale** |

**Perché esiste il secondo tipo**: il `EGO_LINUX_CDP_URL` iniettato è un contratto privato del **porting Linux incorporato**; il `ego-browser` nativo incluso nell'app `ego lite` su macOS **non lo legge affatto**. Se «endpoint CDP» fosse l'unico tipo, gli utenti macOS non potrebbero usare il proprio ego-lite già connesso — dovrebbero collegarsi a una porta remota, o lasciare che il porting avvii un Chromium standard. Il tipo CLI locale colma esattamente questa lacuna.

Ordine di risoluzione (con `cliPath` lasciato vuoto): percorso esplicito → `ego-browser` nel PATH → helper nel bundle dell'app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime incorporata del plugin.

Due valori predefiniti che vale la pena conoscere:

- **`--sdk-path` è disattivato per impostazione predefinita**: di default si usa il harness fornito con il CLI (quello ufficialmente abbinato); solo attivandolo viene iniettato il pacchetto harness di questo plugin. Se il CLI non riconosce il flag, il plugin registra un avviso e **riprova automaticamente una volta senza** — l'intera catena non viene così compromessa.
- **Il probe di prontezza esegue un vero heredoc** (lo stesso canale usato per il lavoro vero), quindi **non è gratuito**: il probe può innescare l'avvio a freddo del browser di backend (misurati circa 1,3 s con il porting incorporato).

Relazioni con gli altri interruttori:

- `cdpMode`: `auto` segue la voce attivata (entrambi i tipi vanno bene); `remote` **accetta solo endpoint CDP** e segnala esplicitamente `mode-kind-mismatch` se la voce attivata è un CLI locale; `local` usa il launcher locale gestito.
- `remoteEnabled` (interruttore generale remoto) **riguarda solo il CDP remoto**, senza effetto sulle connessioni CLI locali.
- `allowLocalFallback` / `localHeadless` / `localUserDataDir` agiscono solo sul ripiego degli endpoint CDP e sugli avvii gestiti.

`bcdp_doctor` riporta il conteggio dei tipi della sequenza corrente, il percorso effettivamente risolto del CLI e la sua forma, oltre a (se il plugin upstream `dsh-ego-browser` è installato sulla stessa macchina) un avviso di coesistenza.

## Elenco degli strumenti (38, prefisso `bcdp_`, indice completo via `bcdp_help`)

| Categoria | Strumenti |
|---|---|
| Spazi di lavoro | `bcdp_space_open` `bcdp_space_close` `bcdp_status` |
| Lettura pagina | `bcdp_snapshot` (albero semantico) `bcdp_page_info` `bcdp_read_element` |
| Navigazione/attesa | `bcdp_navigate` (riusa la tab) `bcdp_wait` `bcdp_wait_for_selector` `bcdp_wait_for_url` `bcdp_wait_for_response` |
| Interazione | `bcdp_click` `bcdp_fill` `bcdp_hover` `bcdp_drag` `bcdp_select` `bcdp_check` `bcdp_key` `bcdp_scroll` |
| Esecuzione/debug | `bcdp_js` (valutazione nella pagina) `bcdp_cdp` (CDP grezzo) `bcdp_cli` (heredoc arbitrario) `bcdp_script` (script multistep) |
| Output | `bcdp_screenshot` `bcdp_download` `bcdp_upload` |
| Sessione/sicurezza | `bcdp_auth_flush` (persistenza dell'accesso) `bcdp_login_import` (import dell'accesso tra browser) `bcdp_captcha` `bcdp_dialog` |
| Meta-strumenti | `bcdp_help` `bcdp_doctor` `bcdp_http` |
| Revisione (JEV/Laya, servizio di giudizio esterno opzionale) | `bcdp_jev_status` `bcdp_jev_frame` `bcdp_jev_ask` `bcdp_jev_run` `bcdp_jev_attempt` |

## Come usare la finestra di osservazione

La **🌐 sfera permanente** in basso a destra → clic per aprire:

- **Vista principale**: diretta della pagina corrente dell'agent; clic/trascinamento/rotella agiscono direttamente sulla pagina, Ctrl+rotella per lo zoom, Ctrl+trascinamento per lo spostamento, doppio clic per il reset. Dopo un clic sulla vista è possibile immettere testo da tastiera: IME cinese, incolla, Tab/Invio/frecce e scorciatoie Ctrl/Cmd supportate.
- **Selezione elemento** (riferimento per selezione): clic sul pulsante nella barra strumenti per entrare in modalità selezione, poi clic su un qualsiasi elemento della vista in diretta — il plugin ne cattura `backendNodeId`/`tag`/`id` e descrizione semantica e li inserisce come blocco strutturato `[CDP-PICKS]` nella bozza del campo di immissione della conversazione; le selezioni multiple sulla stessa pagina vengono fuse automaticamente nello stesso blocco e numerate in sequenza, l'agent le usa con precisione per numero. Funziona sia con la sfera fluttuante sia con la tab della barra laterale.
- **Barra delle tab**: riga orizzontale in alto, clic per cambiare, `×` per chiudere.
- **Cassetto cronologia** (🕘): rivedere la traccia delle visite in ordine cronologico.
- Durante le azioni, la riga URL in basso mostra i messaggi sul posto e si ripristina dopo 2 secondi.
- Alla chiusura del pannello, al nascondimento della tab sidebar o allo smontaggio del componente, la produzione di immagini si ferma al termine della tolleranza di 1,5 secondi. Il solo passaggio della finestra DSH in background non interrompe lo streaming, per evitare di ricostruire WGC/FFmpeg ripetutamente al ritorno in primo piano; una chiusura anomala è coperta dal timeout del lease worker di 120 secondi.

### Backend video

- `cdp`: JPEG via `Page.startScreencast`, 20 FPS predefiniti. Ogni frame sorgente viene accusato immediatamente (ACK) con l'ID fornito da Chrome; si conserva solo l'ultimo frame in attesa; viene catturata solo la tab attualmente osservata, le pagine statiche tornano a una cattura ogni 3 secondi per impostazione predefinita.
- `ffmpeg`: su Windows `gfxcapture(hwnd)` cattura direttamente la superficie D3D11 della finestra Chrome bersaglio; le altre piattaforme usano un crop della sorgente di visualizzazione. Poi codifica H.264 fragmented MP4 → chunk binari HTTP → MediaSource `<video>`, senza passare per Base64/SSE.
- `auto`: il valore predefinito è CDP; se la rilevazione fallisce FFmpeg non viene scaricato automaticamente. FFmpeg è selezionabile solo dopo l'installazione e il superamento del controllo delle capacità; se un backend FFmpeg salvato diventa invalido, la sessione di osservazione ripiega su CDP mostrando il motivo.
- Su Windows FFmpeg deve includere `gfxcapture`. Il plugin abbina l'HWND tramite PID del browser, titolo del target e confini della finestra CDP; la cattura della pagina bersaglio prosegue anche se la finestra viene spostata o coperta, e il ripiego sulla registrazione del desktop è vietato. Se il target è una tab in background della stessa finestra Chrome, viene restituito un errore esplicito invece di mostrare la tab visibile o rubare il focus. Su macOS serve l'autorizzazione «Registrazione schermo» al primo uso; su X11 Chromium e FFmpeg devono condividere lo stesso `DISPLAY`; su Wayland, in mancanza di input Portal/PipeWire, un messaggio invita a tornare al CDP.

L'installazione gestita di FFmpeg va in `~/.dsh/cache/ego-browser/ffmpeg/`, senza scrivere nulla nella directory del plugin. Windows/Linux usano un tag di release BtbN fisso; macOS usa asset fissi della release GitHub `ffmpeg-static` (i suoi binari Intel/Apple Silicon provengono rispettivamente da Evermeet/OSXExperts). Tutti i download fissano lo SHA-256 della risorsa; viene estratto solo l'eseguibile principale di FFmpeg, senza installare `ffprobe` né `ffplay`. Su Windows/Linux l'estrazione usa il `tar` di sistema; in sua assenza, un errore esplicito compare prima del download.

> Nota sullo stato di accesso: i cookie degli spazi di lavoro sono isolati tra loro — accedete nello spazio corrispondente. Dopo il riavvio di DSH lo stato di accesso di runtime viene azzerato (i cookie di runtime di Chrome vengono scritti su disco solo alla chiusura con grazia), serve un nuovo accesso — la scansione del QR code è rapida.

## Come funziona

- **Strato strumenti**: ogni strumento assembla i propri parametri in uno script JS, iniettato via stdin a `ego-browser nodejs` tramite `ctx.subprocess`, con l'host che pilota il Chromium condiviso via CDP. I risultati vengono analizzati grazie alla riga sentinella `@@DSH_RESULT@@`. Tutti i `bcdp_*` sono serializzati da un mutex intra-processo, gli errori uniformati.
- **Finestra di osservazione**: `lib/client.js` gestisce il lease del watcher, il `<img>` JPEG e il `<video>` MSE; `lib/cast-server.js` fa da relay per il SSE dei metadata, l'API watch e il video binario con backpressure; nel worker `CaptureManager` garantisce un solo backend attivo e un solo target corrente. Il piano di controllo CDP (tab, viewport, input, captcha) è indipendente dal backend video.

## Pipeline in stile JEV: far governare al LLM il ciclo del browser (fase 10)

Il **contratto di frame** «un frame ≡ screenshot + DOM numerato + intenzione + avanzamento delle azioni», insieme alla **giunzione di giudizio** «il giudice risponde solo con numeri, mai con selettori», si concretizza in una pipeline eseguibile, testabile e archiviabile. Il giudizio è affidato a un servizio esterno **Laya / JEV** (vedi sotto), il ciclo è pilotato da questo plugin.

**Quattro strumenti** (`defineTool` lato host; le richieste di giudizio partono in HTTP dal processo del plugin, non attraverso la sessione dell'agent):

| Strumento | Cosa fa | Quando usarlo |
|---|---|---|
| `bcdp_jev_status` | **Eseguirlo per primo**: disponibilità della catena di giudizio + diagnostica della configurazione, **non invia alcuna richiesta** | Primo passo quando si sospetta un problema di config/catena |
| `bcdp_jev_frame` | Cattura un frame (screenshot + candidati numerati + intenzione), per vedere cosa vedrà il giudice | Fare debug del contenuto dei frame, verificare la numerazione dei candidati |
| `bcdp_jev_ask` | Assembla il corpo della richiesta; `dryRun` è true per impostazione predefinita, `round=control\|chapter\|pick\|evaluate` permette un esame a gradi prima di inviare | Vedere chiaramente la richiesta di giudizio prima di inviarla |
| `bcdp_jev_run` | Esegue l'intero ciclo e restituisce la traccia passo a passo (candidati / top / budget / esito di ogni passo) | Quando si vuole davvero farlo agire |

**La catena predefinita è `laya → rule`**. JEV al momento non è registrabile, quindi non viene scritto per default; quando lo sarà, basterà reinserire `jev` nell'ordine `judgePrefer` e compilare `jevUrl`. In mancanza di chiave, `bcdp_jev_status` stampa di suo iniziativa come avviare il servizio in locale (`ENGINE=laya … uvicorn laya_api.main:app`, porta **8000** e non 7789, `ALLOW_DEV_LOGIN=true` per creare una chiave). I giudici non disponibili vengono **saltati senza essere chiamati** (laya impone l'autenticazione senza ramo anonimo, mancare la chiave significa 401 inevitabile); ogni salto e ogni fallimento entrano nella traccia, mai ripieghi silenziosi; `refuse` è un risultato, non un'eccezione.

**Riduzione in tre livelli (il LLM guida il processo invece di indovinare tutto in una volta)**:
1. `control` — agire o no (5 opzioni fisse: `pick_button` / `sleep` / `next` / `prev` / `done`);
2. `chapter` — quale capitolo (clustering per contenitori AX, risalendo la catena genitoriale dei `childIds` verso l'antenato strutturato più vicino, come `form#1` / `form#2`; con un solo capitolo questo turno viene saltato);
3. `pick` — quale numero scegliere nel capitolo + un `score` di rischio.

La ripartizione in capitoli non è decorativa: le soglie sono suddivise in bucket secondo il numero di candidati, e **scomporre un 20-a-1 in «pochi-a-1 × pochi-a-1» fa ricadere entrambi i turni in bucket più severi** (`top≥0.5` e `top−second≥0.15`), più controllabili di un 20-a-1 unico (`top≥0.6`). Il giudice **risponde solo con numeri**; coordinate/selettori vengono rimisurati ogni volta dallo strato di esecuzione (`DOM.getBoxModel` + ricontrollo del punto con `DOM.getNodeForLocation` prima del clic); i rettangoli del frame non servono mai come base del clic.

**Il contesto di giudizio è isolato**: sono ammessi solo i quattro segmenti `INTENT` / `PROGRESS` / `FRAME` / `HISTORY`, **mai il prefisso di sessione della sessione dell'agent**; qualsiasi segmento extra provoca un errore immediato all'assemblaggio (per asserzione, non per convenzione). `PROGRESS` (numero di passi / tentativi ed esiti per capitolo / azioni realmente riuscite / budget residuo) è **generato meccanicamente** dal ciclo stesso, non scritto dal modello — l'avanzamento scritto da un modello è la seconda via di allucinazione più difficile da scovare.

**Interruttore di valutazione `jevEvaluate` (attivo per impostazione predefinita, disattivabile dal pannello impostazioni)**: dopo ogni passo eseguito, il giudice rivaluta l'avanzamento: `inprogress` / `done` / `fail`. Con `fail` o un «done non verificato» non si indovina il passo successivo: si **passa a `escalate`** — con una lista ordinata di `RecoveryOption` (per prima cosa `reload` per aggiornare, perché un rendering stantio può nascondere una conferma già scritta), lasciando al LLM la decisione tra recuperare o fermarsi.

**Stati terminali del ciclo**: `done` (autoverifica contro `successCriteria`) / `blocked` (bloccato dal budget) / `exhausted` (budget esaurito, con `exhaustedKind`) / `stuck` (stesso ancoraggio, stessa azione, 3 volte di fila senza cambiamenti) / `unavailable` (nessun giudice) / `error` / `escalate`.

> Resoconto onesto dello stato: questa fase ha dimostrato che **protocollo, soglie, terminazione, capitoli, assemblaggio e isolamento** sono corretti (coperti dagli unit test `bcdp_jev_*`), ma **il percorso end-to-end su un browser reale non è ancora stato eseguito** (T10.22 da fare); l'**accuratezza** del giudizio non è stata misurata sul campo (i bucket di soglia servono alla calibrazione, non dimostrano che le scelte siano giuste). Gli elementi operati archiviati conservano le caratteristiche di localizzazione come `class` (si spogliano solo i token del guscio dell'ispettore), per restituirli al LLM in caso di escalate per il recupero.

## Sviluppo

Il codice sorgente è in `src/` (TypeScript), gli artefatti di build in `lib/` (bundle host + client) e `bin/cdp-cast-worker.mjs` (bundle worker).

```sh
pnpm typecheck   # barriera dei tipi tsc (tsconfig.json principale + tsconfig.client.json client)
pnpm test        # test unitari vitest
pnpm run build   # tre bundle tsdown: lib/index.js + lib/client.js + bin/cdp-cast-worker.mjs
```

> Modificate direttamente `src/` (`src/index.ts` strato strumenti, `src/client/index.ts` frontend, `src/worker/cdp-cast-worker.ts` worker). Aggiungete i nuovi strumenti in `registerActionTools` con `t({...})`, completate l'indice `bcdp_help` (`src/help.ts`), poi eseguite `pnpm typecheck && pnpm test && pnpm run build`. `lib/` e `bin/cdp-cast-worker.mjs` sono artefatti di build (precompilati e versionati), non modificarli a mano.

`node_modules/` contiene solo link simbolici a un checkout di DSH (risoluzione dei tipi in compilazione); a runtime è il harness a risolvere `@deepseek-ai/dsh-tools`.

## Limiti noti (dichiarati con onestà)

- **Windows**: adattato a livello plugin da v0.4.0; la runtime ego-lite sottostante resta un porting della community senza supporto Windows ufficiale — la stabilità di flussi complessi multistep può essere inferiore a macOS.
- **Cattura FFmpeg per piattaforma**: Windows usa ormai `gfxcapture(HWND)`, che richiede una build recente con questo filtro; un FFmpeg vecchio nel PATH viene saltato con l'invito a scaricare una versione compatibile. Linux usa `x11grab`, macOS `avfoundation` come crop dello schermo; ScreenCaptureKit su macOS e un helper Portal per Wayland sono evoluzioni future.
- **Ambiente di installazione**: i pacchetti peer DSH di questo repository non sono tutti sul registro npm pubblico. Un `pnpm install` ordinario può fallire nel risolvere i peer `@deepseek-ai/*`; l'installazione via profile DSH deve fornire questi peer. CDP non dipende da FFmpeg e non scarica binari durante l'installazione del plugin.
- **Qualità degli snapshot**: su Linux l'albero semantico viene ricostruito via CDP `DOMSnapshot`, non a livello kernel come macOS — scenari complessi con iframe/canvas possono degradare.
- **Affidabilità dell'host (Linux)**: PR della community non integrati — lo stato di tab/spazi può perdersi tra chiamate CLI incrociate; il plugin è dotato di difese, i flussi semplici sono stabili, quelli complessi possono richiedere tentativi ripetuti.
- **Persistenza dello stato di accesso**: i cookie di runtime di Chrome vengono scritti su disco solo alla chiusura con grazia; dopo un kill brusco e il riavvio serve un nuovo accesso.
- Lo schema di output è permissivo (`additionalProperties: true`); il client si affida ai valori effettivamente restituiti.

## Licenza e attribuzioni

Il plugin in sé è sotto MIT. La runtime incorporata include codice MIT di ego-lite; le build FFmpeg scaricabili opzionalmente comportano obblighi GPL-3.0-or-later. Prima dell'uso o della ridistribuzione leggete le licenze delle fonti di build e le informazioni sull'accesso al codice sorgente — vedi [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Supply chain e permessi

Fatti deterministici forniti per l'inclusione nelle directory e la revisione:

- **File di esecuzione**: `lib/` (artefatti di build, generati in modo deterministico dal TypeScript di `src/` con `npm run build` tramite tsdown), `bin/` (script eseguibili d'ingresso per worker e ffmpeg-probe), `cordis.patch.yml` (strato di assemblaggio), `dsh-plugin.json` (manifest). I `*.map` sono solo sourcemap di debug, privi di ruolo a runtime, dichiarati esclusi.
- **Artefatti nativi/eseguibili**: `runtime/` incorpora la runtime ego-lite (MIT; provenienza e inventario file per file in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — è la funzione centrale del plugin (host Chrome/CDP gestito e autosufficiente), un artefatto eseguibile trasportato volontariamente, non un sottoprodotto della build. `runtime/PATCHES.md` documenta tutte le patch locali applicate all'upstream.
- **Dipendenze**: l'unica dipendenza runtime è `@deepseek-ai/schemastery` (un'implementazione equivalente è fornita dall'host DSH); le peer dependencies sono tutte servizi host `@deepseek-ai/dsh-*`. I moduli esterni del bundle client sono risolti dalla tabella dei moduli dell'host, senza dipendenze npm trasportate.
- **Servizi esterni**: nessuna telemetria, nessuna chiamata API esterna. L'unico comportamento di rete è **opzionale**: l'installatore FFmpeg scarica una build da GitHub (o dal mirror configurato dall'utente) su istruzione dell'utente; verifica delle fonti e obblighi di licenza: vedi [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Confini di fallimento**: senza webServer lato host (TUI/headless) le route watch vengono saltate in sicurezza; se il worker non si avvia, le route watch restituiscono un JSON con `ok:false` invece di sospendere; i processi del browser terminano insieme al teardown dell'host (`--stop` in fire-and-forget, senza bloccare l'uscita dell'host).
- **Permessi**: il campo `permissions` del manifest è vuoto — le letture/scritture di file della collezione di strumenti sono limitate alle directory degli spazi gestiti da ego e all'area di lavoro dell'utente; l'accesso alla rete passa per il browser dell'agent gestito, non per il processo host.

---

## Link amici

Anche loro prodotti dell'ecosistema di plugin DeepSeek Harness, ci raccomandiamo a vicenda:
