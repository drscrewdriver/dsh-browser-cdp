# dsh-browser-cdp — Le navigateur d'agent visible (accès CDP)

[简体中文](README.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Italiano](README.it.md) | [Русский](README.ru.md) | [Español](README.es.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue" alt="DSH >= 0.2.0-rc.1">
  <img src="https://img.shields.io/badge/DSH--better--sidebar-%3E%3D0.12.2(optional)-red" alt="dsh-better-sidebar >= 0.12.2 (optional)">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?logo=node.js&logoColor=white" alt="Node >= 22">
</p>

> **Dépôt** : `github.com/drscrewdriver/dsh-browser-cdp` (anciennement `dsh-ego-browser`, dérivé du projet amont [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)) ｜ Historique des versions : voir [CHANGELOG.md](CHANGELOG.md)

### Matrice de compatibilité des versions

| Dépendance | Version minimale | Version recommandée | Remarques |
|---|---|---|---|
| **DSH** (DeepSeek Harness) | `0.2.0-rc.1` | `≥ 0.2.0-rc.1 <0.2.1-0` | Ligne 0.2.0 : les peer dependencies sont verrouillées en synchronie sur `>=0.2.0-rc.1 <0.2.1-0` ; l'hôte assure la rétrocompatibilité de l'API des plugins (le composer/`forkSession` de 0.2.0 est une extension de signature, le plugin n'est qu'appelant, aucune modification requise). La surface de réglages déclarative introduite depuis 0.1.7 (champs Config `.volatile()` générant automatiquement le formulaire de réglages) se poursuit en 0.2.0. Pour DSH `0.1.2-rc.1` ~ `0.1.7`, utilisez la branche **0.17.x** ; pour 0.1.0-rc.x / 0.1.1-rc.x, utilisez v0.8.0 ou une version antérieure |
| **dsh-better-sidebar** | `0.12.2` (facultatif) | `≥ 0.17.1` | Sans lui, repli automatique sur la boule d'observation flottante ; `< 0.12.2` fonctionne mais l'interception des liens externes (`urlTarget`) se dégrade silencieusement |
| **Node.js** | `22` | — | Fourni avec l'environnement du harness |

**Notes d'adaptation à toutes les versions de DSH** : cette version (**à partir de v0.18.0, ligne 0.2.0**) cible DSH `0.2.0-rc.1+` : **zéro modification de code** par rapport à la ligne 0.1.7 (v0.17.x), simple rotation des dépendances/métadonnées — l'hôte 0.2.0 est rétrocompatible avec l'API des plugins, et ce plugin livre ses sélections via la façade `ctx.get('conversation').input` (sans appeler `submit()`, sans override), donc hors du périmètre d'impact des changements de 0.2.0. La surface de réglages déclarative, introduite en 0.1.7, fonctionne ainsi : le plugin n'enregistre plus aucune section de réglages (l'API d'enregistrement `ctx.settings` a été supprimée par l'hôte) ; à la place, les champs configurables sont marqués `.volatile()` sur le schéma Config et l'hôte génère automatiquement le formulaire dans sa page de réglages ; les changements des champs volatile prennent effet à chaud via l'événement `loader/volatile-update`, sans recharger le plugin. Les API hôtes essentielles (`defineTool`, `ctx.tools.register`, `ctx.subprocess.spawn`, `ctx.webServer.register`, `ctx.inject`, la fabrique CJS `ModuleLoader`, `cordis.patch.yml`) conservent leur forme depuis 0.1.2. Pour DSH `0.1.2-rc.1` ~ `0.1.7`, utilisez la branche **0.17.x**.

**Notes d'adaptation à dsh-better-sidebar** : ce plugin enregistre un onglet de barre latérale et écoute les liens externes via le service `ctx.betterSidebar` (obtenu de façon défensive dans un try-catch). Versions d'introduction des API clés :

| API | Utilisation dans ce plugin | Version d'introduction dans better-sidebar |
|---|---|---|
| `registerTab()` / `openTab()` / `ctx.betterSidebar` | Enregistrement + ouverture d'onglet | v0.9.0+ |
| `TabDescriptor.single` | Onglet à instance unique | v0.9.0+ |
| `TabDescriptor.urlTarget` | Interception des liens externes | **v0.12.2+** (en dessous, l'interception des liens échoue silencieusement) |

---

**Détails du support des versions de DSH** : changements majeurs de v0.8.2 → v0.8.3 : fusion de 6 PR communautaires (adaptation root/xvfb/macOS headless, compatibilité rc.1, stabilité Windows), correction de la faille de sécurité des routes `/api/bcdp/*` sans authentification, de l'échec de démarrage du client hôte sans dsh-better-sidebar (#29), de la régression de démarrage à froid sous Windows (fausse détection Xvfb introduite par #22), et ajout de `runtimeArgs`/`chromeArgs` à la liste blanche des réglages de la passerelle. Points d'adaptation : renommage du runtime client (`@deepseek-ai/dsh-client-store`), id d'enregistrement du module client et nom de ligne de chargement alignés sur le nom de package déclaré, `dsh.client.inject` ne déclarant que les lignes réelles du graphe de modules, `webServer` délivré par injection imbriquée (service facultatif), et synchronisation avec le mode onglet de barre latérale (dsh-better-sidebar).

**Prise en charge de la barre latérale ([dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar))** : lorsque l'hôte a installé `dsh-better-sidebar` (≥ v0.12.2 recommandé), la fenêtre d'observation en temps réel s'enregistre comme **onglet natif de la barre latérale** — « Navigateur de l'agent » apparaît dans le menu « + » de la barre latérale, s'ouvre d'un clic et reste affiché ancré au tiroir de la barre latérale ; l'onglet s'ouvre automatiquement à la première invocation d'un outil `bcdp_*` par l'agent (depuis v0.8.5, l'ouverture est cadrée sur la session appelante, fini les popups dans la mauvaise session en multi-sessions). Sans `dsh-better-sidebar`, repli automatique sur le mode **boule d'observation flottante** en bas à droite (`#dsh-ego-fab`). Les deux formes partagent le même ensemble de capacités : streaming SSE en temps réel / clic / saisie / capture des téléchargements. La fenêtre d'observation offre aussi un bouton « Fenêtrer » : le navigateur d'agent en mode headless bascule en un clic vers une fenêtre avec interface du même Profile (onglets conservés), pratique pour une reprise en main manuelle.

**Import de l'état de connexion (nouveau en v0.8.5)** : l'outil `bcdp_login_import` copie **par domaine** les cookies de connexion de votre Chrome/Edge/Brave quotidien vers le navigateur de l'agent (démarrage headless du binaire réel + lecture par CDP transparent, compatible avec l'App-Bound Encryption de Chrome 127+, sans déchiffrement hors ligne ; si le navigateur source tourne, il peut être arrêté proprement avant l'import, la fenêtre étant restaurée au prochain démarrage). Les valeurs des cookies n'apparaissent dans aucun journal ni sortie ; avant l'import, la base de cookies source est sauvegardée automatiquement et restaurée en cas de vidage anormal. Combiné au Profile persistant sur disque par défaut, l'état de connexion importé survit durablement aux redémarrages.

Un **proxy de navigateur CDP** : il intègre [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite) (un Chromium pour agents IA) comme runtime embarqué dans le DeepSeek Harness, pilote le navigateur avec **38 outils structurés `bcdp_*`** et l'accompagne d'un **frontal d'observation en temps réel** — pendant que l'agent manipule des pages en arrière-plan, vous voyez chaque page qu'il parcourt comme un direct, et vous pouvez même intervenir directement.

**Une particularité qui nous est propre (self-observation)** : l'agent utilise précisément ce Chromium — y compris quand il manipule **DSH lui-même** (gestion des sessions, tableau des tâches, réglages), la fenêtre d'observation l'affiche en direct et vous pouvez reprendre la main à tout moment. Il ne s'agit pas seulement de « voir l'agent travailler sur le Web » : même les manipulations de l'interface DSH par l'agent sont intégralement visibles et maîtrisables.

**Prêt à l'emploi** : le paquet du plugin embarque le runtime ego (`runtime/`, MIT, voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — pas besoin de cloner le dépôt officiel ni de compiler à la main, le wrapper `--no-sandbox` est fourni avec le paquet : root / Docker / machine sans écran tournent en un clin d'œil.

---

## Nos véritables atouts (pas des slogans, des capacités vérifiables dans le code et face à la concurrence)

D'autres plugins qui branchent ego-lite dans DSH n'en ont tiré que **3 outils** — un script `run`, un guide `help`, un bilan `status` — et le navigateur reste une **boîte noire en arrière-plan**. Ce plugin prend le chemin inverse : **ouvrir la boîte noire, et d'emblée livrer pleinement les capacités de « voir » et de « contrôler »**.

| Capacité | Ce plugin (ce dépôt) | Plugin similaire (Da1dr1em/dsh-ego-browser) |
|---|---|---|
| Nombre d'outils structurés | **38**, responsabilité unique, appel déterministe | **3** (`run`/`help`/`status`) |
| Fenêtre d'observation en temps réel (double backend CDP JPEG / FFmpeg H.264 + barre d'onglets + tiroir d'historique) | ✅ Oui | ❌ Non |
| Manipulation **directe** du vrai navigateur à la souris depuis la fenêtre d'observation (clic/glisser/scroll renvoyés au CDP) | ✅ Oui | ❌ Non |
| **Sélection d'un élément dans la fenêtre d'observation → capture et référence dans le champ de saisie de la conversation** (bloc structuré `[CDP-PICKS]`, désignation manuelle de la cible) | ✅ Oui | ❌ Non |
| Garde à instance unique du worker + auto-réparation après crash/doublon | ✅ Oui | ❌ Non |
| Capture des téléchargements `bcdp_download` / détection de captcha `bcdp_captcha`/`bcdp_page_info` | ✅ Oui | ❌ Non |
| Adaptation aux plateformes (détection automatique Linux/macOS/Windows + replis root/headless/`--no-sandbox`) | ✅ Toutes plateformes | Hôte de prévisualisation Windows uniquement, configuration manuelle |
| Persistance sur disque de l'état de connexion `bcdp_auth_flush` | ✅ Oui | ⚠️ Mentionné au niveau de la documentation seulement |

**Trois différences clés :**
- **Voir** : chez les autres, une boîte noire qui « vous raconte le résultat à la fin » ; nous streamons en direct — vous **regardez l'agent opérer** et repérez immédiatement s'il se bloque sur un captcha ou prend un mauvais chemin.
- **Contrôler** : chez les autres, lecture seule ; notre fenêtre d'observation **pilote directement** le même navigateur d'agent — au besoin, vous reprenez la main vous-même (zoom/glisser/clic), sans interrompre l'agent ni tout recommencer.
- **Désigner** : vous **sélectionnez** un élément de la page dans la fenêtre d'observation ; le plugin capture son `backendNodeId`/`tag`/`id` et sa description sémantique, et l'insère sous forme de bloc structuré `[CDP-PICKS]` dans le brouillon du champ de saisie de la conversation (les sélections multiples d'une même page sont fusionnées et numérotées automatiquement) — l'agent reçoit une cible précise, sans avoir à deviner « de quel bouton vous parlez ».

> La comparaison ci-dessus repose sur des faits publics vérifiables : le code de ce dépôt (`bin/cdp-cast-worker.mjs` streaming en temps réel + renvoi des entrées CDP, `lib/index.js` et ses 38 outils enregistrés, `lib/cast-server.js` pont hôte, `deliverPickToConversation` de `lib/client.js` pour la référence des sélections) et le code source/README du plugin similaire (dont `src/tools.ts` n'enregistre que `ego_browser_run` / `ego_browser_help` / `ego_browser_status`). Ce document ne dénigre personne — nous énonçons simplement quelles capacités nous avons implémentées et vérifiées en plus.

**Par rapport à [ego-lite](https://github.com/CitroLabs/ego-lite) lui-même, voici ce que nous apportons en plus (tout est vérifiable dans le code de ce dépôt) :**

| Capacité | Description (code correspondant) |
|---|---|
| **Frontal d'observation** | ego-lite seul est un CLI headless (uniquement des scripts heredoc + sorties texte) ; nous y avons ajouté **SSE de streaming en temps réel + barre d'onglets + tiroir d'historique + manipulation directe à la souris dans la fenêtre d'observation + sélection d'éléments référencée dans le champ de saisie** (`bin/cdp-cast-worker.mjs`, `lib/cast-server.js`, `createPickControl`/`deliverPickToConversation` de `lib/client.js`), faisant de « voir », « contrôler » et « désigner » des capacités de premier ordre |
| **Prêt à l'emploi + autosuffisant sur toutes les plateformes** | `resolveEgoEnv` détecte automatiquement Chrome/Edge/Brave, wrapper `--no-sandbox` embarqué, zéro configuration sous root / Docker / sans écran (`lib/index.js`) ; pas besoin d'installer d'abord un hôte GUI comme l'exige l'officiel |
| **Couche de robustesse** | Retente automatique au démarrage à froid (seuls les incidents CDP transitoires sont retentés, les vraies erreurs ne sont pas avalées), garde à instance unique du worker + redémarrage automatique après crash, teardown du plugin en fire-and-forget qui ne bloque pas la sortie de l'hôte, plafond du cache d'images côté frontal (`withWarmupRetry` / `makeEnsureWorker` / `frameCache`) |
| **Outils d'exploitation** | `bcdp_doctor` (bilan de l'environnement), `bcdp_captcha` (détection de captcha), `bcdp_auth_flush` (persistance de la connexion), `bcdp_login_import` (import de l'état de connexion du navigateur système), `bcdp_http` (requêtes dans le contexte du navigateur), etc. — une couche absente des helpers CLI natifs |
| **self-observation** | Quand l'agent manipule l'interface de DSH elle-même, tout est visible en temps réel et vous pouvez reprendre la main |

> Nous ne prétendons pas égaler les instantanés au niveau noyau ni l'expérience multi-fenêtres native de l'app macOS officielle ; ce dépôt résout ceci : « apporter les mêmes capacités de navigateur dans DSH + Linux/WSL, de manière visible ».

---

## Quel problème cela résout

Les navigateurs généralistes ne sont pas conçus pour les agents, or une grande partie des interactions du Web (état de connexion, captchas, rendu dynamique, formulaires, sites exigeant une session humaine) ne peut être affrontée que par un vrai navigateur — c'est là l'héritage de la famille ego amont : **« laisser l'agent utiliser votre navigateur déjà connecté, sans vous déranger »** ([site officiel](https://github.com/CitroLabs/ego-lite)).

Ce plugin l'intègre à DSH et résout le point le plus douloureux — **vous ne voyez pas ce que fait l'agent et ne pouvez pas intervenir** — grâce à une fenêtre d'observation :

> 🌐 Un clic sur la petite boule ouvre le direct ; 🟦 la barre d'onglets pour changer/fermer ; 🕘 le tiroir d'historique pour revoir ; 🔍 zoom et déplacement ; 🖱️ reprise en main directe du vrai navigateur depuis la fenêtre. **En une phrase : l'agent travaille dans le navigateur, vous voyez tout et pouvez reprendre la main à tout moment.**

### Quelques scénarios de prise en main courants

- **Veille / collecte de données** : demandez à l'agent de se connecter à CNKI / Google Scholar et de collecter page par page ; depuis la fenêtre d'observation, vous le voyez défiler, cliquer sur « page suivante », télécharger les PDF — s'il se bloque en route, vous le voyez aussitôt.
- **Formulaires et connexions** : l'agent remplit un formulaire à moitié, un captcha apparaît dans la fenêtre d'observation — vous reprenez la main, résolvez le captcha, puis rendez la main à l'agent pour qu'il continue.
- **QA / tests de fumée** : demandez à l'agent de cliquer partout dans votre produit ; la fenêtre d'observation devient un « enregistrement d'écran qui parle », avec en prime le replay de l'historique.
- **Regarder l'agent opérer DSH lui-même** (self-observation) : quand l'agent gère des sessions / ajuste des réglages, tout est visible dans la fenêtre d'observation et vous pouvez intervenir.

---

---

## Prérequis

| Exigence | Remarques |
|---|---|
| Node ≥ 22 | Fourni avec l'environnement du harness |
| **N'importe quel Chrome / Chromium / Brave / Edge** | Découverte automatique, ou `EGO_LINUX_CHROME` pour le spécifier ; sous root, le wrapper embarqué est utilisé |
| DSH + dshx | Mécanisme de chargement des plugins |
| DSH Web avec interface graphique (pour la fenêtre d'observation) | Les sessions headless restent utilisables avec les outils `bcdp_*`, simplement sans fenêtre d'observation |

## Installation

**Méthode 1 : installation directe depuis GitHub (recommandée)**

```sh
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp
# Il est aussi possible de figer sur un commit / tag donné :
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp#v0.9.0
```

> L'installation `github:` récupère le tarball du dépôt via pnpm en passant par `codeload.github.com`, **sans publication sur le registre npm** ; elle utilise directement le `lib/` **précompilé et versionné** du dépôt (`files` ne contient que `lib/`, `bin/`, `runtime/`, `cordis.patch.yml`, `dsh-plugin.json`), donc **aucun script de build n'est déclenché** et les devDependencies ne sont pas nécessaires. L'entrée hôte `lib/index.js`, le client `lib/client.js` et le worker `bin/cdp-cast-worker.mjs` sont tous distribués avec le dépôt.

**Méthode 2 : tarball local / URL git**

```sh
dshx install dsh-browser-cdp <dsh-browser-cdp.tgz>      # tarball ou URL git, au choix
dshx list                                                # doit afficher : [on] dsh-browser-cdp
```

> **Note sur le renommage du paquet** : le nom du paquet de ce plugin est **`dsh-browser-cdp`** (noms antérieurs : `dsh-ego-browser`, alias `@dsh-external/ego-browser`). Depuis DSH Desktop 2.0.5, une vérification de cohérence « nom de dépendance du profile == nom réel du paquet » a été ajoutée : si le profile référence encore l'ancien nom, le démarrage bascule en mode récupération. Après mise à niveau, renommez **à la fois** la clé de dépendance du `package.json` du profile **et** l'entrée `dsh.profile.bundles` en `dsh-browser-cdp` :

   ```diff
   - "dsh-ego-browser": "github:Fisfzy/ego-browser",
   + "dsh-browser-cdp": "github:drscrewdriver/dsh-browser-cdp",
   ```

   ```diff
   - "dsh-ego-browser",
   + "dsh-browser-cdp",
   ```

Les réglages de la fenêtre d'observation permettent de choisir `captureBackend=auto|cdp|ffmpeg` (`auto` par défaut, résolu actuellement en CDP), les paliers de qualité, CDP FPS/qualité JPEG/largeur maximale, ainsi que FFmpeg FPS/largeur maximale/débit/encodeur/chemin personnalisé. Le plugin détecte d'abord le chemin personnalisé, le PATH système et le cache géré ; le téléchargement GitHub peut remplacer `https://github.com` par `githubMirror`, par exemple `https://gh-proxy.com/github.com`. Le débit FFmpeg va de 500 à 20000 kbps, avec des valeurs par défaut de 2000/4000/8000 kbps pour les paliers bas/équilibré/élevé.

Aucune configuration côté hôte : `resolveEgoEnv` détecte automatiquement root / absence d'écran et applique les replis. Les routes hôte de la fenêtre d'observation (`/api/bcdp/spaces`, etc.) ne sont enregistrées que si un serveur HTTP existe ; en headless, c'est un no-op sûr.

## Modes de connexion : endpoint CDP / CLI ego local

La liste de connexions du panneau de réglages est **ordonnée** — **l'ordre définit la priorité**, et l'entrée activée pilote chaque appel `bcdp_*`. Deux types d'entrées existent :

| Type | Ce qu'elle fait | Contraintes |
|---|---|---|
| **Endpoint CDP** | Passe l'adresse d'un navigateur déjà ouvert sur un port de débogage au runtime embarqué (injection de `EGO_LINUX_CDP_URL`), qui s'y **attache** | Plusieurs entrées possibles |
| **CLI ego local** | Le CLI ego de la machine pilote **lui-même** son navigateur ego-lite local — **aucun endpoint injecté** | **Machine locale uniquement, une seule au maximum au niveau global** |

**Pourquoi le second type existe** : le `EGO_LINUX_CDP_URL` d'injection est un contrat privé du **portage Linux embarqué** ; sur macOS, le `ego-browser` natif fourni avec l'app `ego lite` **ne le lit tout simplement pas**. Ainsi, si « endpoint CDP » était le seul type proposé, les utilisateurs macOS ne pourraient pas exploiter leur ego-lite déjà connecté — ils devraient se connecter à un port distant, ou laisser le portage lancer un Chromium stock. Le type CLI local comble exactement ce manque.

Ordre de résolution (`cliPath` laissé vide) : chemin explicite → `ego-browser` sur le PATH → helper dans le paquet de l'app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime embarqué du plugin.

Deux valeurs par défaut méritent d'être connues :

- **`--sdk-path` désactivé par défaut** : par défaut, on utilise le harness fourni avec le CLI (celui officiellement apparié) ; ce n'est qu'en l'activant que le paquet harness de ce plugin est injecté. Si le CLI ne reconnaît pas ce drapeau, le plugin note un indice et **retente automatiquement une fois sans lui** — toute la chaîne n'est donc pas condamnée.
- **La sonde de disponibilité passe par un vrai heredoc** (le même canal que celui utilisé pour le travail réel), elle n'est donc **pas gratuite** : la sonde peut déclencher le démarrage à froid du navigateur en arrière-plan (environ 1,3 s mesurés avec le portage embarqué).

Relations avec les autres commutateurs :

- `cdpMode` : `auto` suit l'entrée activée (les deux types conviennent) ; `remote` **n'accepte que les endpoints CDP** et renvoie explicitement `mode-kind-mismatch` si l'entrée activée est un CLI local ; `local` passe par le lanceur local géré.
- `remoteEnabled` (interrupteur général distant) **ne concerne que le CDP distant**, sans effet sur les connexions CLI locales.
- `allowLocalFallback` / `localHeadless` / `localUserDataDir` ne s'appliquent qu'au repli des endpoints CDP et aux lancements gérés.

`bcdp_doctor` signale le décompte des types de la séquence courante, le chemin réellement résolu du CLI et sa forme, ainsi que (si le plugin amont `dsh-ego-browser` est installé sur la même machine) un avertissement de coexistence.

## Liste des outils (38, préfixe `bcdp_`, index complet via `bcdp_help`)

| Catégorie | Outils |
|---|---|
| Espaces de tâches | `bcdp_space_open` `bcdp_space_close` `bcdp_status` |
| Lecture de page | `bcdp_snapshot` (arbre sémantique) `bcdp_page_info` `bcdp_read_element` |
| Navigation/attente | `bcdp_navigate` (réutilise l'onglet) `bcdp_wait` `bcdp_wait_for_selector` `bcdp_wait_for_url` `bcdp_wait_for_response` |
| Interaction | `bcdp_click` `bcdp_fill` `bcdp_hover` `bcdp_drag` `bcdp_select` `bcdp_check` `bcdp_key` `bcdp_scroll` |
| Exécution/débogage | `bcdp_js` (évaluation dans la page) `bcdp_cdp` (CDP brut) `bcdp_cli` (heredoc arbitraire) `bcdp_script` (script multi-étapes) |
| Sorties | `bcdp_screenshot` `bcdp_download` `bcdp_upload` |
| Session/sécurité | `bcdp_auth_flush` (persistance de la connexion) `bcdp_login_import` (import inter-navigateurs de l'état de connexion) `bcdp_captcha` `bcdp_dialog` |
| Méta-outils | `bcdp_help` `bcdp_doctor` `bcdp_http` |
| Revue (JEV/Laya, service de jugement externe facultatif) | `bcdp_jev_status` `bcdp_jev_frame` `bcdp_jev_ask` `bcdp_jev_run` `bcdp_jev_attempt` |

## Utiliser la fenêtre d'observation

La **🌐 boule permanente** en bas à droite → cliquez pour ouvrir :

- **Vue principale** : flux en direct de la page courante de l'agent ; clic/glisser/molette agissent directement sur la page, Ctrl+molette pour zoomer, Ctrl+glisser pour déplacer, double-clic pour réinitialiser. Après un clic sur la vue, la saisie clavier est possible directement : IME chinois, collage, Tab/Entrée/flèches et raccourcis Ctrl/Cmd pris en charge.
- **Sélection d'élément** (référence par sélection) : cliquez sur le bouton de la barre d'outils pour entrer en mode sélection, puis cliquez sur n'importe quel élément de la vue en direct — le plugin capture son `backendNodeId`/`tag`/`id` et sa description sémantique, et l'insère comme bloc structuré `[CDP-PICKS]` dans le brouillon du champ de saisie de la conversation ; les sélections multiples d'une même page sont fusionnées automatiquement dans le même bloc et numérotées successivement, l'agent les exploite précisément par numéro. Fonctionne aussi bien avec la boule flottante qu'avec l'onglet de la barre latérale.
- **Barre d'onglets** : rangée horizontale en haut, clic pour changer, `×` pour fermer.
- **Tiroir d'historique** (🕘) : revoir la trace des visites par ordre chronologique.
- Pendant les actions, la ligne d'URL en bas affiche les messages en place, puis se rétablit après 2 secondes.
- Quand le panneau se ferme, que l'onglet sidebar se cache ou que le composant se démonte, la production d'images s'arrête à la fin d'une période de grâce de 1,5 seconde. Le seul passage de la fenêtre DSH en arrière-plan n'interrompt pas le streaming, pour éviter de reconstruire WGC/FFmpeg en boucle au retour au premier plan ; une fermeture anormale est rattrapée par l'expiration du bail worker de 120 secondes.

### Backends d'image

- `cdp` : JPEG via `Page.startScreencast`, 20 FPS par défaut. Chaque frame source est accusée immédiatement via l'ID fourni par Chrome ; seule la dernière frame en attente est conservée ; seuls l'onglet actuellement consulté est capturé, et les pages statiques reprennent une capture par défaut toutes les 3 secondes.
- `ffmpeg` : sous Windows, `gfxcapture(hwnd)` capture directement la surface D3D11 de la fenêtre Chrome cible ; les autres plateformes utilisent un recadrage de la source d'affichage. Encodage ensuite en H.264 fragmented MP4 → chunks binaires HTTP → `<video>` MediaSource, sans passer par Base64/SSE.
- `auto` : CDP est choisi par défaut ; en cas d'échec de détection, FFmpeg n'est pas téléchargé automatiquement. FFmpeg n'est sélectionnable qu'une fois installé et validé par le contrôle de capacités ; si un backend FFmpeg enregistré devient invalide, la session d'observation retombe sur CDP et affiche la raison.
- Sous Windows, FFmpeg doit inclure `gfxcapture`. Le plugin associe le HWND via le PID du navigateur, le titre du target et les limites de fenêtre CDP ; la capture de la page cible continue même si la fenêtre est déplacée ou recouverte, et tout repli vers l'enregistrement du bureau est interdit. Si le target est un onglet en arrière-plan de la même fenêtre Chrome, une erreur explicite est renvoyée plutôt que d'afficher l'onglet visible ou de voler le focus de l'utilisateur. Sous macOS, l'autorisation « Enregistrement d'écran » est requise au premier usage ; sous X11, Chromium et FFmpeg doivent partager le même `DISPLAY` ; sous Wayland, en l'absence d'entrée Portal/PipeWire, un message invite à revenir au CDP.

L'installation gérée de FFmpeg va dans `~/.dsh/cache/ego-browser/ffmpeg/`, sans rien écrire dans le répertoire du plugin. Windows/Linux utilisent un tag de release BtbN figé ; macOS utilise les assets de la release GitHub `ffmpeg-static` figée (ses binaires Intel/Apple Silicon proviennent respectivement d'Evermeet/OSXExperts). Tous les téléchargements figent le SHA-256 de la ressource ; seul l'exécutable principal de FFmpeg est extrait, sans installation de `ffprobe` ni de `ffplay`. Sous Windows/Linux, le déballage utilise le `tar` du système ; en son absence, une erreur explicite est levée avant le téléchargement.

> Note sur l'état de connexion : les cookies des espaces de tâches sont isolés les uns des autres ; connectez-vous dans l'espace concerné. Après redémarrage de DSH, l'état de connexion de la session courante est effacé (les cookies d'exécution de Chrome ne sont écrits sur disque qu'à l'arrêt gracieux) — il faut se reconnecter ; le scan du QR code est rapide.

## Fonctionnement interne

- **Couche outils** : chaque outil assemble ses paramètres en un script JS, injecté via stdin à `ego-browser nodejs` par `ctx.subprocess`, l'hôte pilotant le Chromium partagé par CDP. Les résultats sont analysés grâce à la ligne sentinelle `@@DSH_RESULT@@`. Tous les `bcdp_*` sont sérialisés par un mutex intra-processus, les erreurs uniformisées.
- **Fenêtre d'observation** : `lib/client.js` gère le bail du watcher, le JPEG `<img>` et le MSE `<video>` ; `lib/cast-server.js` relaie le SSE des métadonnées, l'API watch et la vidéo binaire avec contre-pression ; dans le worker, `CaptureManager` garantit un seul backend actif et un seul target courant. Le plan de contrôle CDP (onglets, viewport, entrées, captcha) est indépendant du backend d'image.

## Pipeline style JEV : laisser le LLM conduire la boucle navigateur (phase 10)

Le **contrat d'image** « une frame ≡ capture d'écran + DOM numéroté + intention + progression des actions », conjugué à la **couture de jugement** « le juge ne renvoie que des numéros, jamais des sélecteurs », est concrétisé en un pipeline exécutable, testable et archivable. Le jugement est assuré par un service externe **Laya / JEV** (voir plus bas), la boucle est pilotée par ce plugin.

**Quatre outils** (`defineTool` côté hôte ; les requêtes de jugement partent en HTTP depuis le processus du plugin, sans passer par la session de l'agent) :

| Outil | Rôle | Quand l'utiliser |
|---|---|---|
| `bcdp_jev_status` | **Commencez par celui-ci** : disponibilité de la chaîne de jugement + bilan de configuration, **aucune requête émise** | Premier réflexe en cas de doute sur la config ou la chaîne |
| `bcdp_jev_frame` | Capture une frame (capture d'écran + candidats numérotés + intention) pour voir ce que verra le juge | Déboguer le contenu des frames, vérifier la numérotation des candidats |
| `bcdp_jev_ask` | Assemble le corps de requête ; `dryRun` vaut true par défaut, `round=control\|chapter\|pick\|evaluate` permet d'examiner niveau par niveau, et d'envoyer une fois tout vérifié | Voir clairement la requête de jugement avant de l'envoyer |
| `bcdp_jev_run` | Exécute toute la boucle et renvoie la trace pas à pas (candidats / top / budget / correspondance de chaque étape) | Quand on veut vraiment le laisser agir |

**La chaîne par défaut est `laya → rule`**. JEV ne peut pas encore être enregistré, il n'est donc pas écrit par défaut ; le jour où ce sera possible, il suffira de rajouter `jev` dans l'ordre de préférence `judgePrefer` et de renseigner `jevUrl`. En l'absence de clé, `bcdp_jev_status` affiche de lui-même comment lancer le service en local (`ENGINE=laya … uvicorn laya_api.main:app`, port **8000** et non 7789, `ALLOW_DEV_LOGIN=true` pour créer une clé). Les juges indisponibles sont **sautés sans être appelés** (laya exige une authentification sans branche anonyme, une clé manquante donne forcément un 401) ; chaque saut et chaque échec figurent dans la trace, jamais de repli silencieux ; `refuse` est un résultat, pas une exception.

**Réduction en trois niveaux (le LLM conduit le processus au lieu de tout deviner d'un coup)** :
1. `control` — faut-il agir (5 options fixes : `pick_button` / `sleep` / `next` / `prev` / `done`) ;
2. `chapter` — quel chapitre (clustering par conteneurs AX, en remontant la chaîne parentale des `childIds` vers l'ancêtre structuré le plus proche, comme `form#1` / `form#2` ; s'il n'y a qu'un seul chapitre, cette passe est sautée) ;
3. `pick` — quel numéro choisir dans le chapitre + un `score` de risque.

Le découpage en chapitres n'est pas décoratif : les seuils sont compartimentés selon le nombre de candidats, et **décomposer un 20-pour-1 en « quelques-pour-1 × quelques-pour-1 » fait retomber les deux tours dans des cases plus strictes** (`top≥0.5` et `top−second≥0.15`), plus maîtrisables qu'un 20-pour-1 unique (`top≥0.6`). Le juge **ne renvoie que des numéros** ; les coordonnées/sélecteurs sont remesurés à chaque fois par la couche d'exécution (`DOM.getBoxModel` + revérification du point par `DOM.getNodeForLocation` avant le clic) ; les rectangles de la frame ne servent jamais de base au clic.

**Le contexte de jugement est isolé** : seules les sections `INTENT` / `PROGRESS` / `FRAME` / `HISTORY` sont autorisées, **jamais le préfixe de session de l'agent** ; toute section supplémentaire déclenche une erreur immédiate à l'assemblage (par assertion, pas par convention). `PROGRESS` (nombre d'étapes / tentatives et résultats par chapitre / actions réellement réussies / budget restant) est **généré mécaniquement** par la boucle elle-même, jamais écrit par le modèle — la progression écrite par un modèle est la deuxième voie d'hallucination la plus difficile à détecter.

**Commutateur d'évaluation `jevEvaluate` (activé par défaut, désactivable dans le panneau de réglages)** : après chaque action exécutée, le juge réévalue la progression : `inprogress` / `done` / `fail`. Sur `fail` ou un « done non vérifié », on ne devine pas l'étape suivante : on **passe en `escalate`** — avec une liste ordonnée de `RecoveryOption` (par exemple `reload` d'abord pour rafraîchir, car un rendu périmé peut masquer une confirmation déjà écrite), laissée au LLM pour décider de récupérer ou de s'arrêter.

**États terminaux de la boucle** : `done` (auto-vérification contre `successCriteria`) / `blocked` (bloqué par le budget) / `exhausted` (budget épuisé, avec `exhaustedKind`) / `stuck` (même ancre, même action, 3 fois de suite sans changement) / `unavailable` (pas de juge) / `error` / `escalate`.

> État des lieux honnête : cette phase a prouvé que le **protocole, les seuils, la terminaison, le chapitrage, l'assemblage et l'isolation** sont corrects (couverts par les tests unitaires `bcdp_jev_*`), mais **le parcours de bout en bout n'a pas encore été exécuté sur un vrai navigateur** (T10.22 à faire) ; la **précision** du jugement n'a pas été mesurée en conditions réelles (les compartiments de seuils servent au calibrage, pas à prouver que les choix sont justes). Les éléments manipulés archivés conservent leurs caractéristiques de localisation comme `class` (seuls les tokens d'enveloppe de l'inspecteur sont retirés), pour être renvoyés au LLM lors d'un escalate en vue de la récupération.

## Développement

Le code source est dans `src/` (TypeScript), les artefacts de build dans `lib/` (bundles hôte + client) et `bin/cdp-cast-worker.mjs` (bundle worker).

```sh
pnpm typecheck   # barrière de types tsc (tsconfig.json principal + tsconfig.client.json client)
pnpm test        # tests unitaires vitest
pnpm run build   # trois bundles tsdown : lib/index.js + lib/client.js + bin/cdp-cast-worker.mjs
```

> Modifiez directement `src/` (`src/index.ts` couche outils, `src/client/index.ts` frontal, `src/worker/cdp-cast-worker.ts` worker). Ajoutez les nouveaux outils dans `registerActionTools` via `t({...})`, complétez l'index `bcdp_help` (`src/help.ts`), puis lancez `pnpm typecheck && pnpm test && pnpm run build`. `lib/` et `bin/cdp-cast-worker.mjs` sont des artefacts de build (précompilés et versionnés), ne les modifiez pas à la main.

`node_modules/` ne contient que des liens symboliques vers un checkout de DSH (résolution des types à la compilation) ; à l'exécution, le harness résout `@deepseek-ai/dsh-tools`.

## Limites connues (en toute honnêteté)

- **Windows** : adapté au niveau du plugin depuis v0.4.0 ; le runtime ego-lite sous-jacent reste un portage communautaire non officiellement pris en charge sous Windows, la stabilité des flux complexes en plusieurs étapes peut être inférieure à macOS.
- **Capture FFmpeg par plateforme** : Windows utilise désormais `gfxcapture(HWND)`, ce qui exige un build récent incluant ce filtre ; un vieux FFmpeg présent dans le PATH est ignoré avec une invite à télécharger une version compatible. Linux utilise `x11grab`, macOS `avfoundation` en recadrage d'affichage ; ScreenCaptureKit sous macOS et le helper Portal sous Wayland sont des évolutions à venir.
- **Environnement d'installation** : les paquets peer DSH de ce dépôt ne sont pas tous sur le registre npm public. Un `pnpm install` ordinaire peut échouer à résoudre les peers `@deepseek-ai/*` ; l'installation via un profile DSH doit fournir ces peers. CDP ne dépend pas de FFmpeg et ne télécharge aucun binaire à l'installation du plugin.
- **Qualité des instantanés** : sous Linux, l'arbre sémantique est reconstruit via CDP `DOMSnapshot`, pas au niveau noyau comme macOS ; les scènes complexes avec iframes/canvas peuvent se dégrader.
- **Fiabilité de l'hôte (Linux)** : PR communautaires non fusionnés — l'état des onglets/espaces peut se perdre entre des appels CLI croisés ; le plugin intègre des défenses : les flux simples sont stables, les flux complexes peuvent nécessiter des retentes.
- **Persistance de l'état de connexion** : les cookies d'exécution de Chrome ne sont écrits sur disque qu'à l'arrêt gracieux ; après un arrêt brutal et redémarrage, il faut se reconnecter.
- Le schéma de sortie est permissif (`additionalProperties: true`) ; le client se fie aux valeurs réellement renvoyées.

## Licence et attributions

Le plugin lui-même est sous MIT. Le runtime embarqué intègre du code MIT d'ego-lite ; les builds FFmpeg téléchargeables en option impliquent des obligations GPL-3.0-or-later. Avant toute utilisation ou redistribution, lisez les licences des sources de build et les informations d'obtention du code source — voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Chaîne d'approvisionnement et permissions

Faits déterministes fournis pour l'indexation et la revue des annuaires :

- **Fichiers d'exécution** : `lib/` (artefacts de build, générés de façon déterministe depuis le TypeScript de `src/` par `npm run build` avec tsdown), `bin/` (scripts exécutables du worker et de ffmpeg-probe), `cordis.patch.yml` (couche d'assemblage), `dsh-plugin.json` (manifeste). Les `*.map` ne sont que des sourcemaps de débogage, sans rôle à l'exécution, déclarés exclus.
- **Artefacts natifs/exécutables** : `runtime/` embarque le runtime ego-lite (MIT ; provenance et inventaire fichier par fichier dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — c'est le cœur fonctionnel du plugin (hôte Chrome/CDP géré autoporté), un artefact exécutable volontairement embarqué, non un sous-produit de build. `runtime/PATCHES.md` recense tous les correctifs locaux appliqués à l'amont.
- **Dépendances** : la seule dépendance d'exécution est `@deepseek-ai/schemastery` (implémentation équivalente fournie par l'hôte DSH) ; les peer dependencies sont toutes des services hôtes `@deepseek-ai/dsh-*`. Les modules externes du bundle client sont résolus par la table de modules de l'hôte, sans dépendance npm embarquée.
- **Services externes** : aucune télémétrie, aucun appel d'API externe. Le seul comportement réseau est **facultatif** : l'installateur FFmpeg télécharge un build depuis GitHub (ou le miroir configuré par l'utilisateur) sur instruction de l'utilisateur ; vérification des sources et obligations de licence : voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Frontières d'échec** : sans webServer côté hôte (TUI/headless), les routes watch sont proprement ignorées ; si le worker ne démarre pas, les routes watch renvoient un JSON `ok:false` au lieu de suspendre ; les processus du navigateur sont terminés avec le teardown de l'hôte (`--stop` en fire-and-forget, sans bloquer la sortie de l'hôte).
- **Permissions** : le champ `permissions` du manifeste est vide — les lectures/écritures de fichiers de la boîte à outils sont confinées aux répertoires d'espaces gérés par ego et à l'espace de travail de l'utilisateur ; l'accès réseau passe par le navigateur d'agent géré, pas par le processus hôte.

---

## Liens amis

Aussi issus de l'écosystème de plugins DeepSeek Harness, nous nous recommandons mutuellement :
