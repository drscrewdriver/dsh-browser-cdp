# dsh-browser-cdp — Der sichtbare Agent-Browser (CDP-Anbindung)

[简体中文](README.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Italiano](README.it.md) | [Русский](README.ru.md) | [Español](README.es.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue" alt="DSH >= 0.2.0-rc.1">
  <img src="https://img.shields.io/badge/DSH--better--sidebar-%3E%3D0.12.2(optional)-red" alt="dsh-better-sidebar >= 0.12.2 (optional)">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?logo=node.js&logoColor=white" alt="Node >= 22">
</p>

> **Repository**: `github.com/drscrewdriver/dsh-browser-cdp` (zuvor `dsh-ego-browser`, hervorgegangen aus dem Upstream-Projekt [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)) ｜ Versionshistorie: siehe [CHANGELOG.md](CHANGELOG.md)

### Versions-Kompatibilitätsmatrix

| Abhängigkeit | Mindestversion | Empfohlene Version | Hinweise |
|---|---|---|---|
| **DSH** (DeepSeek Harness) | `0.2.0-rc.1` | `≥ 0.2.0-rc.1 <0.2.1-0` | 0.2.0-Linie: Peer-Dependencies synchron auf `>=0.2.0-rc.1 <0.2.1-0` angehoben; der Host ist abwärtskompatibel zur Plugin-API (composer/`forkSession` in 0.2.0 ist eine Signatur-Erweiterung, das Plugin ist nur Aufrufer, keine Anpassung nötig). Die deklarative Einstellungsfläche wurde mit 0.1.7 eingeführt (Config-Felder `.volatile()` erzeugen das Einstellungsformular automatisch) und setzt sich in 0.2.0 fort. Für DSH `0.1.2-rc.1` ~ `0.1.7` bitte die Release-Linie **0.17.x** verwenden, für 0.1.0-rc.x / 0.1.1-rc.x bitte v0.8.0 oder früher |
| **dsh-better-sidebar** | `0.12.2` (optional) | `≥ 0.17.1` | Ohne Installation automatischer Rückfall auf die schwebende Beobachtungskugel; `< 0.12.2` läuft, aber die Blockierung externer Links (`urlTarget`) degradiert still |
| **Node.js** | `22` | — | Wird mit der Harness-Umgebung mitgeliefert |

**Hinweise zur Anpassung an alle DSH-Versionen**: Diese Version (**ab v0.18.0, Linie 0.2.0**) zielt auf DSH `0.2.0-rc.1+`: gegenüber der 0.1.7-Linie (v0.17.x) **null Codeänderungen**, reiner Abhängigkeits-/Metadaten-Wechsel — der 0.2.0-Host ist abwärtskompatibel zur Plugin-API, und dieses Plugin übergibt Markierungen über die Fassade `ctx.get('conversation').input` (ohne `submit()` aufzurufen, ohne Override), liegt also außerhalb des Wirkbereichs der 0.2.0-Änderungen. Die deklarative Einstellungsfläche, eingeführt mit 0.1.7: Das Plugin registriert keine Einstellungsabschnitte mehr (die Registrierungs-API `ctx.settings` wurde vom Host entfernt); stattdessen werden konfigurierbare Felder im Config-Schema mit `.volatile()` markiert und die Host-Einstellungsseite erzeugt das Formular automatisch; Änderungen an volatile-Feldern werden über das Ereignis `loader/volatile-update` live wirksam, ohne das Plugin neu zu laden. Die zentralen Host-APIs (`defineTool`, `ctx.tools.register`, `ctx.subprocess.spawn`, `ctx.webServer.register`, `ctx.inject`, die CJS-Factory `ModuleLoader`, `cordis.patch.yml`) behalten ihre Form seit 0.1.2. Für DSH `0.1.2-rc.1` ~ `0.1.7` bitte die Release-Linie **0.17.x** verwenden.

**Hinweise zur Anpassung an dsh-better-sidebar**: Dieses Plugin registriert über den Dienst `ctx.betterSidebar` (defensiv im try-catch bezogen) einen Sidebar-Tab und lauscht auf externe Links. Einführungsversionen der wichtigsten APIs:

| API | Verwendung in diesem Plugin | Eingeführt in better-sidebar |
|---|---|---|
| `registerTab()` / `openTab()` / `ctx.betterSidebar` | Tab-Registrierung + Öffnen | v0.9.0+ |
| `TabDescriptor.single` | Single-Instance-Tab | v0.9.0+ |
| `TabDescriptor.urlTarget` | Blockierung externer Links | **v0.12.2+** (darunter schlägt die Link-Blockierung still fehl) |

---

**Details zur DSH-Versionsunterstützung**: Wesentliche Änderungen v0.8.2 → v0.8.3: Zusammenführung von 6 Community-PRs (root/xvfb/macOS-headless-Anpassung, rc.1-Kompatibilität, Windows-Stabilität), Behebung der Sicherheitslücke unauthentifizierter `/api/bcdp/*`-Routen, des Client-Startfehlers auf Hosts ohne dsh-better-sidebar (#29), der Windows-Kaltstart-Regression (falsche Xvfb-Erkennung aus #22) sowie Ergänzung von `runtimeArgs`/`chromeArgs` in der Einstellungs-Whitelist des Gateways. Anpassungspunkte: Umbenennung der Client-Runtime (`@deepseek-ai/dsh-client-store`), Client-Modulregistrierungs-ID und Ladezeilenname nach dem deklarierten Paketnamen, `dsh.client.inject` deklariert nur echte Modulgraph-Zeilen, `webServer` wird per verschachtelter Injektion geliefert (optionaler Dienst), und Abgleich mit dem Sidebar-Tab-Modus (dsh-better-sidebar).

**Sidebar-Unterstützung ([dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar))**: Wenn der Host `dsh-better-sidebar` installiert hat (empfohlen ≥ v0.12.2), registriert sich das Live-Beobachtungsfenster als **nativer Sidebar-Tab** — „Agent-Browser" erscheint im „+"-Menü der Sidebar, öffnet sich per Klick und wird zusammen mit dem Sidebar-Drawer verankert; beim ersten Aufruf eines `bcdp_*`-Werkzeugs durch den Agenten öffnet sich der Tab automatisch (ab v0.8.5 sitzungsgenau geöffnet — in Multi-Session-Umgebungen poppt nichts mehr an der falschen Stelle auf). Ohne `dsh-better-sidebar` wird automatisch auf die **schwebende Beobachtungskugel** unten rechts (`#dsh-ego-fab`) zurückgegriffen. Beide Formen teilen dieselben Fähigkeiten: SSE-Livestream / Klick / Eingabe / Download-Erfassung. Das Beobachtungsfenster bietet zudem einen Button „Fenster lösen": der im Headless-Modus laufende Agent-Browser lässt sich mit einem Klick durch ein gleichnamiges Profile mit Fenster (Tabs bleiben erhalten) ersetzen — praktisch zur manuellen Übernahme.

**Import von Login-Zuständen (neu in v0.8.5)**: Das Werkzeug `bcdp_login_import` kopiert die Login-Cookies aus Ihrem alltäglichen Chrome/Edge/Brave **domänenweise** in den Agent-Browser (echte Binary im Headless-Start + CDP-Durchreichung beim Lesen, kompatibel mit der App-Bound Encryption von Chrome 127+, keine Offline-Entschlüsselung; läuft der Quell-Browser, kann er vor dem Import sauber heruntergefahren werden — das Fenster stellt sich beim nächsten Start wieder her). Cookie-Werte erscheinen in keinem Log und keiner Ausgabe; vor dem Import wird die Cookie-Datenbank der Quelle automatisch gesichert und bei anomaler Leerung wiederhergestellt. In Kombination mit dem standardmäßigen persistenten Profile auf Disk übersteht der importierte Login-Zustang Neustarts dauerhaft.

Ein **CDP-Browser-Proxy**: Er bindet [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite) (ein Chromium für KI-Agenten) als eingebaute Laufzeit in den DeepSeek Harness ein, steuert den Browser mit **38 strukturierten `bcdp_*`-Werkzeugen** und bringt ein **Echtzeit-Beobachtungs-Frontend** mit — während der Agent im Hintergrund Webseiten bedient, sehen Sie jede Seite wie in einem Livestream und können sogar direkt eingreifen.

**Eine eigene Besonderheit (self-observation)**: Der Agent nutzt genau dieses Chromium — selbst wenn er **DSH selbst** bedient (Sitzungen verwalten, Task-Board, Einstellungen), zeigt das Beobachtungsfenster alles live an und Sie können jederzeit übernehmen. Nicht nur „sehen, wie der Agent im Web arbeitet" — auch die Bedienung der DSH-Oberfläche durch den Agenten ist durchgehend sichtbar und kontrollierbar.

**Sofort einsatzbereit**: Das Plugin-Paket bringt die ego-Runtime mit (`runtime/`, MIT, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — kein Klonen des offiziellen Repositorys, kein manuelles Bauen; der `--no-sandbox`-Wrapper liegt dem Paket bei, root / Docker / ohne Monitor laufen auf Knopfdruck.

---

## Unsere wahren Stärken (keine Schlagworte, sondern am Code und gegenüber Konkurrenz überprüfbare Fähigkeiten)

Andere Plugins, die ego-lite in DSH einbinden, machen daraus nur **3 Werkzeuge** — ein `run`-Skript, ein `help`-Leitfaden, ein `status`-Check — und der Browser bleibt eine **Blackbox im Hintergrund**. Dieses Plugin geht den anderen Weg: **die Blackbox öffnen und von Anfang an „Sehen" und „Steuern" voll ausbauen**.

| Fähigkeit | Dieses Plugin (dieses Repository) | Vergleichbares Plugin (Da1dr1em/dsh-ego-browser) |
|---|---|---|
| Anzahl strukturierter Werkzeuge | **38**, jeweils mit klarer Verantwortung, deterministisch aufrufbar | **3** (`run`/`help`/`status`) |
| Live-Beobachtungsfenster (Dual-Backend CDP JPEG / FFmpeg H.264 + Tab-Leiste + Verlauf-Drawer) | ✅ Ja | ❌ Nein |
| **Direkte** Mausbedienung des echten Browsers im Beobachtungsfenster (Klick/Ziehen/Scrollen zurück an CDP) | ✅ Ja | ❌ Nein |
| **Element im Beobachtungsfenster auswählen → erfassen und in die Konversationseingabe referenzieren** (strukturierter `[CDP-PICKS]`-Block, manuelle Zielangabe) | ✅ Ja | ❌ Nein |
| Single-Instance-Guard für den Worker + Selbstheilung nach Crash/Doppelstart | ✅ Ja | ❌ Nein |
| Download-Erfassung `bcdp_download` / Captcha-Erkennung `bcdp_captcha`/`bcdp_page_info` | ✅ Ja | ❌ Nein |
| Plattformadaption (automatische Erkennung Linux/macOS/Windows + root/headless/`--no-sandbox`-Fallbacks) | ✅ Alle Plattformen | Nur Windows-Preview-Host, manuelle Konfiguration nötig |
| Persistenz des Login-Zustands auf Disk `bcdp_auth_flush` | ✅ Ja | ⚠️ Nur auf Dokumentationsebene erwähnt |

**Drei zentrale Unterschiede:**
- **Sehen**: Andere sind eine Blackbox, die „am Ende das Ergebnis berichtet"; wir streamen live — Sie **sehen dem Agenten bei der Arbeit zu** und bemerken sofort, wenn er an einem Captcha hängt oder falsch abbiegt.
- **Steuern**: Andere nur lesend; unser Beobachtungsfenster **treibt denselben Agent-Browser direkt an** — bei Bedarf übernehmen Sie selbst (Zoom/Ziehen/Klick), ohne den Agenten zu unterbrechen und neu anzusetzen.
- **Präzise bezeichnen**: Sie **klicken** ein Seitenelement im Beobachtungsfenster an; das Plugin erfasst dessen `backendNodeId`/`tag`/`id` und semantische Beschreibung und fügt es als strukturierten `[CDP-PICKS]`-Block in den Entwurf des Konversationseingabefelds ein (mehrere Auswahlen auf derselben Seite werden automatisch zusammengeführt und nummeriert) — der Agent erhält ein exaktes Ziel, ohne raten zu müssen, „welcher Button gemeint ist".

> Der obige Vergleich beruht auf öffentlich überprüfbaren Fakten: dem Code dieses Repositorys (`bin/cdp-cast-worker.mjs` Live-Streaming + CDP-Eingaberückführung, `lib/index.js` mit 38 registrierten Werkzeugen, `lib/cast-server.js` Host-Brücke, `deliverPickToConversation` in `lib/client.js` für die Auswahl-Referenz) sowie dem Quellcode/README des anderen Plugins (dessen `src/tools.ts` nur `ego_browser_run` / `ego_browser_help` / `ego_browser_status` registriert). Dieses Dokument enthält keine Abwertung anderer — wir stellen nur fest, welche Fähigkeiten wir zusätzlich implementiert und verifiziert haben.

**Gegenüber [ego-lite](https://github.com/CitroLabs/ego-lite) selbst leisten wir all dieses Mehr (alles am Code dieses Repositorys überprüfbar):**

| Fähigkeit | Beschreibung (zugehöriger Code) |
|---|---|
| **Beobachtungs-Frontend** | ego-lite selbst ist ein headless-CLI (nur heredoc-Skripte + Textausgabe); wir haben **SSE-Livestreaming + Tab-Leiste + Verlauf-Drawer + direkte Mausbedienung im Beobachtungsfenster + Auswahl-Referenz in die Eingabe** ergänzt (`bin/cdp-cast-worker.mjs`, `lib/cast-server.js`, `createPickControl`/`deliverPickToConversation` in `lib/client.js`) — „Sehen", „Steuern" und „Bezeichnen" werden erstklassige Fähigkeiten |
| **Sofort einsatzbereit + plattformübergreifend autark** | `resolveEgoEnv` erkennt Chrome/Edge/Brave automatisch, eingebauter `--no-sandbox`-Wrapper, null Konfiguration unter root / Docker / ohne Monitor (`lib/index.js`); kein GUI-Host nötig, wie es die offizielle Variante verlangt |
| **Robustheitsschicht** | Automatische Kaltstart-Retries (nur transiente CDP-Fehler, echte Fehler werden nicht verschluckt), Single-Instance-Guard für den Worker + automatischer Neustart nach Crash, Plugin-Teardown als fire-and-forget ohne Blockieren des Host-Exits, Obergrenze für den Frontend-Frame-Cache (`withWarmupRetry` / `makeEnsureWorker` / `frameCache`) |
| **Betriebswerkzeuge** | `bcdp_doctor` (Umgebungsdiagnose), `bcdp_captcha` (Captcha-Erkennung), `bcdp_auth_flush` (Login-Persistenz), `bcdp_login_import` (Login-Import aus Systembrowsern), `bcdp_http` (Anfragen im Browser-Kontext) usw. — eine Schicht, die native CLI-Helper nicht bieten |
| **self-observation** | Auch wenn der Agent die DSH-Oberfläche selbst bedient, alles live sichtbar und übernehmbar |

> Wir behaupten nicht, mit kernelnahen Snapshots oder dem nativen Multi-Window-Erlebnis der offiziellen macOS-App gleichzuziehen; dieses Repository löst: „dieselben Browser-Fähigkeiten in DSH + Linux/WSL bringen — sichtbar".

---

## Welches Problem es löst

Universelle Browser sind nicht für Agenten gebaut, doch ein Großteil der Web-Interaktionen (Login-Zustände, Captchas, dynamisches Rendering, Formulare, Sites mit echten Benutzersitzungen) lässt sich nur mit einem echten Browser bewältigen — genau daher stammt das Erbe der ego-Familie aus dem Upstream: **„Der Agent nutzt Ihren bereits angemeldeten Browser, ohne Sie zu stören"** ([offizielle Seite](https://github.com/CitroLabs/ego-lite)).

Dieses Plugin bindet ihn in DSH ein und löst den schmerzhaftesten Punkt — **Sie sehen nicht, was der Agent tut, und können nicht eingreifen** — mit einem Beobachtungsfenster:

> 🌐 Ein Klick auf die kleine Kugel öffnet den Livestream; 🟦 Tab-Leiste zum Wechseln/Schließen; 🕘 Verlauf-Drawer zum Zurückspulen; 🔍 Zoom und Verschieben; 🖱️ direkte Übernahme des echten Browsers im Fenster. **In einem Satz: Der Agent arbeitet im Browser — Sie sehen alles und können jederzeit übernehmen.**

### Ein paar typische Einstiegsszenarien

- **Recherche / Datensammlung**: Lassen Sie den Agenten sich bei CNKI / Google Scholar anmelden und seitenweise sammeln; im Beobachtungsfenster sehen Sie ihn scrollen, „nächste Seite" klicken, PDFs herunterladen — wenn er hängen bleibt, merken Sie es sofort.
- **Formulare und Logins**: Der Agent füllt ein Formular halb aus, im Beobachtungsfenster erscheint ein Captcha — Sie übernehmen, lösen das Captcha und geben die Kontrolle an den Agenten zurück.
- **QA / Smoke-Tests**: Lassen Sie den Agenten Ihr eigenes Produkt durchklicken; das Beobachtungsfenster wird zum „sprechenden Screencast", inklusive Verlaufs-Replay.
- **Dem Agenten bei der Bedienung von DSH selbst zusehen** (self-observation): Verwaltet der Agent Sitzungen / passt Einstellungen an, ist alles im Beobachtungsfenster sichtbar und übernehmbar.

---

---

## Voraussetzungen

| Anforderung | Hinweise |
|---|---|
| Node ≥ 22 | Wird mit der Harness-Umgebung mitgeliefert |
| **Beliebiges Chrome / Chromium / Brave / Edge** | Automatische Auffindung oder Angabe via `EGO_LINUX_CHROME`; unter root mit dem mitgelieferten Wrapper |
| DSH + dshx | Plugin-Lademechanismus |
| DSH Web mit grafischer Oberfläche (für das Beobachtungsfenster) | Headless-Sitzungen können die `bcdp_*`-Werkzeuge weiterhin nutzen, nur eben ohne Beobachtungsfenster |

## Installation

**Methode 1: Direktinstallation aus GitHub (empfohlen)**

```sh
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp
# Alternativ auf einen bestimmten Commit / Tag festlegen:
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp#v0.9.0
```

> Die `github:`-Installation lädt das Repository-Tarball über pnpm via `codeload.github.com` — **keine Veröffentlichung auf der npm-Registry nötig**; sie verwendet direkt das **vorgebaut eingecheckte `lib/`** des Repositorys (`files` enthält nur `lib/`, `bin/`, `runtime/`, `cordis.patch.yml`, `dsh-plugin.json`), daher werden **keine Build-Skripte ausgelöst** und devDependencies sind nicht erforderlich. Host-Einstieg `lib/index.js`, Client `lib/client.js` und Worker `bin/cdp-cast-worker.mjs` werden alle mit dem Repository ausgeliefert.

**Methode 2: lokaler Tarball / git-URL**

```sh
dshx install dsh-browser-cdp <dsh-browser-cdp.tgz>      # Tarball oder git-URL, beides möglich
dshx list                                                # sollte anzeigen: [on] dsh-browser-cdp
```

> **Hinweis zur Paketumbenennung**: Der Paketname dieses Plugins ist **`dsh-browser-cdp`** (früher `dsh-ego-browser`, Alias `@dsh-external/ego-browser`). Ab DSH Desktop 2.0.5 gibt es eine Konsistenzprüfung „Profile-Abhängigkeitsname == tatsächlicher Paketname"; referenziert das Profil noch den alten Namen, startet es in den Wiederherstellungsmodus. Nach dem Upgrade bitte **sowohl** den Abhängigkeitsschlüssel in der `package.json` des Profils **als auch** den Eintrag in `dsh.profile.bundles` auf `dsh-browser-cdp` ändern:

   ```diff
   - "dsh-ego-browser": "github:Fisfzy/ego-browser",
   + "dsh-browser-cdp": "github:drscrewdriver/dsh-browser-cdp",
   ```

   ```diff
   - "dsh-ego-browser",
   + "dsh-browser-cdp",
   ```

In den Einstellungen des Beobachtungsfensters wählbar: `captureBackend=auto|cdp|ffmpeg` (Standard `auto`, derzeit als CDP aufgelöst), Qualitätsstufen, CDP FPS/JPEG-Qualität/maximale Breite sowie FFmpeg FPS/maximale Breite/Bitrate/Encoder/benutzerdefinierter Pfad. Das Plugin prüft zuerst den benutzerdefinierten Pfad, den System-PATH und den verwalteten Cache; GitHub-Downloads lassen sich über `githubMirror` statt `https://github.com` beziehen, z. B. `https://gh-proxy.com/github.com`. Die FFmpeg-Bitrate reicht von 500 bis 20000 kbps, Standard 2000/4000/8000 kbps für niedrig/ausgewogen/hoch.

Keinerlei Host-seitige Konfiguration nötig: `resolveEgoEnv` erkennt root / fehlenden Monitor automatisch und greift auf Fallbacks zurück. Die Host-Routen des Beobachtungsfensters (`/api/bcdp/spaces` usw.) werden nur registriert, wenn ein HTTP-Server existiert; headless sind sie ein sicherer No-op.

## Verbindungsmodi: CDP-Endpunkt / lokales ego-CLI

Die Verbindungsliste im Einstellungspanel ist **geordnet** — **die Reihenfolge ist die Priorität**, und der aktivierte Eintrag steuert jeden `bcdp_*`-Aufruf. Es gibt zwei Eintragstypen:

| Typ | Was er tut | Einschränkung |
|---|---|---|
| **CDP-Endpunkt** | Übergibt die Adresse eines Browsers mit bereits offenem Debug-Port an die eingebaute Runtime (Injektion von `EGO_LINUX_CDP_URL`), die sich **anhängt** | Mehrere Einträge möglich |
| **Lokales ego-CLI** | Das lokale ego-CLI treibt **selbst** seinen lokalen ego-lite-Browser — **kein Endpunkt wird injiziert** | **Nur lokal, global höchstens einer** |

**Warum der zweite Typ existiert**: Das injizierte `EGO_LINUX_CDP_URL` ist ein privater Vertrag des **eingebauten Linux-Portierungsbuilds**; das native `ego-browser` der App `ego lite` unter macOS **liest es schlicht nicht**. Gäbe es nur den Typ „CDP-Endpunkt", könnten macOS-Nutzer ihren bereits angemeldeten ego-lite nicht nutzen — sie müssten sich auf einen entfernten Port verbinden oder vom Portierungsbuild einen Standard-Chromium starten lassen. Der Typ „lokales CLI" schließt genau diese Lücke.

Auflösungsreihenfolge (wenn `cliPath` leer ist): expliziter Pfad → `ego-browser` im PATH → Helper im macOS-App-Bundle (`/Applications/ego lite.app/…/Helpers/ego-browser`) → eingebaute Plugin-Runtime.

Zwei Standardwerte, die man kennen sollte:

- **`--sdk-path` ist standardmäßig aus**: Standardmäßig wird das mit dem CLI mitgelieferte Harness verwendet (das offiziell gepaarte); erst bei Aktivierung wird das Harness-Paket dieses Plugins injiziert. Erkennt das CLI dieses Flag nicht, vermerkt das Plugin einen Hinweis und **wiederholt den Versuch automatisch einmal ohne es** — die ganze Kette wird dadurch nicht unbrauchbar.
- **Die Bereitschaftsprüfung läuft einmal durch einen echten heredoc** (derselbe Kanal wie bei der eigentlichen Arbeit), sie ist also **nicht gratis**: Die Prüfung kann einen Kaltstart des Backend-Browsers auslösen (beim eingebauten Portierungsbau gemessen ca. 1,3 s).

Beziehungen zu anderen Schaltern:

- `cdpMode`: `auto` folgt dem aktivierten Eintrag (beide Typen zulässig); `remote` **akzeptiert nur CDP-Endpunkte** und meldet bei aktiviertem lokalem CLI explizit `mode-kind-mismatch`; `local` nutzt den verwalteten lokalen Launcher.
- `remoteEnabled` (Hauptschalter für Remote) **regelt nur entferntes CDP** und beeinflusst lokale CLI-Verbindungen nicht.
- `allowLocalFallback` / `localHeadless` / `localUserDataDir` wirken nur auf den Fallback von CDP-Endpunkten und verwaltete Starts.

`bcdp_doctor` meldet die Zählung der Typen in der aktuellen Sequenz, den tatsächlich aufgelösten CLI-Pfad samt Form sowie (falls das Upstream-Plugin `dsh-ego-browser` auf derselben Maschine installiert ist) einen Koexistenz-Hinweis.

## Werkzeugliste (38, Präfix `bcdp_`, vollständiger Index via `bcdp_help`)

| Kategorie | Werkzeuge |
|---|---|
| Task-Spaces | `bcdp_space_open` `bcdp_space_close` `bcdp_status` |
| Seitenlesen | `bcdp_snapshot` (semantischer Baum) `bcdp_page_info` `bcdp_read_element` |
| Navigation/Warten | `bcdp_navigate` (Tab-Wiederverwendung) `bcdp_wait` `bcdp_wait_for_selector` `bcdp_wait_for_url` `bcdp_wait_for_response` |
| Interaktion | `bcdp_click` `bcdp_fill` `bcdp_hover` `bcdp_drag` `bcdp_select` `bcdp_check` `bcdp_key` `bcdp_scroll` |
| Ausführung/Debugging | `bcdp_js` (Seitenauswertung) `bcdp_cdp` (rohes CDP) `bcdp_cli` (beliebiger heredoc) `bcdp_script` (Mehrstufen-Skript) |
| Ausgaben | `bcdp_screenshot` `bcdp_download` `bcdp_upload` |
| Sitzung/Sicherheit | `bcdp_auth_flush` (Login-Persistenz) `bcdp_login_import` (browserübergreifender Login-Import) `bcdp_captcha` `bcdp_dialog` |
| Meta-Werkzeuge | `bcdp_help` `bcdp_doctor` `bcdp_http` |
| Review (JEV/Laya, optionaler externer Bewertungs­dienst) | `bcdp_jev_status` `bcdp_jev_frame` `bcdp_jev_ask` `bcdp_jev_run` `bcdp_jev_attempt` |

## Das Beobachtungsfenster benutzen

Die **🌐 Dauer-Kugel** unten rechts → anklicken zum Öffnen:

- **Hauptansicht**: Livebild der aktuellen Agent-Seite; Klick/Ziehen/Mausrad bedienen die Seite direkt, Ctrl+Mausrad zoomt, Ctrl+Ziehen verschiebt, Doppelklick setzt zurück. Nach einem Klick in die Ansicht ist direkte Tastatureingabe möglich: chinesisches IME, Einfügen, Tab/Enter/Pfeiltasten sowie Ctrl/Cmd-Kürzel werden unterstützt.
- **Element auswählen** (Auswahl-Referenz): Über den Button in der Werkzeugleiste in den Auswahlmodus wechseln, dann auf ein beliebiges Element im Livebild klicken — das Plugin erfasst dessen `backendNodeId`/`tag`/`id` und semantische Beschreibung und fügt es als strukturierten `[CDP-PICKS]`-Block in den Entwurf des Konversationseingabefelds ein; mehrere Auswahlen auf derselben Seite werden automatisch in denselben Block zusammengeführt und fortlaufend nummeriert, der Agent greift per Nummer exakt darauf zu. Funktioniert sowohl mit der schwebenden Kugel als auch mit dem Sidebar-Tab.
- **Tab-Leiste**: horizontale Reihe oben, Klick zum Wechseln, `×` zum Schließen.
- **Verlauf-Drawer** (🕘): die Besuchschronik zeitlich zurückverfolgen.
- Während von Aktionen zeigt die URL-Zeile unten Hinweise direkt an, nach 2 Sekunden stellt sie sich wieder her.
- Nach dem Schließen des Panels, dem Verstecken des Sidebar-Tabs oder dem Unmounten der Komponente endet die Bilderzeugung nach Ablauf der 1,5-Sekunden-Schonfrist. Allein das In-den-Hintergrund-Bringen des DSH-Fensters stoppt das Streaming nicht, um beim Rückkehr in den Vordergrund kein wiederholtes Neuaufbauen von WGC/FFmpeg zu riskieren; eine anomale Schließung sichert der 120-Sekunden-Worker-Lease-Timeout ab.

### Bild-Backends

- `cdp`: JPEG über `Page.startScreencast`, standardmäßig 20 FPS. Jeder Quellframe wird sofort über die von Chrome gelieferte Frame-ID bestätigt (ACK), nur der neueste ausstehende Frame wird vorgehalten; nur der gerade betrachtete Tab wird erfasst, statische Seiten greifen standardmäßig alle 3 Sekunden auf eine Aufnahme zurück.
- `ffmpeg`: Unter Windows erfasst `gfxcapture(hwnd)` direkt die D3D11-Oberfläche des Ziel-Chrome-Fensters; andere Plattformen nutzen einen Ausschnitt der Anzeigequelle. Anschließend Encodierung als H.264 fragmented MP4 → binäre HTTP-Chunks → MediaSource `<video>`, ohne Base64/SSE.
- `auto`: Standard ist CDP; schlägt die Erkennung fehl, wird FFmpeg nicht automatisch nachgeladen. FFmpeg ist erst wählbar, wenn es installiert und im Fähigkeitstest bestanden ist; ist ein gespeichertes FFmpeg-Backend später ungültig, fällt die laufende Beobachtung auf CDP zurück und zeigt den Grund an.
- Unter Windows muss FFmpeg `gfxcapture` enthalten. Das Plugin ordnet das HWND über Browser-PID, Target-Titel und CDP-Fenstergrenzen zu; wird das Fenster verschoben oder verdeckt, wird die Zielseite weiterhin erfasst, und ein Rückfall auf Desktop-Aufzeichnung ist untersagt. Ist das Target ein Hintergrund-Tab desselben Chrome-Fensters, folgt eine klare Fehlermeldung, statt den sichtbaren Tab anzuzeigen oder den Fokus zu stehlen. Unter macOS ist beim ersten Einsatz die Berechtigung „Bildschirmaufnahme" nötig; unter X11 müssen Chromium und FFmpeg sich ein `DISPLAY` teilen; unter Wayland erscheint bei fehlender Portal/PipeWire-Eingabe ein Hinweis, auf CDP zurückzuwechseln.

Die verwaltete FFmpeg-Installation landet in `~/.dsh/cache/ego-browser/ffmpeg/`, es wird nichts ins Plugin-Verzeichnis geschrieben. Windows/Linux verwenden einen festen BtbN-Release-Tag; macOS feste `ffmpeg-static`-GitHub-Release-Assets (dessen Intel-/Apple-Silicon-Binaries stammen von Evermeet bzw. OSXExperts). Alle Downloads fixieren den SHA-256 der Ressource; nur das FFmpeg-Hauptprogramm wird extrahiert, kein `ffprobe` oder `ffplay` installiert. Unter Windows/Linux entpackt das System-`tar`; fehlt es, folgt vor dem Download eine klare Fehlermeldung.

> Hinweis zum Login-Zustand: Die Cookies der Task-Spaces sind gegeneinander isoliert — bitte im jeweiligen Space anmelden. Nach einem DSH-Neustart ist der Laufzeit-Login verworfen (Laufzeit-Cookies von Chrome werden nur beim sauberen Herunterfahren auf Disk geschrieben), erneutes Anmelden nötig — der QR-Code-Scan geht schnell.

## Funktionsweise

- **Werkzeugschicht**: Jedes Werkzeug setzt seine Parameter zu einem JS-Skript zusammen, das über `ctx.subprocess` per stdin an `ego-browser nodejs` gefüttert wird; der Host treibt das gemeinsame Chromium per CDP. Ergebnisse werden anhand der Sentinel-Zeile `@@DSH_RESULT@@` geparst. Alle `bcdp_*` werden über einen In-Prozess-Mutex serialisiert, Fehler einheitlich normalisiert.
- **Beobachtungsfenster**: `lib/client.js` verwaltet die Watcher-Lease, das JPEG-`<img>` und das MSE-`<video>`; `lib/cast-server.js` leitet Metadaten-SSE, Watch-API und binäres Video mit Backpressure weiter; im Worker stellt `CaptureManager` sicher, dass nur ein Backend aktiv und ein Target aktuell ist. Die CDP-Steuerungsebene (Tabs, Viewport, Eingaben, Captcha) ist unabhängig vom Bild-Backend.

## JEV-artige Pipeline: den LLM die Browser-Schleife führen lassen (Phase 10)

Der **Frame-Vertrag** „ein Frame ≡ Screenshot + nummerierter DOM + Absicht + Aktionsfortschritt" und die **Bewertungsnähte** „der Judge antwortet nur mit Nummern, niemals mit Selektoren" werden zu einer lauffähigen, testbaren und archivierbaren Pipeline ausgearbeitet. Die Bewertung übernimmt ein externer **Laya-/JEV-Bewertungsdienst** (siehe unten), die Schleife treibt dieses Plugin an.

**Vier Werkzeuge** (hostseitig per `defineTool`; Bewertungsanfragen gehen als HTTP direkt aus dem Plugin-Prozess, nicht über die Agent-Sitzung):

| Werkzeug | Funktion | Wann verwenden |
|---|---|---|
| `bcdp_jev_status` | **Zuerst ausführen**: Verfügbarkeit der Bewertungskette + Konfigurationsdiagnose, **sendet keinerlei Anfragen** | Erster Schritt, wenn Konfiguration/Kette verdächtig sind |
| `bcdp_jev_frame` | Einen Frame aufnehmen (Screenshot + nummerierte Kandidaten + Absicht), um zu sehen, was der Judge sieht | Frame-Inhalte debuggen, Kandidatennummerierung prüfen |
| `bcdp_jev_ask` | Anfragekörper zusammenbauen; `dryRun` ist standardmäßig true, `round=control\|chapter\|pick\|evaluate` erlaubt stufenweise Prüfung vor dem Senden | Die Bewertungsanfrage erst ansehen, dann senden |
| `bcdp_jev_run` | Die gesamte Schleife ausführen, mit Schritt-für-Schritt-Trace (Kandidatenzahl / Top / Budget / Treffer je Schritt) | Wenn er wirklich handeln soll |

**Die Standardkette ist `laya → rule`**. JEV ist derzeit nicht registrierbar, daher wird es standardmäßig nicht eingetragen; sobald möglich, genügt es, `jev` in `judgePrefer` wieder aufzunehmen und `jevUrl` zu setzen. Fehlt der Schlüssel, druckt `bcdp_jev_status` von sich aus die lokale Startanleitung (`ENGINE=laya … uvicorn laya_api.main:app`, Port **8000** statt 7789, `ALLOW_DEV_LOGIN=true` zum Anlegen eines Schlüssels). Nicht verfügbare Stufen werden **übersprungen, ohne aufgerufen zu werden** (laya erzwingt Authentifizierung ohne anonymen Zweig — fehlender Schlüssel bedeutet zwangsläufig 401); jedes Überspringen und jeder Fehlschlag landet im Trace, niemals stilles Zurückfallen; `refuse` ist ein Ergebnis, keine Ausnahme.

**Dreistufige Verengung (der LLM führt den Prozess, statt alles auf einmal zu raten)**:
1. `control` — handeln oder nicht (feste 5 Optionen: `pick_button` / `sleep` / `next` / `prev` / `done`);
2. `chapter` — welches Kapitel (Cluster nach AX-Containern, über die Elternkette der `childIds` zum nächsten strukturierten Vorfahren, etwa `form#1` / `form#2`; bei nur einem Kapitel entfällt diese Runde);
3. `pick` — welche Nummer im Kapitel + ein Risikowert `score`.

Die Kapitelbildung ist kein Schmuck: Die Schwellen werden nach Kandidatenzahl in Buckets eingeteilt, und **einen 20-zu-1 in „einige-zu-1 × einige-zu-1" zu zerlegen lässt beide Runden in strengere Buckets fallen** (`top≥0.5` und `top−second≥0.15`) — kontrollierbarer als ein einziger 20-zu-1 (`top≥0.6`). Der Judge **antwortet nur mit Nummern**; Koordinaten/Selektoren misst die Ausführungsschicht jedes Mal neu (`DOM.getBoxModel` + vor dem Klick eine Trefferprüfung per `DOM.getNodeForLocation`); die Rechtecke im Frame dienen niemals als Klickgrundlage.

**Der Bewertungskontext ist isoliert**: Nur die vier Abschnitte `INTENT` / `PROGRESS` / `FRAME` / `HISTORY` sind erlaubt, **niemals das Sitzungspräfix der Agent-Sitzung**; jeder zusätzliche Abschnitt löst beim Zusammenbau sofort einen Fehler aus (per Assertion, nicht per Konvention). `PROGRESS` (Schrittzahl / Versuche und Ergebnisse je Kapitel / wirklich erfolgreiche Aktionen / Restbudget) wird von der Schleife selbst **mechanisch erzeugt**, nicht vom Modell geschrieben — modellgeschriebener Fortschritt ist die zweitschwerst erkennbare Halluzinationsquelle.

**Bewertungsschalter `jevEvaluate` (standardmäßig an, im Einstellungspanel abschaltbar)**: Nach jedem ausgeführten Schritt bewertet der Judge den Fortschritt erneut: `inprogress` / `done` / `fail`. Bei `fail` oder einem „nicht verifizierten done" wird der nächste Schritt nicht geraten, sondern **in `escalate` übergeführt** — mit einer geordneten Liste von `RecoveryOption` (etwa zuerst `reload` zum Auffrischen, weil ein veraltetes Rendering eine bereits geschriebene Bestätigung verbergen kann), die der LLM für sich entscheiden lässt: recover oder anhalten.

**Terminale Schleifenzustände**: `done` (Selbstprüfung gegen `successCriteria`) / `blocked` (Budget gestoppt) / `exhausted` (Budget erschöpft, mit `exhaustedKind`) / `stuck` (gleicher Anker, gleiche Aktion, 3-mal hintereinander ohne Änderung) / `unavailable` (kein Judge) / `error` / `escalate`.

> Ehrliche Bestandsaufnahme: Diese Phase hat belegt, dass **Protokoll, Schwellen, Terminierung, Kapitelbildung, Zusammenbau und Isolation** korrekt sind (abgedeckt durch die `bcdp_jev_*`-Unit-Tests), aber **der End-to-End-Lauf auf einem echten Browser steht noch aus** (T10.22 offen); die **Trefferquote** der Bewertung wurde nicht real gemessen (die Schwellen-Buckets dienen der Kalibrierung, sie beweisen keine richtigen Entscheidungen). Archivierte bearbeitete Elemente behalten Lokalisierungsmerkmale wie `class` (nur die Inspector-Hüllen-Tokens werden entfernt), um sie beim escalate dem LLM zur Wiederherstellung zurückzumelden.

## Entwicklung

Der Quellcode liegt in `src/` (TypeScript), die Build-Artefakte in `lib/` (Host- + Client-Bundle) und `bin/cdp-cast-worker.mjs` (Worker-Bundle).

```sh
pnpm typecheck   # tsc-Typbarriere (tsconfig.json Hauptprojekt + tsconfig.client.json Client)
pnpm test        # vitest-Unit-Tests
pnpm run build   # drei tsdown-Bundles: lib/index.js + lib/client.js + bin/cdp-cast-worker.mjs
```

> Direkt in `src/` arbeiten (`src/index.ts` Werkzeugschicht, `src/client/index.ts` Frontend, `src/worker/cdp-cast-worker.ts` Worker). Neue Werkzeuge in `registerActionTools` per `t({...})` ergänzen und im `bcdp_help`-Index (`src/help.ts`) einen Eintrag nachziehen, dann `pnpm typecheck && pnpm test && pnpm run build` ausführen. `lib/` und `bin/cdp-cast-worker.mjs` sind Build-Artefakte (vorgebaut eingecheckt) — bitte nicht von Hand ändern.

`node_modules/` enthält nur symbolische Links auf einen DSH-Checkout (Typauflösung zur Kompilierzeit); zur Laufzeit löst der Harness `@deepseek-ai/dsh-tools` auf.

## Bekannte Einschränkungen (ehrlich benannt)

- **Windows**: Auf Plugin-Ebene seit v0.4.0 angepasst; die zugrundeliegende ego-lite-Runtime bleibt eine Community-Portierung ohne offiziellen Windows-Support — die Stabilität komplexer mehrstufiger Abläufe kann hinter macOS zurückbleiben.
- **FFmpeg-Plattformaufnahme**: Windows nutzt inzwischen `gfxcapture(HWND)`, was einen neueren Build mit diesem Filter erfordert; ein älteres FFmpeg im PATH wird übersprungen, mit Hinweis auf einen kompatiblen Download. Linux nutzt `x11grab`, macOS `avfoundation` als Anzeige-Ausschnitt; ScreenCaptureKit unter macOS und ein Portal-Helper für Wayland sind künftige Erweiterungen.
- **Installationsumgebung**: Die DSH-Peer-Pakete dieses Repositorys sind nicht alle in der öffentlichen npm-Registry. Ein gewöhnliches `pnpm install` kann beim Auflösen der `@deepseek-ai/*`-Peers scheitern; eine DSH-Profil-Installation muss diese Peers liefern. CDP hängt nicht von FFmpeg ab und lädt bei der Plugin-Installation keine Binaries herunter.
- **Snapshot-Qualität**: Unter Linux wird der semantische Baum über CDP `DOMSnapshot` rekonstruiert, nicht kernelnah wie unter macOS — komplexe iframe/canvas-Szenarien können degradieren.
- **Host-Zuverlässigkeit (Linux)**: nicht gemergte Community-PRs — Tab-/Space-Zustand kann zwischen übergreifenden CLI-Aufrufen verloren gehen; das Plugin ist defensiv gebaut, einfache Abläufe sind stabil, komplexe können Retries brauchen.
- **Login-Persistenz**: Laufzeit-Cookies von Chrome werden nur beim sauberen Herunterfahren auf Disk geschrieben; nach hartem Kill und Neustart ist erneutes Anmelden nötig.
- Das Ausgabeschema ist liberal (`additionalProperties: true`); der Client richtet sich nach den tatsächlich zurückgegebenen Werten.

## Lizenz und Namensnennung

Das Plugin selbst steht unter MIT. Die eingebaute Runtime bettet MIT-Code von ego-lite ein; die optional herunterladbaren FFmpeg-Builds ziehen GPL-3.0-or-later-Pflichten nach sich. Vor Nutzung oder Weiterverbreitung bitte die Lizenzen der Build-Quellen und die Informationen zum Quellcodezugriff lesen — siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Supply-Chain- und Berechtigungshinweise

Deterministische Fakten zur Verzeichnisaufnahme und Überprüfung:

- **Laufzeitdateien**: `lib/` (Build-Artefakte, deterministisch aus dem TypeScript von `src/` per `npm run build` mit tsdown erzeugt), `bin/` (ausführbare Einstiegsskripte für Worker und ffmpeg-probe), `cordis.patch.yml` (Assemblierungsschicht), `dsh-plugin.json` (Manifest). `*.map` sind nur Debug-Sourcemaps, an der Laufzeit nicht beteiligt und ausdrücklich ausgeschlossen.
- **Native/ausführbare Artefakte**: `runtime/` enthält die eingebaute ego-lite-Runtime (MIT; Herkunft und Datei-für-Datei-Liste in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — sie ist die Kernfunktion des Plugins (selbstversorgter, verwalteter Chrome/CDP-Host), ein absichtlich mitgeführtes ausführbares Artefakt, kein Build-Nebenprodukt. `runtime/PATCHES.md` dokumentiert alle lokalen Patches gegenüber dem Upstream.
- **Abhängigkeiten**: Die einzige Laufzeitabhängigkeit ist `@deepseek-ai/schemastery` (eine äquivalente Implementierung stellt der DSH-Host bereit); die Peer-Dependencies sind ausnahmslos `@deepseek-ai/dsh-*`-Hostdienste. Die externen Module des Client-Bundles werden über die Modultabelle des Hosts aufgelöst, keine npm-Laufzeitabhängigkeiten werden mitgeführt.
- **Externe Dienste**: keine Telemetrie, keine externen API-Aufrufe. Das einzige Netzverhalten ist **optional**: Der FFmpeg-Installer lädt auf Anweisung des Nutzers einen Build von GitHub (oder einem konfigurierten Mirror); Quellenprüfung und Lizenzpflichten siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Fehlverhalten**: Ohne webServer am Host (TUI/headless) werden die Watch-Routen sicher übersprungen; schlägt der Worker-Start fehl, liefern die Watch-Routen ein JSON mit `ok:false`, statt zu hängen; die Browser-Prozesse enden mit dem Teardown des Hosts (`--stop` als fire-and-forget, ohne den Host-Exit zu blockieren).
- **Berechtigungen**: Das `permissions`-Feld des Manifests ist leer — Dateizugriffe der Werkzeugsammlung sind auf die ego-verwalteten Space-Verzeichnisse und den Arbeitsbereich des Nutzers beschränkt; Netzzugriff läuft über den verwalteten Agent-Browser, nicht über den Host-Prozess.

---

## Freundliche Empfehlungen

Ebenfalls aus dem DeepSeek-Harness-Plugin-Ökosystem, gegenseitige Empfehlung:
