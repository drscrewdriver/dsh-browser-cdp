## [0.18.0] - 2026-09-29 — DSH-0.2.0-rc.1-Linie (compat/0.2.0: reine Metadaten-Anpassung, null Codeänderungen)

### Neu
- **`captureWithinBudget`-Implementierung im Render-Worker** (Behebung der echten Maschinen-Blockade der 0.2.0-Linie): Das `capture` von `bin/cdp-render-worker.mjs` rief bisher eine nie definierte Funktion auf (die Capture-Kette auf echter Hardware scheiterte immer, getarnt durch den Gating-Probe). Jetzt implementiert: JPEG-Qualitätsleiter (Start 72, Schrittweite 12, Untergrenze 24, Budgetüberschreitung ehrlich als `overBudget` gemeldet) + geometrische Herunterkalkung über `scale.maxWidth` + Einzelschuss-Pfade für PNG/ohne Budget; `data` wird zur Verwendung durch die JEV-Bewertungskette als base64 zurückgegeben. Echter Test: Chrome/153 real verbunden, Budget im ersten Anlauf erfüllt (attempt 1, q=72).
- **Halb-`noImplicitAny` für den Client aktiviert**: `tsconfig.client.json` hebt auf `noImplicitAny: true`, alle 401 implicit-any werden explizit (`scripts/fix-implicit-any.mjs` positionsgetreuer Codemod + manuelle Endbearbeitung); Typannotationen haben null Laufzeitwirkung, `client-input.test.ts` quellsynchron per Regex nachgezogen.
- **Gating-Proben auf echter Hardware aktiviert**: Remote-CDP-Probe (4/4) und Render-Probe (1/1) erfolgreich gegen echtes lokales Chrome/153 gelaufen — Schleife discovery→attach→inspect→input→binding + Screenshot-Budgetkette. cli-probe und login-import e2e bleiben an die vendored Linux-Runtime gebunden, Gating bleibt (auf dieser Maschine N/A).

### Änderungen
- **peerDependencies-Generationenwechsel (ersetzend)**: die sechs `@deepseek-ai/dsh-client-locale` / `dsh-client-store` / `dsh-client-ui-settings-plugins` / `dsh-client-ui-slots` / `dsh-settings` / `dsh-tools` von `>=0.1.7-rc.1 <0.1.8-0` → `>=0.2.0-rc.1 <0.2.1-0`; die 0.1.7-Linie wird als 0.17.x eingefroren und weiter bedient, für DSH 0.1.2-rc.1 ~ 0.1.7 bitte 0.17.x verwenden.
- **`engines.dsh` an beiden Stellen synchron**: sowohl das `engines.dsh` auf oberster Ebene als auch das verschachtelte `dsh.engines.dsh` wechseln auf `>=0.2.0-rc.1 <0.2.1-0` (das Laufzeittor liest nur die Peers, die Metadaten bleiben konsistent).
- **devDependencies-Wechsel**: `@deepseek-ai/dsh-tools` und `@deepseek-ai/dsh-sandbox` von der 0.1.7-Linie → `>=0.2.0-rc.1 <0.2.1-0`, der typecheck löst damit die Host-Typen von 0.2.0 auf — das „komplett grün" beweist 0.2.0-Kompatibilität, keinen 0.1.7-Restbestand.
- **Begründung für null Code**: composer/`forkSession` von 0.2.0 ist eine abwärtskompatible Signaturerweiterung; dieses Plugin liefert Markierungen über die Fassade `ctx.get('conversation').input` (ohne `submit()` aufzurufen, ohne Override-Vertrag), also außerhalb des Wirkbereichs.
- README-Badges/Versions-Kompatibilitätsmatrix/Anpassungshinweise auf 0.2.0-Sprech umgeschrieben.

### Verifikation
- Doppel-tsconfig-typecheck + build + vitest (656 passed / 11 skipped) gegen `dsh-tools@0.2.0-rc.1`, komplett grün; `npm ls` ohne invalid / Peer-Konflikte.

### Sonstiges
- `dsh-plugin.json`-Version 0.17.0 → 0.18.0 (das Feld hinkte dem package.json hinterher, in dieser Version nachgezogen).
- Abhängigkeitsbaum vollständig von npmmirror neu aufgebaut, `package-lock.json` neu generiert und committet.

## [Unreleased] — JEV-artige Pipeline: DOM+Screenshot+Absicht → Laya/JEV-Bewertung (Phase 10 / R5-R6, Branch stage9-ego-cli)

### Neu
- **JEV-artige Pipeline (T10.1–T10.19)**: Frame-Vertrag (Screenshot + nummerierter DOM + Absicht + Aktionsfortschritt) + Bewertungsnähte (nur Nummern zurückgeben, niemals Selektoren).
  - Render-Worker `bin/cdp-render-worker.mjs`: CDP-Client mit Einzelverbindung, `attachPage()` (enable von `Page/Runtime/DOM/Accessibility` in M0.3-Reihenfolge), `gatherInteractive(limit)`, `captureWithinBudget()` (JPEG-Qualitätsleiter + Herunterkalkung + ehrliche `overBudget`-Meldung).
  - Drei Primitive `noul`/`choice`/`score` (`src/jev/wire.ts`) + Protokolllimits (`choice.criteria` nicht leer und ≤255, leere Tabelle wirft zwingend, denn leeres `criteria` ist ein 422 und würde als Modellfehler missdeutet) + `validateQuestions()` meldet alles auf einmal + `THRESHOLD_BUCKETS`/`bucketFor`.
  - Bewertungsnähte `JudgeProvider` + Degradationskette `jev → laya → rule → refuse` (**Nichtverfügbares wird übersprungen, nicht aufgerufen**; jeder Fehlschlag einer Stufe landet in der Trace; `refuse` ist ein Ergebnis, keine Ausnahme).
  - Vier-Werkzeug-Fläche `bcdp_jev_status` / `bcdp_jev_frame` / `bcdp_jev_ask` (`dryRun` standardmäßig true, stufenweise `round=control|chapter|pick`) / `bcdp_jev_run` (Schritt-für-Schritt-Trace). `attachGate()` fängt einheitlich „kein aktiver Browser" ab; `bcdp_doctor` erhält fünf Zeilen zur Bewertungskette.
  - Schleife `src/jev/loop.ts`: sechs Effekte komplett injiziert, `BudgetLedger` prüft vor dem Ausgeben, Sechs-Zustand-Terminierung (inklusive `exhaustedKind`), Ausschlussmenge strukturell wirksam, Neuerfassungs-Schwelle, `#PROGRESS` mechanisch erzeugt.
- **laya zuerst (Revision vom 2026-09-24)**: standardmäßig `judgePrefer='laya,rule'` (kein jev, da JEV nicht registrierbar); leeres `jevUrl` heißt Nichtbeteiligung. Ohne Schlüssel druckt `bcdp_jev_status` die lokale Startanleitung (`ENGINE=laya … uvicorn laya_api.main:app`, Port 8000, `ALLOW_DEV_LOGIN=true`).
- **Kapitelbildung der Aktionen (dreistufige Verengung)**: der Worker leitet über die AX-Elternkette der `childIds` den nächsten strukturierten Vorfahren als Kapitel ab (`CHAPTER_ROLES`-Whitelist, gleiche Rolle nach Dokumentreihenfolge nummeriert: `form#1`/`form#2`); `control → chapter → pick`, bei nur einem Kapitel entfällt die Kapitelrunde; Schwellen nach Kandidatenzahl in Buckets (20 → „einige × einige", beide Runden fallen in die strengen Buckets).
- **Isolation des Bewertungskontexts**: Vier-Segment-Whitelist `INTENT/PROGRESS/FRAME/HISTORY` + Nachverdichtung per `assertJudgeIsolation()` (nackte Großtitel werden zurückgewiesen); `IntentStateInput` ist strukturell ohne Session-Feld — **wer die Browser-UI führt, trägt nicht das vollständige Session-Präfix**.
- **Bewertungsschalter `jevEvaluate` (standardmäßig an, Commit `208ae38`)**: nach jedem Schritt Bewertung `inprogress/done/fail`; `fail` oder „nicht verifiziertes done" → `escalate`, mit geordneter `RecoveryOption[]` (`reload` zuerst, veraltetes Rendering verbirgt bereits geschriebene Bestätigungen), abgeleitet von `recoveryFor(reason, lastAction)`.
- **class der bearbeiteten Elemente bleibt erhalten (Commit `f79a272`)**: trifft `act` genau ein Element, wird `DOM.getOuterHTML` lazy gezogen und über `bin/record-normalize.mjs` normalisiert — Umschreibregeln sind erlaubt, aber Lokalisierungsmerkmale wie `class`/`id`/`role`/`aria-*`/`data-testid` **bleiben erhalten**, es werden nur Inspector-Hüllen-Tokens (etwa `trae-browser-inspect-draggable`) und `style` gestutzt; das vollständige outerHTML geht in `Escalation.actedOn` für die LLM-Wiederherstellung, die kompakte Referenz in HISTORY.

### Verifikation
- Gesamttests 630 passed / 11 skipped (Gating-Proben); beide `tsc` bestanden; `lib/index.js` von 206.613 → 316.544 → 317.402 B (bytebewiesene Verdrahtung der Module).
- Schutzgeländer: `tests/worker-dispatch.test.ts` (behauptet, dass `act/reload/scroll/fill` alle auf deklarierte Funktionen fallen — genau die Bugklasse, die `ed6eccf` still durchließ), `tests/record-normalize.test.ts` (nagelt class-Erhaltung / chrome-token-Stutzen / Lokalisierungsattribute-Verbleib fest).

### Bekannte Grenzen (ehrlich, ohne Schönfärberei)
- **Noch kein End-to-End auf echter Hardware** (T10.22 offen): Unit-Tests decken Protokoll/Schwellen/Terminierung/Kapitelbildung/Assemblierung ab, nicht die echte Kette.
- **Bewertungsgenauigkeit nicht gemessen**: Schwellen-Buckets dienen der Kalibrierung, sie beweisen keine richtigen Entscheidungen.
- **Kapitel-Whitelist nicht an echten Sites kalibriert**: `CHAPTER_ROLES` stammt aus der AX-Rollentabelle; legt eine Site alle Steuerelemente in unbenannte `div`s, fällt alles in das Einzelkapitel `page` und degradiert zur zweiten Ebene (bekannte Degradation, kein Fehler).
- **`render.ts` attached bei jedem Aufruf neu**: sitzungsartige Dauerverbindungen bräuchten einen wiederaufnehmbaren Spawn-Vertrag vom Host — derzeit nicht vorhanden, der Preis ist dokumentiert.

## [Unreleased] — Polymorphie der Verbindungstypen: Verbindungsobjekt für lokales ego-CLI (Phase 9 / R7, Branch stage9-ego-cli)

### Neu
- **Typisierung der Verbindungssequenz**: `BrowserLink = CdpLink | EgoCliLink` (Diskriminierungsfeld `kind: 'cdp' | 'ego-cli'`). Die Array-Reihenfolge **bleibt die Priorität**, `activeTargetId` kann auf beide Typen zeigen.
- **Lokale ego-CLI-Verbindung** (`kind='ego-cli'`, **nur lokal, global höchstens eine**):
  - Vierstufige CLI-Auflösungskette: explizites `cliPath` → `ego-browser` im PATH → Helper im macOS-App-Bundle (`/Applications/ego lite.app/…/Helpers/ego-browser`) → eingebaute Runtime;
  - **Erkundung der Spawn-Form**: zuerst **direkt ausführen**, bei `EACCES`/`ENOEXEC`/`ENOENT` Rückfall auf `node <path>` (das echte CLI ist eine ausführbare Datei im App-Bundle, `ego-browser-v2`/die eingebaute Version ist JS — beide Formen existieren real, das Raten der Endung würde alles unbrauchbar machen);
  - **Keine Injektion von `EGO_LINUX_CDP_URL`**: diese Env gehört nur zur eingebauten Linux-Portierung, das native macOS-CLI liest sie nicht; genau das ist die Existenzberechtigung dieses Typs;
  - **Bereitschaftsprüfung über minimalen heredoc** (derselbe `nodejs`-Kanal wie bei der Arbeit); `--status` dient nur als **opportunistische** Schnellroute mit 2-s-Kurztimeout (bei `unknown option` oder Nicht-JSON des CLI stiller Abbau, **kein Urteil „fehlgeschlagen"**);
  - Fünf Fehlercodes und **kein stiller Rückfall**: `cli-not-found` / `cli-not-executable` / `cli-probe-timeout` / `cli-probe-failed` / `cli-sdk-path-unsupported`.
- **`--sdk-path` als optionale Fähigkeit**: standardmäßig nicht übergeben (das offiziell gepaarte Harness des CLI wird genutzt); wird die explizite Aktivierung abgelehnt (`unknown option`) → `cli-sdk-path-unsupported` vermerkt und **ein automatischer Wiederholungsversuch ohne das Flag**.
- Neu bei `bcdp_doctor`: `links: n (cdp x, ego-cli y)`, `cli: <path> (<origin>, shape <shape>)`, `naming: … legacy ego_* aliases OFF/ON` sowie eine `conflict:`-Warnung, wenn das Upstream-Plugin auf derselben Maschine installiert ist.

### Änderungen (Breaking)
- Einstellungsschlüssel `cdpTargets` → **`links`** (der alte Schlüssel wird eine Version lang als Fallback gelesen, seine Zeilen entsprechen `kind='cdp'`, **null Verlust**).
- Kombination `cdpMode='remote'` mit aktiviertem lokalem CLI → explizites `mode-kind-mismatch` (kein stilles Ausweichen auf andere Einträge mehr).
- Die Semantik von `remoteEnabled` verengt sich auf **nur entferntes CDP**: lokale CLI-Verbindungen bleiben unberührt.

### Behoben
- Der Pfadtrenner und der PATH-Trenner von `makeWhich` folgen nun der **simulierten Plattform** (zuvor die Host-Werte aus `node:path` — eine darwin/linux-Suche unter Windows setzte `dir\file` zusammen und fand nie etwas).

## [0.16.0] - 2026-09-23 — Abschluss der Phase 2b + Weichschalter zum Deaktivieren von Remote-CDP

### Neu
- **`remoteEnabled`-Hauptschalter (T2.18)**: Remote-CDP temporär deaktivieren, ohne die Zielsequenz zu löschen — nach dem Abschalten bleibt die Sequenz unangetastet, aber jede entfernte Erkundung und Verbindung stoppt; `bcdp_*`-Aufrufe erhalten den expliziten Fehler `remote-disabled`; sichtbar im Einstellungskarten-Schalter und in `bcdp_doctor`; jederzeit wieder einschaltbar. Orthogonal zu `allowLocalFallback` (nach Abschalten des Remote kann auto auf den lokalen Launcher zurückfallen).
- **`cdpMode=local` an den eigenen Launcher angebunden (2b-Abschluss)**: der lokale Modus startet jetzt über M0.9 einen verwalteten Browser und injiziert dessen Endpoint, die eingebaute Runtime hängt sich daran an, statt selbst kalt zu starten; der Cache wird mit `endpointSource: local` markiert.
- **Zwei neue Zeilen in `bcdp_doctor`**: `remote CDP: enabled/DISABLED` und `attach: <status> (source: …) @ <endpoint>` (Sichtbarkeit an drei Stellen ergänzt, T2.16).

## [0.15.0] - 2026-09-23 — Lokaler Browser-Launcher (Phase 2b / M0.9)

### Neu
- **Verwalteter lokaler Start**: wenn `allowLocalFallback` aktiv ist und der aktivierte Endpoint unerreichbar, wird automatisch das lokale Chrome/Chromium/Edge gestartet (explizite Entdeckung → Plattform-Kandidatentabelle), `http://127.0.0.1:<port>` injiziert und die Arbeit fortgesetzt; das Attach-Badge zeigt `endpointSource: local-fallback`; **umgekehrter Rückfall verboten**.
- **Singleton-Wiederverwendung** (T2.13): `launcher.json` hält pid/port/profile fest; nur selbst gestartete und noch antwortende Instanzen werden wiederverwendet.
- **Stopp und Rückgewinnung** (T2.14): unter win32 tötet `taskkill /T /F` den ganzen Baum (0 Waisen gemessen); der Idle-Reaper räumt lokale Instanzen nebenbei mit ab.
- **Einstellungen**: `localHeadless`, `localUserDataDir` (Standard `~/.dsh/cache/dsh-browser-cdp/chrome-profile`, niemals das Alltags-Profil).
- **Port-Strategie** (T2.11): ein freier Port wird vorab zugewiesen und explizit übergeben, ohne sich auf die unverifizierten Mechanismen DevToolsActivePort/Port 0 zu verlassen.
- **Auflösung von Textkonflikten**: Titel des Watch-Tabs/der schwebenden Kugel „Agent 浏览器" → „CDP 浏览器" (Analyse in findings A.5).

## [0.14.0] - 2026-09-23 — Auswahl-Referenzen seitenweise zu Wörterbuchblöcken aggregiert, mit Quell-CDP-Verbindung

### Änderungen
- **Seitenweise Aggregation**: eine Referenz trägt nur den Inhalt einer einzigen Webseite — mehrere Elemente derselben Seite verschmelzen in **denselben Block**, Auswahlen auf anderen Seiten erzeugen neue Blöcke.
- **Wörterbuchumhüllung** (in Analogie zu den vorab verblockten Bildanhängen): der Block im Entwurf sieht so aus:
  `[CDP-PICKS page="…" targetId="…" endpoint="…"]` + JSON (`cdpEndpoint`/`targetId`/`pageUrl`/`pageTitle`/`elements[]`) + `[/CDP-PICKS]`.
- **Quelle rückverfolgbar**: der Block enthält `cdpEndpoint` (der Worker leitet ihn aus `active.wsUrl` ab, indem er `/devtools/*` abzieht) + `targetId`; jeder Eintrag von `elements[]` trägt ein `backendNodeId` — `bcdp_cdp` kann die DOM-Struktur des Elements direkt über `DOM.describeNode({backendNodeId})` nachschlagen; zusätzlich `pageUrl`/`pageTitle`.
- worker: `PickElement.source` neu (`Target.getTargets` holt die Seitenmetadaten + `getEndpoint` injiziert die Verbindungsquelle).
- Semantik fortgeführt: kein automatisches Senden (v0.13.0), Fortsetzung der `n`-Nummerierung auf derselben Seite.

## [0.13.0] - 2026-09-23 — Auswahl-Zustellung auf nummerierte Referenzen umgestellt, Autosenden abgeschafft

### Änderungen (Breaking)
- **Kein automatisches Senden mehr**: der submit()-Pfad von „Zur Konversation hinzufügen" wurde vollständig entfernt — jede Auswahlaktion schreibt nur in den Entwurf des Eingabefelds, **das Senden liegt immer beim Benutzer** (Enter im Eingabefeld oder Klick auf Senden).
- **Nummerierte Referenzen**: jede Auswahl hängt `[pick N] <Elementbeschreibung>` an den Entwurf an, N zählt die bestehende `[pick N]`-Sequenz im Eingabefeld automatisch weiter — mehrere Auswahlen bilden eine geordnete Liste.
- **Schwebekarte mit nur einer Aktion**: „In die Konversation referenzieren (Ctrl+J oder ↵)" — beide Kürzel gleichwertig, im bestätigten Zustand erscheint „✓ In das Eingabefeld referenziert".

## [0.12.0] - 2026-09-23 — Ent-egoisierung: Identität als CDP-Browser-Proxy (Phase 8)

### Änderungen (Breaking)
- **33 Werkzeuge `ego_*` → `bcdp_*`**: `bcdp_status` / `bcdp_navigate` / `bcdp_doctor` … (Präfix aus der Plugin-ID abgeleitet, im Ökosystem frei). Skripte mit den alten Namen können über die neue Einstellung `legacyEgoToolNames: true` übergehen (registriert zusätzlich `ego_*`-Aliase; gegenseitig ausschließend mit dem Upstream-Plugin ego-browser).
- **HTTP-Routen `/api/ego/*` → `/api/bcdp/*`**, Einstellungsgateway `/ego/api/*` → `/bcdp/api/*` (Panel synchronisiert).
- **Ressourcen umbenannt**: `bin/ego-cast-worker.mjs` → `bin/cdp-cast-worker.mjs`, `bin/ego-chrome-wrapper.sh` → `bin/cdp-chrome-wrapper.sh` (Worker-Prozess-Abgleich/Aufräumlogik synchron).
- **Konfigurationsschlüssel** `egoCliArgs` → `runtimeArgs` (der alte Schlüssel wird eine Version lang automatisch gelesen, keine Einstellungsverluste).
- **Texte**: die Eigenbezeichnung des Panels EN/ZH vereinheitlicht auf „CDP 浏览器代理 / CDP browser bridge", ohne ego-Voranstellung; README synchronisiert.
- Interne Verdrahtung (`EGO_LINUX_*`-Umgebungsvariablen) und der Verzeichnisname der vendored Runtime **bleiben bewusst unverändert** (Upgrade-Sicherheit).
- Nebeneffekt: **Koexistenz mit dem Upstream** `Fisfzy/ego-browser` möglich (Werkzeugnamen/Routen alle versetzt).

## [0.11.1] - 2026-09-23 — Behoben: zwei Fehlbewertungen des Auswahl-Zustands im Panel

### Behoben
- Der Zwischenzustand `picked` des Workers (erfasst, wartend auf Aktion) wurde vom Panel fälschlich als Fehlschlag eingestuft und als „Auswahl fehlgeschlagen" angezeigt — jetzt erscheint korrekt die Elementbeschreibung.
- Beim Bewaffnen des Panels wurde die Zustellungs-Baseline auf `picks` ausgerichtet und schluckte damit die Zustellung der Auswahl, die **vor dem Bewaffnen** geschah — die Baseline rückt eine Stufe nach unten, die auf Aktion wartende Auswahl wird zwingend zugestellt.

# Changelog

Alle benutzersichtbaren Änderungen sind unter der jeweiligen Versionsnummer gebündelt. Das Format folgt [Keep a Changelog](https://keepachangelog.com/), die Versionssemantik [SemVer](http://semver.org/).

## [0.11.0] - 2026-09-23 — M1.6-Zustellung an die Konversation + Koordinaten-Auswahl-Rückfallroute

### Neu
- **Zustellung der Auswahl-Ergebnisse an die Konversation (M1.6 / T5.6–T5.7)**: die zwei Aktionen der Seiten-Schwebekarte schreiben jetzt wirklich in die Konversation — „In der Konversation kommentieren" schreibt die Elementbeschreibung in den Entwurf des Eingabefelds (der Nutzer ergänzt seinen Kommentar und sendet selbst); „Zur Konversation hinzufügen" schreibt in den Entwurf und **sendet automatisch** (derselbe adjudication-Pfad wie der Senden-Button). Vor dem Senden wird `phase === 'plain'` geprüft; pro Auswahl nur eine Zustellung; das Ergebnis (✓ an die Konversation gesendet / ✓ ins Eingabefeld geschrieben / Zustellung fehlgeschlagen + Grund) erscheint als Rückmeldung in der Statuszeile des Beobachtungsfensters.
- **Koordinaten-Auswahl-Rückfallroute (T5.1b)**: im Auswahlmodus bedeutet ein Klick auf das Livebild des Beobachtungsfensters = Auswahl — die umgerechneten Koordinaten gehen an den Worker, Trefferauflösung über `DOM.getNodeForLocation` (ohne Abhängigkeit vom Overlay-Ereigniskanal), auf derselben Beschreibungs-/Mess-/UI-Injektionspipeline. Sowohl in der Seitenleiste als auch im Schwebefenster unterstützt.
- worker: neu `POST /api/pick/click {targetId, x, y}`; host leitet `/api/ego/pick/click` synchron weiter.

### Hinweise
- Ein Klick ins Leere, der keinen Knoten trifft, meldet explizit „Auswahl fehlgeschlagen (no-node-at-point)", ohne still zu idle zurückzukehren (Leere-Klick-Fixtures, T5.8).

## [0.10.0] - 2026-09-23 — CDP-P0-Fundament + Elementauswahl (R6-Körper) + Set-of-Marks (R4)

### Neu
- **Elementauswahl (R6-Körper)**: die Werkzeugleiste des Beobachtungsfensters erhält einen Schalter „Element auswählen" (je einer in Seitenleiste und Schwebefenster, beide links von „Echte Seite öffnen"). Nach dem Einschalten wählt man Elemente in der ausgewählten echten Seite aus: himmelblauer 2-px-Auswahlrahmen + an das Element geklebte Schwebekarte mit zwei Aktionen „In der Konversation kommentieren Ctrl+J" / „Zur Konversation hinzufügen ↵", danach erscheint an Ort und Stelle „✓ Zur Konversation übertragen" und klappt nach 2,5 s zusammen; nach Abschluss einer Aktion bewaffnet sich der Auswahlmodus automatisch neu, Serienauswahlen brauchen keine Rückkehr zum Panel. Tab-Wechsel / Panel-Schließen verlässt die Auswahl und räumt die injizierte UI ab.
- **Set-of-Marks-Screenshot (R4-Mechanik + Gateway)**: `POST /api/ego/marks` liefert in einem Aufruf Screenshot + nummerierte Karte der interaktiven Elemente in Dokumentreihenfolge (AX-Baumfilter, `n = 1..N`, mit Viewport-Rect und einzeiliger semantischer Beschreibung), optionales Hervorheben eines einzelnen Elements. Reine CDP-Implementierung, null Seiteninjektion; die nummerierte Karte ist der Ersatz für die Overlay-Beschränkung, immer nur einen Knoten hervorheben zu können (gemessene Beschränkung).
- **CDP-Dauer-Session-Fundament (P0)**: unter `src/cdp/` — endpoint (Normalisierung/Entdeckung von Endpunkten, 8 strukturierte Fehlercodes), session (Paarung der Befehls-ids/Timeout je Befehl/Rückverbindung mit Backoff/**Wiedereinspielen der enable-Sequenz nach Reconnect**), events (Domänenverteilung/Zustandsaffinität von Domänen/Reihenfolge `DOM.enable → Overlay.enable`), dom, input (**kein Pfad mit direktem `.value`-Eintrag**, Trefferprüfung des Klicks), page (Dokumentkoordinaten-Semantik für den Screenshot-Clip, `highlightConfig` prozessintern erzwungen, `Runtime.addBinding`).
- **Echte-Maschinen-Proben** (ausgelöst durch `CDP_PROBE_URL`, standardmäßig übersprungen): Entdeckung 19 ms → Verbindung 7 ms → Befehl 1–5 ms → binding-Rücklauf 42 ms, Nachweis über die gesamte Kette.

### Hinweise
- **Zustellungsgrenze**: das „Zur Konversation übertragen" der Seiten-Schwebekarte ist derzeit ein UI-Zustand; die hostseitige Verdrahtung zum Schreiben ins Konversationseingabefeld (`conversation.input.for(actx).setDraft/submit`) ist nicht fertig, Auswahl-Ergebnisse sind derzeit über `lastPick`/`lastAction` von `GET /api/ego/pick` beobachtbar.

## [0.9.1] - 2026-09-23 — Behoben: CDP-Ziele verschwinden nach dem Speichern aus dem Panel

### Behoben
- **Nach erfolgreichem Speichern des Einstellungspanels verschwand die gesamte CDP-Zielsequenz aus der Oberfläche (die Daten waren tatsächlich geschrieben)**: beim Wiederaufbau des Einstellungsentwurfs mit der vom Server zurückgegebenen Konfiguration im Erfolg-Callback des Speicherns fehlten drei Felder — `cdpTargets` / `activeTargetId` / `cdpMode` (in `load()` vorhanden, in diesem Pfad nicht). Nach „Ziel hinzufügen → Endpoint eintragen → Speichern" fielen die Ziele sofort auf „noch keine Ziele" zurück, obwohl `~/.dsh/settings.yaml` die richtigen Ziele und das richtige `activeTargetId` enthielt. Die drei Felder sind im Erfolgspfad ergänzt, an `load()` angeglichen.
  > Untersuchungsnotiz: `ALLOWED_KEYS` auf `/ego/api/set` wie auch `sanitizeJsonArray` arbeiteten normal, das Problem lag allein am Entwurfswiederaufbau des Clients; weder Gateway noch Schema verloren Felder.

## [0.9.0] - 2026-09-23 — CDP-Zielsequenz + Aktivierung (R1) + Paketname vereinheitlicht auf dsh-browser-cdp

### Neu
- **CDP-Zielsequenz und Aktivierung (R1)**: neue Konfigurationen `cdpTargets` (geordnete Sequenz) / `activeTargetId` (Ein-Punkt-Aktivierung) / `cdpMode` (`auto`/`local`/`remote`) / `cdpProbeTimeoutMs`. Jedes `ego_*`-Werkzeug steuert **den** aktivierten Endpoint an, nicht den lokalen Browser.
- **Sequenz-Editor im Einstellungspanel**: Ziele hinzufügen/löschen/ändern + vertikale Sortierung, Aktivierung per Radioknopf, je Eintrag ein „Sonde"-Button und ein Erreichbarkeits-Badge (Echtzeitstatus via Polling von `/ego/api/cdp-status`). Die Endpunkt-Validierung erlaubt nur `http(s)://host:port` oder `ws(s)://…`, ein unzulässiges Schema meldet explizit einen Fehler statt still zu raten.
- **Explizite Aktivierungskette**: `resolveEgoEnv` injiziert `EGO_LINUX_CDP_URL` gemäß `cdpMode`; Einstellungsänderungen (und der erste Start) lösen `refreshAttach` aus, um den aktivierten Endpoint neu zu sondieren; ändert sich der Endpoint, startet `setAttachEndpoint` den Cast-Worker neu, damit er sich wieder an denselben Browser hängt. Die Entscheidungstabelle `decideAttach` garantiert, dass ein Fehlschlag **nie still** auf den lokalen Browser zurückfällt — unter `auto`/`remote` ohne Aktivierung oder bei Unerreichbarkeit gibt es stets einen strukturierten Fehler.
- **Neue Gateway-Endpunkte**: `POST /ego/api/cdp-status` (liest den Echtzeit-Aktivierungszustand), `cdp-refresh` (manuell neu sondieren und Worker-Attach auffrischen), `cdp-probe` (einmalige Sonde auf einen beliebigen Endpoint, Ergebnis in die `probe*`-Felder des Ziels zurückgeschrieben).
- **Paketname vereinheitlicht auf `dsh-browser-cdp`**: `cordis.patch.yml`, `dsh-plugin.json` (`id`/`name`/Scene·SettingsSection id/namespace), Einstellungs-Namespace, Client-Sidebar-Tab-Id (`dsh-browser-cdp:watch`), Locale-Texte und Log-Präfixe alle ausgerichtet.
- **Veröffentlichung des Repositorys auf `github.com/drscrewdriver/dsh-browser-cdp`**: `package.json#repository` und `dsh-plugin.json#source` vom Upstream `Fisfzy/dsh-ego-browser` (MIT, Namensnennung erhalten) auf dieses Repository umgelenkt. Direktinstallation aus GitHub unterstützt: `dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp` (pnpm zieht den Tarball via `codeload.github.com`, keine Registry-Veröffentlichung), Festlegung mit `#v0.9.0` / `#<sha>` möglich.

### Tests
- Neu `tests/cdp-targets.test.ts` (26 Fälle): `normalizeEndpoint` / `sanitizeTargets` / Sequenzhelfer / `probeEndpoint` (injizierbares fetch, keine echte Uhr gelesen) / `decideAttach` / `refreshAttach`+Cache. Volle Abdeckung der Analyse-, Sonden- und Entscheidungswege von `cdp-targets.ts`.

## [0.8.5] - 2026-09-18 — Login-Import + Idle-Rückgewinnung + Korrekturpaket für das Beobachtungsfenster

### Neu
- **Import des Login-Zustands aus dem Systembrowser (#46)**: neues Werkzeug `ego_login_import` + Block „Login-Zustand aus dem Systembrowser importieren" in der Einstellungskarte + Route `POST /api/ego/login-import`. Kopiert die Login-Cookies des alltäglichen Chrome/Edge/Brave domänenweise in den Agent-Browser: echte Binary im Headless-Start mit echtem Profile (Junction-Alias umgeht die Standardverzeichnis-CDP-Beschränkung von Chromium ≥136 und erfüllt zugleich die Pfadbindung der App-Bound Encryption), Lesen per CDP `Storage.getCookies`, Filtern, Schreiben ins persistente Profil via `Storage.setCookies`. Unterstützt `source/domains/profile/closeSource/dryRun`; läuft der Quellbrowser, kann er vor dem Import sauber beendet werden (das Fenster stellt sich beim nächsten Start wieder her); **vor dem Import wird die Cookie-Datenbank der Quelle automatisch gesichert, bei erkannter Leerung automatisch wiederhergestellt**; Cookie-Werte gelangen nicht in Logs oder Ausgaben.
- **Automatische Idle-Rückgewinnung (#47, opt-in)**: neue Einstellung `idleTimeoutMin` (Standard 0, aus). Nach N Minuten ohne `ego_*`-Aufruf wird der Hintergrundbrowser per sanftem `--stop` beendet (im Leerlauf gemessen ~425 MB), der nächste Aufruf startet in 2-4 s kalt. Das Zuschauen des Beobachtungsfensters gilt nicht als Aktivität (im Einstellungstext vermerkt).
- **„Pop-out"-Button des Beobachtungsfensters (#51)**: Schwebefenster und Sidebar-Tab erhalten einen Button, der das Runtime-Kommando `ego-browser --open` aufruft — die Headless-Instanz wird an Ort und Stelle durch eine Fensterinstanz desselben Profils ersetzt (Tabs bleiben erhalten), eine Fensterinstanz kommt nach vorn. Die Schlussfolgerung, dass die CDP-Vorschau im Headless-Modus ohnehin nutzbar ist, wurde ebenfalls praktisch bestätigt.

### Behoben
- **Viewport-Screenshot nach Scroll komplett weiß (PR #50)**: der Clip-Ursprung von `Page.captureScreenshot` liegt in Dokumentkoordinaten; die Viewport-Aufnahme war fix auf `{x:0,y:0}`, nach dem Scrollen fiel der Clip in einen unbemalten Bereich (`captureBeyondViewport: false`) → leeres Bild. Jetzt dient `pageInfo().sx/sy` (`scrollX/scrollY`) als Clip-Ursprung; auch das viewport boundingBox des locator erhält den Scroll-Offset, im Einklang mit dem followClip von `spaces-server`.
- **Der Chat-Externe-Link wurde vom Beobachtungsfenster abgefangen und ließ sich nicht rendern (#48)**: die `urlTarget`-Deklaration des Sidebar-Tabs war zu breit (sie beanspruchte alles http(s)), obwohl dieser Tab nur ein Streaming-Bild ist. Deklaration entfernt, externe Links kehren zum eingebauten Browser-Tab zurück.
- **Nach Browser-Neustart meldeten alle `ego_*` task space not found**: die vom Plugin gemerkte numerische Space-Id hing nach dem Neustart in der Luft. Neu `runWithStaleSpaceRetry`: nach Erkennung dieses Fehlers wird der Space automatisch per Name neu aufgebaut und einmal wiederholt (volle Abdeckung der Aktionswerkzeuge + ego_cli/ego_captcha/ego_script).
- **Im Multi-Session-Betrieb öffnete das Beobachtungsfenster in der falschen Session (#53, PR #54)**: `markEgoToolCall` trägt die Id der aufrufenden Session, das automatische Öffnen lokalisiert die Seitenleiste je Session; der Einmal-Guard wird je Session, der Erkennungsfluss bleibt dauerhaft.

### Community
- Gemergt: PR #50 (Screenshot-Korrektur, hpqc032), #52 (englisches i18n des Beobachtungsfensters, M4cd1r; wir ergänzten eine `wt()`-Defaultwert-Korrektur, um den typecheck wiederherzustellen), #54 (Session-Scope, xiaochaZ).

## [0.8.4] - 2026-09-15 — Korrekturen der Worker-Startkette des Beobachtungsfensters + Merges von Community-PRs

### Behoben
- **Das Beobachtungsfenster startete unter DSH ≥ 0.1.5 nie (#34 / #38 / #43)**: dem Worker-Spawn fehlte das für den subprocess provider von 0.1.5 zwingende `cwd`, und die Ausnahme wurde von einem nackten `catch` verschluckt, sodass `ensureWorker()` immer null zurückgab. `cwd` ergänzt.
- **Der Worker tötete sich beim Start selbst (Defekt 2 von #34 / #40)**: die lockere Teilstring-Übereinstimmung von `stopSiblingWorkers()` hielt den DSH-subprocess-runner für einen Peer-Worker, und `taskkill /T` erschoss den eigenen Prozessbaum gleich mit — der Worker starb, bevor er `ego-cast.json` schrieb. Die Übereinstimmung wird auf „das direkte Skriptargument von node ist ego-cast-worker.mjs" verengt, die eigene Vorfahrenkette ausgeschlossen.
- **Auf dem Electron-Host (DSH Desktop) meldeten alle `ego_*` no @@DSH_RESULT@@ (#42)**: bei explizit übergebenem env fehlte `ELECTRON_RUN_AS_NODE`, der Kindprozess startete als zweite Electron-App. `resolveEgoEnv` und der Worker-Spawn ergänzen automatisch `ELECTRON_RUN_AS_NODE=1`, wenn `process.versions.electron` existiert.
- **Leere Antwort von /api/ego/stream beim Worker-Ausfall (#39, PR #44)**: `proxyWorkerStream(-1)` kurzschließt zu stillem SSE (schreibt den `text/event-stream`-Header und bleibt in der Langverbindung still), statt den `ERR_SOCKET_BAD_PORT` zu triggern, der die Verbindung abriss; inklusive 42 Zeilen neuer Tests.
- **Unter Windows wurde EGO_LINUX_HEADLESS still ignoriert (#35)**: das explizite `EGO_LINUX_HEADLESS=1` hat jetzt Vorrang vor der win32-Standardableitung `hasDisplay=true`, konsistent mit CLI-Hilfe / README-Dokumentation.
- **Web-Boot des Clients auf Hosts ohne dsh-better-sidebar komplett blockiert**: die statische Inject-Liste des Clients entfernt `betterSidebar` (der Loader würde ewig auf den fehlenden Dienst warten), ersetzt durch `ctx.get`-Erkundung + sofortiges Montieren der schwebenden Beobachtungskugel + Aufwertung zum Sidebar-Tab via `ctx.inject`, sobald der Dienst erscheint (Dank an das Schema aus PR #45).

### Neu
- **`isolateSpaces`-Sandbox-Isolationsschalter für Task-Spaces (PR #31)**: standardmäßig aus, die Task-Spaces nutzen das persistente Profil auf Disk, der Login-Zustand überdauert Neustarts (deckt das Anliegen von #1 ab); beim Einschalten kehrt die Sandbox-Isolation im Speicher zurück. Die Beschreibungen der Werkzeuge `ego_space_open`/`ego_space_close` werden je Modus dynamisch injiziert; die nicht persistierbaren booleschen Gateway-Einstellungen sind behoben.

### Sonstiges
- Korrektur der unausgefüllten `allowBuilds`-Vorlagenplatzhalter in `pnpm-workspace.yaml`, die pnpm 11 das Installieren verweigerten; Config-Test-Fixture für `isolateSpaces` ergänzt.
- Gemergt: PR #36 (Versions-Kompatibilitätsmatrix im README), #31, #44; das überholte #45 geschlossen.

## [0.8.3] - 2026-09-07 — DSH-0.1.2-rc.1-Kompatibilität + Sicherheits-/Stabilitätskorrekturen

### Sicherheit
- **Unauthentifizierte `/api/ego/*`-Routen behoben**: exakte Routen trafen vor dem `/api`-Präfix-Vertrauenszaun des Hosts, sodass `GET /api/ego/stream` ohne Nachweise Live-Bildframes ausließ und `POST /api/ego/input` ohne Nachweise Eingaben einspeisen konnte (cross-site ferngesteuert). Einheitliche Ummantelung von webServer.register: alle ego-Routen verlangen ein `dsh-auth-*`-Cookie mit SameSite=Strict, das böswillige Seiten naturgemäß nicht mitführen; die Wache wirkt nur auf die eigenen Routen des Plugins und verschmutzt nicht die Registrierungen anderer Plugins auf dem Host-Singleton.

### Behoben
- **Client-Startfehler auf Hosts ohne dsh-better-sidebar (#29)**: hart deklariertes `inject` und nackter Eigenschaftszugriff auf `ctx.betterSidebar` warfen unter strengem Resolver „without inject". Die Deklaration bleibt (sie ist eine Auflösebedingung) + der Zugriff wird in try/catch verpackt und der Parameter explizit übergeben — ein Host ohne Sidebar fällt auf die schwebende Kugel zurück, statt komplett einzufrieren.
- **Windows-Kaltstart-Regression**: der Xvfb-Support aus #22 änderte ohne `DISPLAY` den Standard von headless auf Xvfb-Start, aber Windows hat eine Desktop-Session und kein Xvfb → Kaltstart scheiterte mit „no X display / no Xvfb binary". `ensureXDisplay` und das Eintritts-`hasDisplay` erhalten einen win32-Zweig (Desktop-Session gilt als Display, Fenster mit Oberfläche öffnen direkt, Rückkehr zum v0.4.0-Anpassungsverhalten).
- **Einstellungs-Whitelist des Gateways ohne `egoCliArgs`/`chromeArgs`**: `/ego/api/set` ließ diese beiden Konfigurationsfelder still fallen, Persistenz unmöglich — in `ALLOWED_KEYS` ergänzt.

### Merges (Community-PRs + lokal)
- 6 Community-PRs gemergt: `#20` root-Betrieb, `#22` xvfb, `#16` macOS-headless-Erkennung, `#24` schemastery-`link:`-Korrektur, `#28` DSH-0.1.2-rc.1-/v0.1.3-alpha.1-Kompatibilität (peer/engines verschärft), `#13` Windows-Stabilität.
- JSON-Syntaxfehler des Manifests durch fehlendes Komma in dsh-plugin.json behoben (Quelle der Verzeichnisaufnahme-Blockade).
- MIT LICENSE ergänzt; Supply-Chain-/Berechtigungshinweise ergänzt; `*.map` nicht mehr versioniert.
- Offizielles build-dsh-plugin-Audit bestanden: `status: READY_FOR_PINNED_SOURCE_VERIFICATION`, `route: direct`, `blockers: 0`.

### Kompatibilität
- `engines.dsh: >=0.1.2-rc.1`; peer dependencies alle auf `>=0.1.2-rc.1` fixiert.
- Unter DSH 0.1.2-rc.1 (Windows/web profile) Installation, Start, echter `ego_navigate`-Aufruf und Abnahme des Live-Beobachtungspanels abgeschlossen; `0.1.2-alpha.x` als installierbar deklariert, aber ungetestet; `<0.1.2-rc.1` → bitte v0.8.0 und älter.

## [0.8.1] - 2026-08-28 — DSH-0.1.2-alpha.1-Kompatibilität

### Änderungen
- **Migration der Client-Hälfte zu `@deepseek-ai/dsh-client-store`**: 0.1.2-alpha.1 benennt `@deepseek-ai/dsh-client-runtime` (einschließlich `/client`-Unterpfad) in `@deepseek-ai/dsh-client-store` um (der Client-Modulgraph nutzt den nackten Paketnamen als statische Modul-ID). Die Signatur von `createSnapshotStore` bleibt unverändert.
- **Client-Modulregistrierungs-ID = deklarierter Paketname `dsh-ego-browser`**: in 0.1.2 wird die Id der Boot-Manifest-Zeilen aus dem `name` des package.json erzeugt, und der Loader-Zeilenspezifikationsname muss übereinstimmen (`nearestPackage`-Namensgleichheitsprüfung); ein Mount per Alias (Junction-Ladeschlüssel `@dsh-external/ego-browser`) wurde vom Scanner als „not a client row" gewertet → das Beobachtungspanel verschwand still. tsdowns Banner-ID und der Zeilenname in `cordis.patch.yml` sind auf den deklarierten Paketnamen vereinheitlicht; das `dsh-ego-browser` im `dsh-plugin.json` bleibt unverändert.
- **`dsh.client.inject` deklariert nur echte Graphzeilen**: in 0.1.2 sind `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots` statische Module (außerhalb des Modulgraphen); als Injektionskanten deklariert blieb der Eintrag still hängen (Modul nicht materialisiert, Panel nicht gemountet, keinerlei Fehlermeldung). Übrig bleiben locale / ui-settings-plugins, die zwei echten Graphzeilen.
- **Der optionale webServer-Dienst wechselt zur Lieferung per verschachtelter Injektion**: der strenge Dienst-Resolver von 0.1.2 lieferte für `ctx.get('webServer')` ohne Injektionsdeklaration undefined → die `/api/ego/*`-Beobachtungsrouten waren still nicht registriert → Datenschicht des Panels in 401/Leerzustand. Wechsel zu `ctx.inject(['webServer'], cb)` (Routen nur registriert, wenn der Dienst da ist; TUI-/headless-Hosts ohne Webserver bleiben tools-only ohne Blockade).
- **Peer-Dependencies an die 0.1.x-Familie angeglichen** (client-locale / client-ui-slots / client-ui-settings-plugins / dsh-settings / dsh-tools mit `>=0.1.1-rc.2` deklariert), `engines.dsh: >=0.1.2-alpha.1`.
- Nach den Korrekturen verifiziert: Client-Module normal materialisiert, Sidebar-Tab „Agent 浏览器" und Beobachtungs-/Übernahmefluss nutzbar, `/api/ego/*`-Routen mit 200, Live-Streaming auf `streaming`, Klick-/Eingabeketten auf dem Bild erreichbar (pointerdown → `/api/ego/input` → CDP-Dispatch).

## [Unreleased]

Doppelter Bildpipeline-Durchbruch für das Beobachtungsfenster: Behebung der CDP-Protokollwurzel, dazu ein optionaler FFmpeg-H.264/fMP4-Backend.

### Neu / Verbesserungen
- **Benutzerdefinierte Startparameter**: die Einstellungskarte erhält zwei Felder, „ego-browser CLI Zusatzparameter" und „Chrome-Start Zusatzparameter". Erstere ergänzen das argv von `ego-browser nodejs` und wirken ab dem nächsten `ego_*`-Aufruf; letztere werden über `EGO_LINUX_EXTRA_ARGS` an das `launch()` der vendored Runtime durchgereicht und wirken erst beim nächsten Kaltstart des Browsers (der Browser ist ein residentes Singleton — erst `ego-browser --stop` oder ein DSH-Neustart bringt ihn zum Neustart). Beide Seiten schwärzen die Flags ab, die die selbstverwaltete Steuerebene des Plugins brechen würden (`--status`/`--stop`/`--help`/`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` usw.); für `--proxy-server` bitte `EGO_LINUX_PROXY` verwenden. `ego_doctor` meldet die aktuell wirksamen Parameter.
- FFmpeg wird auf explizite Bedarfsinstallation umgestellt: CDP hängt nicht mehr von `ffmpeg-static` ab und installiert es nicht mehr. Die Einstellungsseite prüft zuerst benutzerdefinierten Pfad, System-PATH und verwalteten Cache; die FFmpeg-Option bleibt deaktiviert, bis die Kompatibilitätsprüfung abgeschlossen ist, dazu ein Ein-Klick-Download mit fester Version und SHA-256-Verifikation.
- Neu `githubMirror`: ersetzt `https://github.com` durch die vom Nutzer eingetragene HTTPS-Basis; unter Windows/Linux ein fester BtbN-Release-Tag, unter macOS feste Plattform-Assets. Der Download landet in einem temporären Verzeichnis unter `~/.dsh/cache/ego-browser/ffmpeg/`; die atomare Freigabe erfolgt erst, wenn Verifikation, Entpacken und Fähigkeitsprobe alle erfolgreich sind.
- Das Beobachtungsbild erhält einen teilweisen Tastatur-Eingabeproxy: normaler Text und Einfügen über `Input.insertText`, das chinesische IME wird nach Abschluss der Komposition auf einmal gesendet, Steuer- und Kürzeltasten über `Input.dispatchKeyEvent`. Der Fokus wird erst nach einem Klick auf das Beobachtungsbild übernommen, ohne die DSH-eigene Eingabe zu stehlen.
- Neue Einstellung `ffmpegBitrateKbps` (500-20000 kbps); Standard 2000/4000/8000 kbps für niedrig/ausgewogen/hoch. Der Encoder nutzt Zielbitrate, Peak-Bitrate und VBV-Puffer und ersetzt damit den ~200-kbps-Standard von `h264_mf` sowie `libx264 crf=28`.
- Wechselt das DSH-Fenster in den Hintergrund, bleiben watch/SSE/video ununterbrochen; die Lease-TTL steigt auf 120 Sekunden, und start/switch/renew-Anfragen werden im Single-Flight dedupliziert, damit die Hintergrund-Timer-Drossel weder Capture-Verfall noch endloses `starting` erzeugt.
- `CaptureManager` + Watcher-Lease: gleichzeitig nur ein aktiver Backend und ein betrachteter target; bei verborgenem Panel stoppt die Aufnahme.
- Das CDP-Backend unterscheidet korrekt die Frame-ACK-ID und die flattened target session, Protokollfehler sind sichtbar; standardmäßig 20 FPS, latest-frame-Drossel, Ein-target-Rückhalt, Entfernung des erzwungenen Neuzeichnens transparenter Animationen.
- FFmpeg-Backend: Windows nutzt `gfxcapture(hwnd)` zum direkten Erfassen der D3D11-Fenster-Oberfläche von Chrome, andere Plattformen behalten den Anzeigequellen-Crop; kodiert als H.264 fragmented MP4, wiedergegeben über binäres HTTP und MediaSource, generation-isoliert von Daten alter Prozesse.
- Neue Einstellungen: `captureBackend`, Qualitätsstufen, CDP/FFmpeg-FPS, maximale Breite und Encoder; alte Felder zentral migriert.
- Neue Unit-Tests: MP4-Parser, CDP-ACK, CaptureManager, Konfigurationsmigration, plattformabhängige argv.

### Plattformgrenzen
- Windows verlangt ein FFmpeg mit `gfxcapture`; das HWND wird über Browser-PID, target-Titel und CDP-Fenstergrenzen abgeglichen; ist das Fenster verdeckt oder verschoben, wird die Zielseite dennoch erfasst, und ein Rückfall auf `gdigrab desktop` ist verboten. Das Verhalten im minimierten Fenster bestimmt weiterhin Windows Graphics Capture.
- Linux X11 nutzt `x11grab`, macOS `avfoundation` als Bildschirm-Crop; Verdeckung und Systemberechtigungen wirken weiterhin auf beide Plattformen.
- Wayland: ohne nutzbare Portal/PipeWire-Eingabe des mitgelieferten FFmpeg folgt die klare Meldung `unsupported-ffmpeg-pipewire`, kein root-`kmsgrab`, kein stiller Wechsel auf den ganzen Desktop und kein Erfolgs-Vortäuschen.

### Behoben
- **Maus sporadisch völlig ohne Anfrage / Tastatur dauerhaft unbenutzbar**: die Steuerungsebene hängt nicht mehr von `streamState` oder der spaces-Synchronisation ab, sondern sendet nur nach dem target des aktuellen Bildes; der Worker behält die endgültige Prüfung veralteter targets. Zuvor hatte das Frontend keinerlei Tastatur-Listener oder Protokollunterstützung — der volle Weg text/keyDown/keyUp wird hiermit geschlossen.
- **FFmpeg lief tatsächlich, doch die Tab zeigte CDP**: der Capture-Zustand wird jetzt aus SSE, watch-Antwort, spaces capture und watch/status vereinheitlicht; fehlt der Backend, bleibt der aktuelle Wert, das Standard-Überschreiben auf CDP ist verboten.
- **Verwaistes about:blank-Fenster nach `space_open`**: der erfolgreich geöffnete Task-Space wird der zuletzt aktive Space; nachfolgende Werkzeuge ohne `space` (navigate/click/fill usw.) nutzen diesen Space wieder, statt auf das feste `dsh-agent` zurückzufallen und ein zweites Fenster zu erzeugen. Nach Schließen des aktiven Space gilt wieder der Konfigurationsstandard.
- **watch/start 502 und input 500**: die Fähigkeitssonde des FFmpeg-Binär und von `gfxcapture` wird zum asynchronen Unterprozess, die Worker-Health blockiert während des Starts nicht mehr; der Worker-Proxy-Timeout für watch start/switch steigt auf 30 Sekunden und deckt das volle Obergrenzen-Set aus Fenster, Encoder und MP4-Init ab. Der host reicht HTTP-Status und JSON-Fehler des Workers unverändert durch und liefert nur bei tatsächlich unerreichbarem Worker ein 502. Eingaben werden client- und workerseitig geprüft; ein ungültiger target liefert 409 `capture-target-stale`, statt als 500 verpackt zu werden.
- **FFmpeg in den Einstellungen gewählt, doch die Tab zeigte weiterhin CDP**: luden mehrere Fibern das Plugin gleichzeitig, fiel die später registrierte settings bridge bei Namespace-Dubletten fälschlich auf eine leere composition config zurück, und der cast worker erhielt `captureBackend:auto`. Jetzt teilen sich dieselbe Einstellungs-Service einen einzigen Scope; Einstellungskarte, Gateway und cast-server lesen stets dieselbe persistierte Konfiguration. Ein Leerlauf-Worker, der ein Konfigurationsupdate erhält, veröffentlicht sofort den neuen Backend-Zustand, statt am alten CDP-Label festzuhalten.
- **Windows-FFmpeg filmt nicht mehr das Vordergrundfenster des Nutzers**: zuvor waren die Parameter fix — `gdigrab ... -i desktop` — mit einem nur beim Start erfolgten Zuschnitt nach Seitenkoordinaten, sodass sobald Chrome in den Hintergrund ging, DSH oder andere Anwendungen im Bereich mitgestreamt wurden. Jetzt wird das target zuerst über `Browser.getWindowForTarget` und die Win32-Enumeration der Top-Level-Fenster zum HWND aufgelöst, dann erfasst `gfxcapture` die Oberfläche des isolierten Fensters; die verschiedenen Chrome-Fenster der Task-Spaces erhalten unterschiedliche HWNDs. Eine Hintergrund-Tab im selben Fenster meldet `ffmpeg-target-not-visible`, ohne die falsche Tab zu zeigen oder aktiv den Fokus zu rauben.
- Windows-Encodierung bevorzugt den D3D11-Hardwarepfad von `h264_mf`; die Encoder-Sonde nutzt eine echte HWND-Pipeline, damit eine Software-Testbild nicht fälschlich Hardware-Encoding für unbrauchbar erklärt. Explizite `fps/setpts` fixieren 30 FPS, die fMP4-Fragmentierung sinkt auf 100 ms, und `skip_trailer` vermeidet den `mfra`-Parserfehler beim sanften Stopp.
- **Login-Zustand überlebt DSH-Neustarts (getreu der Philosophie des Original-ego-lite)**: bisher musste man sich nach manuellem Neustart / hartem Kill von DSH neu anmelden — bei SIGTERM/SIGINT detachierte der Worker nur, ohne auf Disk zu schreiben, und die 4-s-Schonfrist des `--stop` beim Plugin-Teardown reichte nicht, es endete oft im SIGTERM-Crash-Rückhalt. Jetzt sendet der Worker vor seinem Ende ein CDP `Browser.close` an den Browser (sanftes Schließen, das Cookie-Journal wird in das Disk-Profil zusammengeführt), und die Teardown-Schonfrist des Plugins steigt auf 8 s, genug für einen vollständigen sanften Abschluss. **Praktisch verifiziert**: nach sanftem Neustart bleibt der Login vollständig erhalten; auch nach hartem Kill (SIGKILL) ist der Langzeit-Login auf Disk geschrieben und beim Neustart wieder lesbar.

### Ingenieur-Refaktor
- **Migration von reinem JS → TypeScript (PR #14)**: die Quellen ziehen von `lib/` nach `src/` um (`src/index.ts` Werkzeugschicht, `src/client/index.ts` Frontend, `src/worker/ego-cast-worker.ts` Worker), `lib/` und `bin/ego-cast-worker.mjs` werden zu Build-Artefakten (vorgebaut eingecheckt). Die Build-Kette wird `pnpm typecheck` (tsc-Typbarriere, tsconfig.json + tsconfig.client.json) + `pnpm test` (vitest) + `pnpm run build` (drei tsdown-Bundles). Die Tests wandern parallel von `tests/*.test.mjs` zu `.test.ts` inklusive `vitest.config.ts`. `lib/` wird nicht mehr von Hand geändert.

## [v0.8.0] - 2026-08

Sidebar-Tab-Integration: wenn `dsh-better-sidebar` verfügbar ist, registriert sich das Live-Ansichtsfenster als nativer Sidebar-Tab statt als schwebendes Fenster.

### Neu
- **dsh-better-sidebar-Tab-Integration**: `apply()` prüft den Sidebar-Dienst opportunistisch über `ctx.get('betterSidebar')` (nicht `ctx.betterSidebar` — das verlangte eine `inject`-Deklaration, machte den Sidebar zur harten Abhängigkeit und hätte ohne ihn das gesamte Plugin samt Einstellungskarte am Laden gehindert); bei Verfügbarkeit registriert es per `registerTab()` einen `ego-browser:watch`-Tab (`single: true`, dauerhaft), sonst Rückfall auf das bisherige schwebende Fenster. Das ist das dokumentierte Muster zum Konsum optionaler Dienste in DSH (siehe approval-seam-Notiz, postmortem 0001).
- **Automatisches Öffnen der Tab beim ersten `ego_*`-Werkzeugaufruf**: die execute-Pfade von `defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` rufen `markEgoToolCall()` auf, um den hostseitigen Zähler zu erhöhen, der mit der `/api/ego/spaces`-Antwort mitgeliefert wird. `LivePreviewController` erkennt den Sprung 0 → >0 und ruft `ctx.get('betterSidebar').openTab({ type: 'ego-browser:watch' })` auf, die Tab entfaltet sich automatisch. Das `autoOpened`-Flag garantiert nur eine Öffnung je Session.
- **React-Tab-Komponente `EgoBrowserTab`**: rendert den Sidebar-Tab-Inhalt mit `React.createElement` + `bindSnapshotSelector` (Kopf / Tab-Leiste / Live-Hauptansicht / Historien-Overlay / Login- und Captcha-Hinweisbalken). Die Navigationshistorie wechselt vom seitlichen Drawer zum Overlay-Stil (der Historien-Button übernimmt den gesamten Tab-Inhaltsbereich, ein Klick auf einen Eintritt geht in die Vorschau oder zurück zum Live), angepasst an die schmale Sidebar-Breite.
- **`LivePreviewController` als vanilla-Klasse**: aus dem imperativen DOM-Code des schwebenden Fensters herausgelöst — Polling / SSE / Frame-Cache / Zoom / inverse Koordinatenzuordnung für Eingaben / Auto-Follow-Logik — damit die React-Komponente sich via `subscribe`+`getSnapshot` abonniert und pointer/wheel-Ereignisse per Methodenaufrufen weiterleitet. Der Controller hält direkt die `<img>`-Ref, um `src` in rAF-Mergerate an Ort und Stelle zu ersetzen, ohne React zu einem Neurendern pro Frame zu zwingen.
- **`dsh-better-sidebar` wird nicht als peer dependency geführt**: opportunistischer Konsum über `ctx.get()`, ohne `inject`-Deklaration, daher auch ohne Peer-Eintrag. Mit installiertem Sidebar Tab, ohne das zurück zur Schwebe — beide Deployments bleiben sauber.

### Designabwägungen (ehrlich benannt)
- **Hybrid statt Komplettumbau**: React verantwortet die UI-Struktur (Kopf / Tabs / Hinweisbalken / Historien-Overlay), der vanilla-Controller die Echtzeit-Frame-Pipeline (SSE / rAF-Merge / Koordinaten-Rückabbildung / Eingabeweiterleitung). ~1000 Zeilen fragiler Streaming-Logik wurden nicht in React-Hooks neu geschrieben, um das Regressionsrisiko zu senken.
- **Historie als Overlay**: der Seiten-Drawer des schwebenden Fensters ergab bei der schmalen Sidebar-Breite (~300-400 px) zwei sehr schmale Spalten; die Overlay-Variante nutzt den Raum am besten.
- **Race-Condition (bekannt, akzeptiert)**: lädt `dsh-better-sidebar` nach ego-browser, kann `ctx.betterSidebar` beim Lauf von `apply()` noch `undefined` sein, und es fällt auf das schwebende Fenster zurück. Der DSH-Modullader lädt meist in Abhängigkeitsordnung, und der Sidebar als Basis-UI-Plugin lädt in der Regel zuerst; andernfalls genügt ein Seiten-Refresh.
- **Der Schwebefenster-Code bleibt unverändert**: `mountFloatingWatch()` ist die mechanische Versetzung des ursprünglichen effect-Körpers ohne Logikänderung, damit das Erlebnis ohne Sidebar exakt dem von 0.7.x entspricht.

## [v0.7.1] - 2026-08

Korrekturversion: ein einzelnes `ego_space_open` öffnet keine zwei Browserfenster mehr.

### Behoben
- **`ego_space_open` öffnet keine zwei Browserfenster mehr**: bisher wurde beim Launch `"about:blank"` als Positional-Argument übergeben, was im Standard-Browser-Kontext eine residuale Tab öffnete; und `ego_space_open` geht über `useSpace+ensureRealTab`, das im eigenen Browser-Kontext eine weitere Tab öffnete — Chrome isoliert unterschiedliche Kontexte in eigene Fenster, der Nutzer sah zwei Fenster. Jetzt kommt `--no-startup-window` in `LAUNCH_FLAGS`, und `launch()` übergibt keine positionale URL mehr: der Start beginnt bei null Tabs; die erste Tab erzeugt `ego_space_open` (oder jedes strukturierte `ego_*`-Werkzeug über `useSpace+ensureRealTab`) im eigenen Kontext — das bleibt das einzige Fenster, das der Nutzer sieht. Der alte Kommentar behauptete, `--no-startup-window` breche alle `page.*`-Operationen — das war die Schlussfolgerung vor Einführung des `useSpace+ensureRealTab`-Routings und gilt für strukturierte Werkzeuge nicht mehr. **Bekannte Regression (akzeptiert)**: ruft der heredoc in `ego_cli` / `ego_script` direkt `page.*` auf, ohne vorher `taskSpaces.useOrCreate`, wirft es jetzt `"no active tab to attach session"` — die Fehlermeldung ist eindeutig, und die empfohlene Nutzung bleibt unberührt.

## [v0.7.0] - 2026-08

Kleine Version: Atemeffekt der Statuslampe des Beobachtungsfensters + Frontend-Speichergovernance + Tool-Timeout-/Multiplattform-Korrekturen.

### Neu
- **Atemeffekt der Statuslampe des Beobachtungsfensters**: der grüne Punkt am FAB-Badge leuchtet dauerhaft grün, wenn der Agent den Browser tatsächlich treibt (`busy`), und atmet im Leerlauf (Browser offen, keine Aktion) mit periodischem grünen Halo von 2,4 s; der Statuspunkt „Live-Webseitenbesuch" im Panel folgt derselben busy/Atem-Logik. Die alte Semantik „busy=gelb, idle=grün" kippt zu „grün bei Arbeit, Atmen bei Ruhe".

### Behoben
- **Der `timeoutMs`-Parameter von `ego_script` wurde ignoriert**: das im Schema deklarierte Ausführungs-Timeout pro Lauf hat nie gewirkt, alle Läufe nutzten die 15-s-Standard-Schonfrist des Plugins. Jetzt durchläuft `timeoutMs` `runEgoScript` und wirkt tatsächlich, bei Fehlen/Ungültigkeit Rückfall auf den Standard.
- **Frontend-Speichergovernance**: `frameCache` des Beobachtungsfensters (der letzte JPEG-dataURL je Tab) und `pageMeta` sammelten sich ohne Grenzen pro `targetId` — eine langsame Leckage bei langen Sessions/vielen Tabs. Jetzt werden die Caches geschlossener Tabs anhand der Tabelle lebender Tabs beschnitten, und `frameCache` erhält ein Obergrenzen-Sicherheitsnetz `MAX_CACHED_FRAMES=12` mit Priorität für die ältesten.
- **Der hartcodierte `/root`-Home-Rückfall wird zu `os.homedir()`**: in der Statuspfad-Erkundung wechselt das POSIX-Standard-Home von dem umgebungsunabhängigen `/root` zum plattformkorrekten `os.homedir()`, womit die Falle für Nicht-root-/Container-Umgebungen beseitigt ist.

### Engineering
- Neu `.gitattributes`: einheitliche LF-Zeilenenden (`* text=auto eol=lf`), womit das CRLF-Zittern im Arbeitsbaum durch `core.autocrlf` unter Windows und Fehlurteile von diff/cp entfallen.

## [v0.6.1] - 2026-04

Korrekturversion: Selbstheilungskette + Stabilität des Beobachtungsfenster-Workers, Nutzbarkeit der Onboarding-Leiste im Panel.

### Behoben
- **Die Plugin-Deinstallation blockiert nicht mehr den Host-Exit / zerstört nicht mehr die Selbstheilung**: das `ctx.effect`-Teardown wechselt von `await ego-browser --stop` (15 s Schonfrist, die den Host-Exit aufhielten) zu fire-and-forget — der Host kann von `dsh-web-guard` in 10 s sauber hochgezogen und ein unterbrochener Turn automatisch fortgeführt werden.
- **Single-Instance-Guard des Beobachtungsfenster-Workers + Bereinigung veralteter Zustände**: dieselbe `ego-cast-worker.mjs` konnte gleichzeitig aus dem Installationsverzeichnis und einem dev-Klon gestartet werden, und `ensureWorker` startete bei bekannter toter pid einen weiteren — `ego-cast.json` zeigte damit dauerhaft auf einen toten/hinterherhinkenden Worker, und das Panel verlor den Stream. Jetzt enumeriert und stoppt der Worker beim Start andere gleichnamige Prozesse (unter Windows via `powershell -EncodedCommand`, unter POSIX via `ps`), löscht das veraltete `ego-cast.json` und macht sein `{port,pid}` zur einzigen Autorität.
- **Login-/Captcha-Onboarding-Leisten manuell schließbar**: ein ×-Button kommt dazu; beide Leisten zeigen sich gegenseitig exklusiv (Captcha vorrangig), kein „nicht schließbar" mehr und keine „Doppelleiste, die das Bild zusammenquetscht".
- **Das Beobachtungsfenster folgt aktiv der Seite, an der der Agent arbeitet**: bisher nahm das Panel die „letzte Neumalung" (lastActive) als aktuelle Seite, Neuzeichnungen von Hintergrund-Animations-/Videoseiten stahlen die Ansicht, und die Hauptansicht sprang nicht, wenn der Agent die Seite wechselte. Jetzt ermittelt der worker über DevTools `/json/list` die MRU-aktive Tab des Browsers (gleiches Urteil wie `tabs.mjs` der ego-Runtime), markiert sie in `/api/spaces` wie im SSE mit `active: true` und setzt sie an den Anfang; das Frontend-Auto-Follow folgt nur der aktiven Seite und ignoriert die Frames von Hintergrund-Neuzeichnungen.

## [v0.6.0] - 2026-04

Code-Gesundheitspflege (Engineering-Konvergenz).

- Beseitigung der Build-Überschreibungsbombe: das veraltete `src/` (561 Zeilen Altfassung) und `tsconfig.json` werden entfernt, **`lib/` als einzige Autoritätsquelle** etabliert. `npm run build` wechselt von „tsc-Kompilierung src→lib (die Altfassung überschrieb, alle Werkzeuge gingen verloren)" zu „Syntaxprüfung von `lib/` (`node --check`)".
- Vereinheitlichte Werkzeugregistrierung: `ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` wechseln auf den `withEgoLock` + Kaltstart-Wiederholungsweg der übrigen Werkzeuge (Konkurrenzsicherheit).
- Ende der Gabelung: die neuen Fähigkeiten (Download-Erfassung, Captcha-Erkennung, 30+ Werkzeuge) sind maßgeblich mit `lib/`.

## [v0.5.0] - 2026-04

Live-Streaming + direkte Browserbedienung aus dem Überwachungsfenster.

- Behebung des kritischen Live-Streaming-Bugs: `screencastFrame` las das falsche Feld, Live-Frames gingen nie wirklich über den SSE. Behoben — dynamische Seiten erreichen nahe 10~30 fps.
- Die Streaming-Weiterleitung von cast-server wechselt zu `node:http` (das Puffern chunked Antworten durch fetch verzögerte den ersten Frame).
- Die Maus des Überwachungsfensters bedient den Agent-Browser direkt: Mausrad-Scroll, Klick/Drag auf den echten Browser (`/api/ego/input` → CDP `Input.dispatchMouseEvent`), Ctrl+Mausrad-Zoom, Ctrl+Drag-Verschieben, Doppelklick-Reset, Koordinaten invers auf den echten Viewport gemappt inklusive Letterbox-Korrektur.
- Neu `/api/ego/stream` (SSE): Echtzeit-Frames + Seitenliste.
- Login-Onboarding-Leiste + „Angemeldet, speichern" (löst `/api/ego/flush` aus, um auf Disk zu schreiben); Behobung des Windows-Statusverzeichnispfads von `ego_auth_flush`.

## [v0.4.0] - 2026-04

Multiplattform (Windows-Adaption umgesetzt).

- Windows-native Unterstützung: `IS_WIN` + `windowsChromeCandidates()` erkennen die Installationsverzeichnisse von Chrome/Edge/Brave sowie `PATH`/`%PATHEXT%` automatisch.
- Der injizierte Dienst wechselt auf die Wahlmöglichkeit `webServer`/`httpServer`, das Beobachtungsfenster lässt sich auch unter Windows montieren.
- Statuspfade multiplattform: Windows `%LOCALAPPDATA%\ego-lite-linux`, POSIX `$XDG_STATE_HOME/ego-lite-linux`.

## [v0.3.0] - 2026-04

Korrekturen und Verbesserungen.

- Automatische Kaltstart-Wiederholung: jede `ego_*`-Aktion startet einen neuen `ego-browser`-Unterprozess, und die Session-Warmup-Phase warf gelegentlich `CDP channel is not open` / DevTools-Timeout. Bis zu 3 Wiederholungen mit abgestuftem Backoff eingebaut, nur für transiente Kaltstartfehler; echte Fehler gehen sofort durch.

## [v0.2.0] - 2026-04

Highlight: das Echtzeit-Beobachtungs-Frontend.

- `lib/client.js`: dunkle Milchglas-UI, permanente 🌐-Kugel unten rechts, ein Klick zeigt das Livebild des Agenten.
- Tab-Verwaltung: horizontale Tab-Leiste + `×` je Tab zum Schließen (schließt den echten Browser-Tab).
- Zoom/Drag/Reset, dynamisches Polling (aktiv 2 s / ruhend 8 s), Navigation mit Tab-Wiederverwendung.
- `bin/ego-cast-worker.mjs`: hängt sich an den vom Agenten genutzten Browser, schiebt Frames in Echtzeit über CDP, automatischer Neustart nach Crash.
- Sofort einsatzbereit: `bin/ego-chrome-wrapper.sh` im Paket enthalten, automatisches `--no-sandbox` unter root/headless.
