## [0.18.0] - 2026-09-29 — Ligne DSH 0.2.0-rc.1 (compat/0.2.0 : adaptation purement métadonnées, zéro modification de code)

### Ajouts
- **Implémentation `captureWithinBudget` du worker de rendu** (correction du blocage sur machine réelle pour la ligne 0.2.0) : le `capture` de `bin/cdp-render-worker.mjs` appelait auparavant une fonction jamais définie (la chaîne capture sur machine réelle échouait systématiquement, et la sonde à porte la masquait). Implémentation désormais d'un escalier de qualité JPEG (départ à 72, pas de 12, plancher à 24, dépassement de budget signalé honnêtement via `overBudget`) + sous-échantillonnage géométrique `scale.maxWidth` + chemins à tir unique PNG/sans budget ; `data` est renvoyé en base64 pour consommation par la chaîne de jugement JEV. Test réel : Chrome/153 connecté réellement, budget atteint du premier coup (attempt 1, q=72).
- **Ouverture du demi-`noImplicitAny` côté client** : `tsconfig.client.json` passe à `noImplicitAny: true`, les 401 implicit-any sont tous explicités (`scripts/fix-implicit-any.mjs` codemod de position précise + finitions manuelles) ; les annotations de types n'ont aucun effet à l'exécution, `client-input.test.ts` mis en synchronie par regex sur les sources.
- **Sondes à portes activées sur machine réelle** : sonde CDP remote (4/4) et sonde de rendu (1/1) exécutées avec succès contre un vrai Chrome/153 local — boucle discovery→attach→inspect→input→binding + chaîne de capture avec budget. cli-probe et login-import e2e restent attachés au runtime Linux vendored, portes maintenues (N/A sur cette machine).

### Changements
- **Rotation des peerDependencies (remplacement)** : les six `@deepseek-ai/dsh-client-locale` / `dsh-client-store` / `dsh-client-ui-settings-plugins` / `dsh-client-ui-slots` / `dsh-settings` / `dsh-tools` passent de `>=0.1.7-rc.1 <0.1.8-0` → `>=0.2.0-rc.1 <0.2.1-0` ; la ligne 0.1.7 est gelée et poursuit son service en 0.17.x, pour DSH 0.1.2-rc.1 ~ 0.1.7 utilisez 0.17.x.
- **`engines.dsh` synchronisé aux deux endroits** : le `engines.dsh` de premier niveau et le `dsh.engines.dsh` imbriqué passent tous deux à `>=0.2.0-rc.1 <0.2.1-0` (la barrière d'exécution ne lit que les peers, les métadonnées restent cohérentes).
- **Rotation des devDependencies** : `@deepseek-ai/dsh-tools` et `@deepseek-ai/dsh-sandbox` passent de la ligne 0.1.7 → `>=0.2.0-rc.1 <0.2.1-0`, le typecheck résout ainsi les types de l'hôte 0.2.0 — le « tout vert » prouve la compatibilité 0.2.0, pas un résidu 0.1.7.
- **Justification du zéro code** : le composer/`forkSession` de 0.2.0 est une extension de signature rétrocompatible, ce plugin livre ses sélections via la façade `ctx.get('conversation').input` (sans appeler `submit()`, sans contrat override), donc hors du périmètre d'impact.
- Badges/matrice de compatibilité des versions/notes d'adaptation du README réécrits dans la terminologie 0.2.0.

### Vérification
- Double typecheck tsconfig + build + vitest (656 passed / 11 skipped) contre `dsh-tools@0.2.0-rc.1`, tout au vert ; `npm ls` sans invalid ni conflit de peers.

### Divers
- `dsh-plugin.json` version 0.17.0 → 0.18.0 (ce champ était en retard sur le package.json, aligné au passage dans cette version).
- Arbre de dépendances reconstruit intégralement depuis npmmirror, `package-lock.json` régénéré et commité.

## [Unreleased] — Pipeline style JEV : DOM+capture+intention → jugement Laya/JEV (phase 10 / R5-R6, branche stage9-ego-cli)

### Ajouts
- **Pipeline style JEV (T10.1–T10.19)** : contrat de frame (capture d'écran + DOM numéroté + intention + progression des actions) + couture de jugement (ne renvoyer que des numéros, jamais de sélecteurs).
  - Worker de rendu `bin/cdp-render-worker.mjs` : client CDP à connexion unique, `attachPage()` (enable de `Page/Runtime/DOM/Accessibility` dans l'ordre M0.3), `gatherInteractive(limit)`, `captureWithinBudget()` (escalier de qualité JPEG + sous-échantillonnage + `overBudget` signalé honnêtement).
  - Trois primitives `noul`/`choice`/`score` (`src/jev/wire.ts`) + limites de protocole (`choice.criteria` non vide et ≤255, table vide rejette systématiquement, car un `criteria` vide est un 422 interprété à tort comme un échec du modèle) + `validateQuestions()` qui rapporte tout d'un coup + `THRESHOLD_BUCKETS`/`bucketFor`.
  - Couture de jugement `JudgeProvider` + chaîne de dégradation `jev → laya → rule → refuse` (**les indisponibles sont sautés sans appel**, chaque échec entre dans la trace ; `refuse` est un résultat, pas une exception).
  - Surface à quatre outils `bcdp_jev_status` / `bcdp_jev_frame` / `bcdp_jev_ask` (`dryRun` true par défaut, `round=control|chapter|pick` par niveaux) / `bcdp_jev_run` (trace pas à pas). `attachGate()` intercepte uniformément « pas de navigateur actif » ; `bcdp_doctor` gagne cinq lignes sur la chaîne de jugement.
  - Boucle `src/jev/loop.ts` : les six effets injectés, `BudgetLedger` vérifie avant de dépenser, terminaison à six états (dont `exhaustedKind`), ensemble d'exclusions structurellement effectif, seuil de recapture, `#PROGRESS` généré mécaniquement.
- **Priorité à laya (révision du 2026-09-24)** : par défaut `judgePrefer='laya,rule'` (sans jev, car JEV ne peut être enregistré) ; `jevUrl` vide signifie non participation. En l'absence de clé, `bcdp_jev_status` imprime le lancement local (`ENGINE=laya … uvicorn laya_api.main:app`, port 8000, `ALLOW_DEV_LOGIN=true`).
- **Chapitrage des actions (réduction en trois niveaux)** : le worker déduit de la chaîne parentale AX des `childIds` l'ancêtre structuré le plus proche comme chapitre (liste blanche `CHAPTER_ROLES`, numérotation par ordre de document au sein d'un même role : `form#1`/`form#2`) ; `control → chapter → pick`, la passe chapitre est sautée s'il n'y a qu'un seul chapitre ; seuils compartimentés par nombre de candidats (20 → « quelques × quelques », les deux tours tombent dans les cases strictes).
- **Isolation du contexte de jugement** : liste blanche à quatre segments `INTENT/PROGRESS/FRAME/HISTORY` + assertion post-assemblage `assertJudgeIsolation()` (tout titre majuscule nu est rejeté) ; `IntentStateInput` est structurellement sans champ session — **ce qui gouverne l'interface du navigateur ne porte pas le préfixe de session complet**.
- **Commutateur d'évaluation `jevEvaluate` (activé par défaut, commit `208ae38`)** : après chaque étape, jugement `inprogress/done/fail` ; `fail` ou « done non vérifié » → `escalate`, avec une liste ordonnée de `RecoveryOption[]` (`reload` en premier, un rendu périmé peut masquer une confirmation déjà écrite), dérivée par `recoveryFor(reason, lastAction)`.
- **Conservation du class des éléments manipulés (commit `f79a272`)** : quand `act` touche un élément unique, `DOM.getOuterHTML` est récupéré paresseusement puis normalisé via `bin/record-normalize.mjs` — les règles de réécriture sont permises, mais les traits de localisation comme `class`/`id`/`role`/`aria-*`/`data-testid` sont **conservés**, on ne taille que les tokens d'enveloppe de l'inspecteur (comme `trae-browser-inspect-draggable`) et le `style` ; le outerHTML complet entre dans `Escalation.actedOn` pour la récupération par le LLM, la référence compacte dans HISTORY.

### Vérification
- Tests complets : 630 passed / 11 skipped (sondes à portes) ; les deux `tsc` passent ; `lib/index.js` de 206 613 → 316 544 → 317 402 o (la preuve par les octets que les modules sont câblés).
- Garde-fous : `tests/worker-dispatch.test.ts` (affirme que `act/reload/scroll/fill` tombent tous sur des fonctions déclarées — précisément la classe de bug que `ed6eccf` a laissée passer en silence), `tests/record-normalize.test.ts` (cloue la conservation du class, la taille des tokens chrome, le maintien des attributs de localisation).

### Limites connues (honnêteté sans fard)
- **Pas encore de bout-en-bout sur machine réelle** (T10.22 à faire) : les tests unitaires couvrent protocole/seuils/terminaison/chapitrage/assemblage, pas la chaîne réelle.
- **Précision du jugement non mesurée** : les compartiments de seuils servent au calibrage, ils ne prouvent pas que les choix sont justes.
- **Liste blanche des chapitres non calibrée sur de vrais sites** : `CHAPTER_ROLES` est tiré de la table des rôles AX ; si un site met tous ses contrôles dans des `div` sans nom, tout retombe dans le chapitre unique `page`, dégradation au second niveau (dégradation connue, pas une erreur).
- **`render.ts` se rattache à chaque appel** : les connexions persistantes de type session exigeraient un contrat spawn reprenable de l'hôte, actuellement inexistant — le coût est documenté.

## [Unreleased] — Polymorphisme des types de connexion : objet de connexion CLI ego local (phase 9 / R7, branche stage9-ego-cli)

### Ajouts
- **Typage de la séquence de connexions** : `BrowserLink = CdpLink | EgoCliLink` (champ discriminant `kind: 'cdp' | 'ego-cli'`). L'ordre du tableau **reste la priorité**, `activeTargetId` peut pointer vers n'importe quel type.
- **Connexion CLI ego local** (`kind='ego-cli'`, **machine locale uniquement, au plus une globalement**) :
  - Chaîne de résolution du CLI à quatre niveaux : `cliPath` explicite → `ego-browser` du PATH → helper dans le paquet de l'app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime embarquée ;
  - **Détection de la forme de spawn** : exécution **directe** d'abord, repli sur `node <path>` en cas de `EACCES`/`ENOEXEC`/`ENOENT` (le vrai CLI est un exécutable dans le paquet de l'app, `ego-browser-v2`/la version embarquée est du JS — les deux formes existent réellement, deviner l'extension rendrait tout inutilisable) ;
  - **Pas d'injection de `EGO_LINUX_CDP_URL`** : cette variable n'appartient qu'au portage Linux embarqué, le CLI natif macOS ne la lit pas ; c'est précisément la raison d'être de ce type ;
  - **La sonde de disponibilité passe par un heredoc minimal** (le même canal `nodejs` que pour le travail réel) ; `--status` n'est qu'un raccourci **opportuniste** avec court timeout de 2 s (en cas de `unknown option` ou de non-JSON du CLI, dégradation silencieuse, **sans verdict d'échec**) ;
  - Cinq codes d'échec, **sans repli silencieux** : `cli-not-found` / `cli-not-executable` / `cli-probe-timeout` / `cli-probe-failed` / `cli-sdk-path-unsupported`.
- **`--sdk-path` comme capacité facultative** : non transmis par défaut (on utilise le harness officiellement apparié du CLI) ; si l'activation explicite est refusée (`unknown option`) → consigne `cli-sdk-path-unsupported` et **tentative automatique unique sans ce drapeau**.
- Nouveautés `bcdp_doctor` : `links: n (cdp x, ego-cli y)`, `cli: <path> (<origin>, shape <shape>)`, `naming: … legacy ego_* aliases OFF/ON`, et avertissement `conflict:` quand le plugin upstream est installé sur la même machine.

### Changements (Breaking)
- Clé de réglage `cdpTargets` → **`links`** (l'ancienne clé est lue en secours pendant une version, ses lignes équivalent à `kind='cdp'`, **zéro perte**).
- Combinaison `cdpMode='remote'` + élément activé étant un CLI local → `mode-kind-mismatch` explicite (fin du basculement silencieux vers un autre élément).
- La sémantique de `remoteEnabled` se resserre sur **le seul CDP distant** : les connexions CLI locales ne sont pas affectées.

### Corrections
- Le séparateur de chemins et le séparateur de PATH de `makeWhich` suivent désormais la **plateforme simulée** (auparavant les valeurs de l'hôte via `node:path` — une recherche darwin/linux sous Windows assemblait `dir\file` et ne trouvait jamais rien).

## [0.16.0] - 2026-09-23 — Bouclage de la phase 2b + interrupteur de désactivation douce du CDP distant

### Ajouts
- **Interrupteur général `remoteEnabled` (T2.18)** : désactiver temporairement le CDP distant sans supprimer la séquence de cibles — une fois coupé, la séquence est conservée intacte mais toute sonde et connexion distantes cessent ; les appels `bcdp_*` reçoivent une erreur explicite `remote-disabled` ; interrupteur visible dans la carte de réglages et dans `bcdp_doctor` ; réactivable à tout moment. Orthogonal à `allowLocalFallback` (une fois le distant coupé, auto peut retomber sur le lanceur local).
- **`cdpMode=local` branché sur le lanceur dédié (bouclage 2b)** : le mode local démarre désormais via M0.9 un navigateur géré et en injecte l'endpoint, la runtime embarquée s'y attache au lieu de démarrer à froid toute seule ; le caché est marqué `endpointSource: local`.
- **Deux nouvelles lignes dans `bcdp_doctor`** : `remote CDP: enabled/DISABLED` et `attach: <status> (source: …) @ <endpoint>` (complément de visibilité aux trois endroits, T2.16).

## [0.15.0] - 2026-09-23 — Lanceur de navigateur local (phase 2b / M0.9)

### Ajouts
- **Lancement local géré** : quand `allowLocalFallback` est actif et que l'endpoint activé est injoignable, démarrage automatique du Chrome/Chromium/Edge local (découverte explicite → table de candidats par plateforme), injection de `http://127.0.0.1:<port>` et poursuite du travail, le badge d'attachement indique `endpointSource: local-fallback` ; **retour inverse interdit**.
- **Réutilisation en singleton** (T2.13) : `launcher.json` consigne pid/port/profile ; seules les instances lancées par nous-mêmes et encore répondantes sont réutilisées.
- **Arrêt et récupération** (T2.14) : sous win32, `taskkill /T /F` tue l'arbre complet (0 orphelin mesuré) ; le reaper d'inactivité récupère au passage les instances locales.
- **Réglages** : `localHeadless`, `localUserDataDir` (par défaut `~/.dsh/cache/dsh-browser-cdp/chrome-profile`, jamais le profile quotidien).
- **Politique de ports** (T2.11) : un port libre est préalloué et passé explicitement, sans dépendre du mécanisme non vérifié DevToolsActivePort/port 0.
- **Résolution de conflit de libellés** : titre de l'onglet/du ballon de la fenêtre d'observation « Agent 浏览器 » → « CDP 浏览器 » (analyse dans findings A.5).

## [0.14.0] - 2026-09-23 — Références de sélection agrégées par page en blocs dictionnaire, avec la connexion CDP source

### Changements
- **Agrégation par page** : une référence ne porte que le contenu d'une seule page web — les éléments multiples d'une même page fusionnent dans **un même bloc**, les sélections sur d'autres pages produisent de nouveaux blocs.
- **Enveloppe dictionnaire** (par analogie avec les pièces jointes images pré-transformées en blocs) : le bloc dans le brouillon ressemble à
  `[CDP-PICKS page="…" targetId="…" endpoint="…"]` + JSON (`cdpEndpoint`/`targetId`/`pageUrl`/`pageTitle`/`elements[]`) + `[/CDP-PICKS]`.
- **Traçabilité de la source** : le bloc contient `cdpEndpoint` (le worker le déduit de `active.wsUrl` en retirant `/devtools/*`) + `targetId` ; chaque élément de `elements[]` porte un `backendNodeId` — `bcdp_cdp` peut interroger directement la structure DOM de l'élément via `DOM.describeNode({backendNodeId})` ; s'ajoutent `pageUrl`/`pageTitle`.
- worker : ajout de `PickElement.source` (`Target.getTargets` récupère les metadata de page + `getEndpoint` injecte la source de connexion).
- Continuité sémantique : pas d'envoi automatique (v0.13.0), continuation de la numérotation `n` sur une même page.

## [0.13.0] - 2026-09-23 — Livraison des sélections par références numérotées, suppression de l'envoi automatique

### Changements (Breaking)
- **Fini l'envoi automatique** : la voie submit() de « Ajouter à la conversation » est retirée entièrement — toute action de sélection ne fait qu'écrire dans le brouillon du champ de saisie, **l'envoi reste toujours entre les mains de l'utilisateur** (Entrée ou clic sur Envoyer).
- **Références numérotées** : chaque sélection s'ajoute au brouillon sous la forme `[pick N] <description de l'élément>`, N continue automatiquement la séquence des `[pick N]` déjà présents dans le champ — les sélections multiples forment une liste ordonnée.
- **La barre flottante passe à une seule action** : « Référencer dans la conversation (Ctrl+J ou ↵) » — les deux raccourcis sont équivalents, l'état confirmé affiche « ✓ Référencé dans le champ de saisie ».

## [0.12.0] - 2026-09-23 — Dé-egoïsation : identité de proxy navigateur CDP (phase 8)

### Changements (Breaking)
- **33 outils `ego_*` → `bcdp_*`** : `bcdp_status` / `bcdp_navigate` / `bcdp_doctor` … (préfixe dérivé de l'id du plugin, libre dans l'écosystème). Les scripts citant les anciens noms peuvent transiter par le nouveau réglage `legacyEgoToolNames: true` (enregistre en plus les alias `ego_*` ; mutuellement exclusif avec le plugin upstream ego-browser).
- **Routes HTTP `/api/ego/*` → `/api/bcdp/*`**, passerelle de réglages `/ego/api/*` → `/bcdp/api/*` (panneau synchronisé).
- **Renommage des ressources** : `bin/ego-cast-worker.mjs` → `bin/cdp-cast-worker.mjs`, `bin/ego-chrome-wrapper.sh` → `bin/cdp-chrome-wrapper.sh` (logiques de correspondance/nettoyage des processus worker synchronisées).
- **Clé de configuration** `egoCliArgs` → `runtimeArgs` (l'ancienne clé est lue automatiquement pendant une version, aucune perte de réglage).
- **Libellés** : l'auto-désignation du panneau EN/ZH unifiée en « CDP 浏览器代理 / CDP browser bridge », sans commencer par ego ; README synchronisé.
- Le câblage interne (variables d'environnement `EGO_LINUX_*`) et le nom du répertoire de la runtime vendored **ne changent pas délibérément** (sécurité des mises à niveau).
- Effet induit : **coexistence possible** avec l'upstream `Fisfzy/ego-browser` (noms d'outils/routes tous décalés).

## [0.11.1] - 2026-09-23 — Corrections : deux jugements erronés de l'état de sélection dans le panneau

### Corrections
- L'état intermédiaire `picked` du worker (capturé, en attente d'action) était jugé à tort comme un échec par le panneau, qui affichait « sélection échouée » — il affiche désormais correctement la description de l'élément.
- Quand le panneau s'armait, la base de comparaison des livraisons était alignée sur `picks`, ce qui avalait la livraison de la sélection faite **avant l'armement** — la base est décalée d'un cran, la sélection en attente d'action est nécessairement livrée.

# Changelog

Tous les changements visibles par l'utilisateur sont regroupés sous chaque numéro de version. Le format suit [Keep a Changelog](https://keepachangelog.com/), la sémantique des versions suit [SemVer](http://semver.org/).

## [0.11.0] - 2026-09-23 — Livraison M1.6 vers la conversation + voie de repli de sélection par coordonnées

### Ajouts
- **Livraison des résultats de sélection dans la conversation (M1.6 / T5.6–T5.7)** : les deux actions de la barre flottante de page écrivent désormais réellement dans la conversation — « Commenter dans la conversation » écrit la description de l'élément dans le brouillon du champ de saisie (l'utilisateur complète son commentaire et envoie lui-même) ; « Ajouter à la conversation » écrit dans le brouillon et **soumet automatiquement** (la même voie adjudication que le bouton d'envoi). Vérification de `phase === 'plain'` avant soumission ; une seule livraison par sélection ; le résultat (✓ envoyé à la conversation / ✓ écrit dans le champ / échec de livraison + raison) s'affiche en retour sur la ligne d'état de la fenêtre d'observation.
- **Voie de repli de sélection par coordonnées (T5.1b)** : en mode sélection, cliquer sur la capture en temps réel de la fenêtre d'observation = sélectionner — les coordonnées converties sont envoyées au worker, avec résolution du point touché par `DOM.getNodeForLocation` (sans dépendre du canal d'événements Overlay), en empruntant la même chaîne description/mesure/injection d'UI. Pris en charge dans la barre latérale comme dans la fenêtre flottante.
- Ajout au worker de `POST /api/pick/click {targetId, x, y}` ; le host relaie `/api/ego/pick/click`.

### Notes
- Un clic sur le vide qui échoue à toucher un nœud signale explicitement « sélection échouée (no-node-at-point) », sans retour silencieux à idle (fixtures de clics sur le vide, T5.8).

## [0.10.0] - 2026-09-23 — Socle CDP P0 + sélection d'éléments (corps R6) + Set-of-Marks (R4)

### Ajouts
- **Sélection d'éléments (corps R6)** : la barre d'outils de la fenêtre d'observation gagne un interrupteur « Sélectionner un élément » (un dans la barre latérale, un dans la fenêtre flottante, tous deux à gauche de « Ouvrir la page réelle »). Une fois activé, on sélectionne des éléments dans la vraie page choisie : cadre de sélection bleu ciel 2 px + barre flottante collée à l'élément, avec deux actions « Commenter dans la conversation Ctrl+J » / « Ajouter à la conversation ↵ », après quoi s'affiche sur place « ✓ Transféré à la conversation » puis repli en 2,5 s ; à la fin d'une action, le mode sélection se réarme automatiquement, les sélections en rafale ne réclament pas de retour au panneau. Changer d'onglet / fermer le panneau sort de la sélection et nettoie l'UI injectée.
- **Capture Set-of-Marks (mécanisme + passerelle R4)** : `POST /api/ego/marks` renvoie en un appel capture d'écran + carte numérotée des éléments interactifs dans l'ordre du document (filtrage de l'arbre AX, `n = 1..N`, avec rect de viewport et description sémantique sur une ligne), surlignage d'un élément unique en option. Implémentation purement CDP, zéro injection dans la page ; la carte numérotée est l'alternative à la contrainte d'Overlay qui ne peut surligner qu'un nœud à la fois (contrainte mesurée).
- **Socle de session CDP permanente (P0)** : sous `src/cdp/` — endpoint (normalisation/découverte des endpoints, 8 codes d'erreur structurés), session (appariement des id de commande/timeout par commande/reconnexion avec backoff/**rejeu de la séquence enable après reconnexion**), events (distribution par domaine/affinité des domaines avec état/ordre `DOM.enable → Overlay.enable`), dom, input (**aucun chemin d'écriture directe de `.value`**, revérification du point de clic), page (sémantique des coordonnées document pour le clip de capture, `highlightConfig` forcé dans le processus, `Runtime.addBinding`).
- **Sondes sur machine réelle** (déclenchées par `CDP_PROBE_URL`, ignorées par défaut) : découverte 19 ms → connexion 7 ms → commande 1–5 ms → retour binding 42 ms, preuve sur toute la chaîne.

### Notes
- **Frontière de livraison** : le « transféré à la conversation » de la barre flottante de page est pour l'instant un état UI ; le câblage côté hôte pour écrire dans le champ de saisie de la conversation (`conversation.input.for(actx).setDraft/submit`) n'est pas terminé, les résultats de sélection sont actuellement observables via `lastPick`/`lastAction` de `GET /api/ego/pick`.

## [0.9.1] - 2026-09-23 — Correction : cibles CDP disparaissant du panneau après enregistrement

### Corrections
- **Après un enregistrement réussi du panneau de réglages, toute la séquence de cibles CDP disparaissait de l'interface (les données étaient pourtant bien écrites)** : en reconstruisant le brouillon de réglages avec la config renvoyée par le serveur dans le callback de succès d'enregistrement, trois champs étaient oubliés — `cdpTargets` / `activeTargetId` / `cdpMode` (présents dans `load()`, absents de ce chemin). Après « ajouter une cible → renseigner l'endpoint → enregistrer », les cibles retombaient immédiatement à « aucune cible », alors que `~/.dsh/settings.yaml` contenait bien les bonnes cibles et le bon `activeTargetId`. Les trois champs sont complétés dans le chemin de succès d'enregistrement, alignés sur `load()`.
  > Note d'enquête : `ALLOWED_KEYS` côté `/ego/api/set` comme `sanitizeJsonArray` fonctionnaient normalement, le problème ne tenait qu'à la reconstruction du brouillon côté client, ni la passerelle ni le schéma ne perdaient de champs.

## [0.9.0] - 2026-09-23 — Séquence de cibles CDP + activation (R1) + nom de paquet unifié en dsh-browser-cdp

### Ajouts
- **Séquence de cibles CDP et activation (R1)** : nouvelles configurations `cdpTargets` (séquence ordonnée) / `activeTargetId` (activation mono-point) / `cdpMode` (`auto`/`local`/`remote`) / `cdpProbeTimeoutMs`. Chaque outil `ego_*` pilote **le** endpoint activé, et non le navigateur local.
- **Éditeur de séquence dans le panneau de réglages** : ajout/suppression/modification de cibles + tri vertical, activation par bouton radio, bouton « sonde » par entrée et badge d'accessibilité (statut temps réel en polling depuis `/ego/api/cdp-status`). La validation d'endpoint n'accepte que `http(s)://host:port` ou `ws(s)://…`, un schéma illégal produit une erreur explicite au lieu d'une interprétation silencieuse.
- **Chaîne d'activation explicite** : `resolveEgoEnv` injecte `EGO_LINUX_CDP_URL` selon `cdpMode` ; les changements de réglages (et le premier démarrage) déclenchent `refreshAttach` pour re-sonder l'endpoint activé, et quand l'endpoint change, `setAttachEndpoint` redémarre le cast worker pour qu'il se rattache au même navigateur. La table de décision `decideAttach` garantit qu'un échec ne retombe **jamais silencieusement** sur le navigateur local — sous `auto`/`remote`, sans activation ou si inaccessible, retour d'erreur structuré.
- **Nouveaux endpoints de la passerelle** : `POST /ego/api/cdp-status` (lecture de l'état d'activation en temps réel), `cdp-refresh` (re-sonde manuelle et rafraîchissement de l'attachement du worker), `cdp-probe` (sonde unique sur n'importe quel endpoint, résultat réécrit dans les champs `probe*` de la cible).
- **Nom de paquet unifié en `dsh-browser-cdp`** : `cordis.patch.yml`, `dsh-plugin.json` (`id`/`name`/Scene·SettingsSection id/namespace), namespace des réglages, id de la tab sidebar côté client (`dsh-browser-cdp:watch`), textes de locale et préfixes de logs tous alignés.
- **Publication du dépôt sur `github.com/drscrewdriver/dsh-browser-cdp`** : `package.json#repository` et `dsh-plugin.json#source` repointés du dépôt amont `Fisfzy/dsh-ego-browser` (MIT, attribution conservée) vers ce dépôt. Installation directe depuis GitHub prise en charge : `dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp` (pnpm tire le tarball via `codeload.github.com`, pas de publication au registre), possibilité de figer avec `#v0.9.0` / `#<sha>`.

### Tests
- Nouveau `tests/cdp-targets.test.ts` (26 cas) : `normalizeEndpoint` / `sanitizeTargets` / assistants de séquence / `probeEndpoint` (fetch injectable, sans lecture de l'horloge réelle) / `decideAttach` / `refreshAttach`+caché. Couverture complète des chemins d'analyse, de sonde et de décision de `cdp-targets.ts`.

## [0.8.5] - 2026-09-18 — Import d'état de connexion + récupération au ralenti + lot de corrections de la fenêtre d'observation

### Ajouts
- **Import d'état de connexion depuis le navigateur système (#46)** : nouvel outil `ego_login_import` + bloc « importer l'état de connexion depuis le navigateur système » dans la carte de réglages + route `POST /api/ego/login-import`. Copie par domaine des cookies de connexion du Chrome/Edge/Brave quotidien vers le navigateur de l'agent : démarrage headless du vrai binaire avec le vrai Profile (alias de jonction pour contourner la restriction CDP du répertoire par défaut de Chromium ≥136, tout en satisfaisant la liaison de chemin de l'App-Bound Encryption), lecture via CDP `Storage.getCookies`, filtrage, écriture dans le Profile persistant via `Storage.setCookies`. Prise en charge de `source/domains/profile/closeSource/dryRun` ; si le navigateur source tourne, fermeture gracieuse possible avant l'import (la fenêtre se rétablit au prochain démarrage) ; **sauvegarde automatique de la base de cookies source avant l'import, restauration automatique en cas de vidage détecté** ; les valeurs des cookies n'entrent ni dans les journaux ni dans les sorties.
- **Récupération automatique au ralenti (#47, opt-in)** : nouveau réglage `idleTimeoutMin` (0 par défaut, désactivé). Après N minutes sans appel `ego_*`, arrêt gracieux `--stop` du navigateur en arrière-plan (environ 425 Mo mesurés au ralenti), démarrage à froid de 2 à 4 s à l'appel suivant. Regarder la fenêtre d'observation ne compte pas comme une activité (mention ajoutée au texte des réglages).
- **Bouton « Pop-out » de la fenêtre d'observation (#51)** : la fenêtre flottante et la tab de la barre latérale gagnent un bouton qui appelle le runtime `ego-browser --open` — l'instance headless est remplacée sur place par une fenêtre avec interface du même Profile (onglets conservés), une instance avec fenêtre est portée au premier plan. La conclusion que la prévisualisation CDP du mode headless est déjà utilisable a aussi été vérifiée en pratique.

### Corrections
- **Capture du viewport toute blanche après défilement (PR #50)** : l'origine du clip de `Page.captureScreenshot` est en coordonnées document ; la capture du viewport était fixée à `{x:0,y:0}`, et après défilement le clip tombait dans une zone non peinte (`captureBeyondViewport: false`), d'où une image vide. On utilise désormais `pageInfo().sx/sy` (`scrollX/scrollY`) comme origine du clip ; le boundingBox de viewport du locator reçoit aussi le décalage de défilement, aligné sur le followClip de `spaces-server`.
- **Le lien externe de la conversation était capté par la fenêtre d'observation et ne s'affichait pas (#48)** : la déclaration `urlTarget` de la tab de la barre latérale était trop large (elle revendiquait tout http(s)) alors que cette tab n'est qu'une image de streaming. Déclaration retirée, les liens externes reviennent à l'onglet browser intégré.
- **Après redémarrage du navigateur, tous les `ego_*` signalaient task space not found** : l'id numérique d'espace mémorisé côté plugin restait en suspens après le redémarrage. Ajout de `runWithStaleSpaceRetry` : à la détection de cette erreur, reconstruction automatique par nom d'espace et une seule reprise (couverture complète des outils d'action + ego_cli/ego_captcha/ego_script).
- **En multi-sessions, la fenêtre d'observation s'ouvrait dans la mauvaise session (#53, PR #54)** : `markEgoToolCall` transporte l'id de la session appelante, l'ouverture automatique localise la barre latérale par session ; la garde à usage unique devient par session, le flux de détection reste permanent.

### Communauté
- Fusion des PR #50 (correction de capture, hpqc032), #52 (i18n anglais de la fenêtre d'observation, M4cd1r ; nous avons ajouté une correction de valeur par défaut `wt()` pour rétablir le typecheck), #54 (portée de session, xiaochaZ).

## [0.8.4] - 2026-09-15 — Corrections de la chaîne de démarrage du worker de la fenêtre d'observation + fusions de PR communautaires

### Corrections
- **La fenêtre d'observation ne démarrait jamais sous DSH ≥ 0.1.5 (#34 / #38 / #43)** : le spawn du worker manquait du `cwd` obligatoire pour le provider subprocess de 0.1.5, et l'exception était avalée par un `catch` nu, de sorte que `ensureWorker()` renvoyait toujours null. `cwd` ajouté.
- **Le worker se suicidait au démarrage (défaut 2 de #34 / #40)** : la correspondance par sous-chaîne lâche de `stopSiblingWorkers()` prenait le subprocess runner de DSH pour un worker pair, et `taskkill /T` tuait en bloc son propre arbre de processus, le worker mourant avant d'avoir écrit `ego-cast.json`. La correspondance est resserrée sur « le paramètre de script direct de node est ego-cast-worker.mjs », avec exclusion de sa propre chaîne d'ancêtres.
- **Sur l'hôte Electron (DSH Desktop), tous les `ego_*` signalaient no @@DSH_RESULT@@ (#42)** : quand un env explicite était passé au spawn, `ELECTRON_RUN_AS_NODE` manquait et le processus fils démarrait comme une seconde application Electron. `resolveEgoEnv` et le spawn du worker ajoutent automatiquement `ELECTRON_RUN_AS_NODE=1` quand `process.versions.electron` existe.
- **Réponse vide de /api/ego/stream quand le worker est tombé (#39, PR #44)** : `proxyWorkerStream(-1)` court-circuite en SSE silencieux (écrit l'en-tête `text/event-stream` puis reste silencieux en longue connexion), sans déclencher le `ERR_SOCKET_BAD_PORT` qui arrachait la connexion ; avec 42 lignes de nouveaux tests.
- **Sous Windows, EGO_LINUX_HEADLESS était silencieusement ignoré (#35)** : le `EGO_LINUX_HEADLESS=1` explicite prime désormais sur l'inférence par défaut `hasDisplay=true` de win32, en cohérence avec l'aide CLI / la documentation README.
- **Démarrage web du client entièrement bloqué sur hôte sans dsh-better-sidebar** : la liste statique d'inject du client retire `betterSidebar` (le loader attendrait indéfiniment le service absent), remplacée par une détection via `ctx.get` + montage immédiat de la boule d'observation flottante + promotion en tab de barre latérale via `ctx.inject` quand le service apparaît (merci au schéma du PR #45).

### Ajouts
- **Interrupteur d'isolation en sandbox des espaces de tâches `isolateSpaces` (PR #31)** : désactivé par défaut, les espaces de tâches réutilisent le Profile persistant sur disque et l'état de connexion survit aux redémarrages (couvre la demande #1) ; une fois activé, on retrouve l'isolation en sandbox mémoire. Les descriptions des outils `ego_space_open`/`ego_space_close` s'injectent dynamiquement selon le mode ; correction de l'impossibilité de persister les réglages booléens de la passerelle.

### Divers
- Correction du gabarit `allowBuilds` non renseigné dans `pnpm-workspace.yaml` qui rendait l'install impossible sous pnpm 11 ; ajout d'un fixture de config pour `isolateSpaces` dans les tests.
- Fusion des PR #36 (matrice de compatibilité des versions du README), #31, #44 ; fermeture du #45 déjà couvert.

## [0.8.3] - 2026-09-07 — Compatibilité DSH 0.1.2-rc.1 + corrections sécurité/stabilité

### Sécurité
- **Correction des routes `/api/ego/*` sans authentification** : les routes exactes étaient touchées avant la barrière de confiance du préfixe `/api` de l'hôte, si bien que `GET /api/ego/stream` laissait sortir des frames en direct sans identifiants et que `POST /api/ego/input` permettait de soumettre des entrées sans identifiants (pilotage intersites). Enveloppement uniforme de webServer.register : toutes les routes ego exigent un cookie `dsh-auth-*` SameSite=Strict, que les pages malveillantes ne portent naturellement pas ; la garde ne s'applique qu'aux routes du plugin lui-même, sans polluer les enregistrements des autres plugins sur le singleton de l'hôte.

### Corrections
- **Échec de démarrage du client sur hôte sans dsh-better-sidebar (#29)** : le `inject` déclaré en dur et l'accès nu à la propriété `ctx.betterSidebar` levaient « without inject » sous resolver strict. La déclaration est conservée (c'est une condition de résolution) + l'accès est enveloppé dans try/catch avec passage explicite du paramètre — un hôte sans sidebar retombe sur la boule flottante au lieu de tout figer.
- **Régression de démarrage à froid sous Windows** : le support Xvfb de #22 faisait passer la valeur par défaut de headless à démarrage de Xvfb en l'absence de `DISPLAY`, alors que Windows a une session de bureau et pas de Xvfb → échec de démarrage « no X display / no Xvfb binary ». `ensureXDisplay` et `hasDisplay` de l'entrée gagnent une branche win32 (session de bureau considérée comme display, les fenêtres avec interface s'ouvrent directement, retour au comportement d'adaptation de v0.4.0).
- **Liste blanche des réglages de la passerelle sans `egoCliArgs`/`chromeArgs`** : `/ego/api/set` abandonnait silencieusement ces deux champs de configuration, impossibles à persister — ajoutés à `ALLOWED_KEYS`.

### Fusions (PR communautaires + local)
- Fusion de 6 PR communautaires : `#20` exécution root, `#22` xvfb, `#16` détection headless macOS, `#24` correction schemastery `link:`, `#28` compatibilité DSH 0.1.2-rc.1/v0.1.3-alpha.1 (peer/engines resserrés), `#13` stabilité Windows.
- Correction de l'erreur de syntaxe JSON du manifeste causée par une virgule manquante dans dsh-plugin.json (source du blocage d'indexation dans les annuaires).
- Ajout du LICENSE MIT ; compléments de la note chaîne d'approvisionnement/permissions ; les `*.map` ne sont plus suivis.
- Audit officiel build-dsh-plugin passé : `status: READY_FOR_PINNED_SOURCE_VERIFICATION`, `route: direct`, `blockers: 0`.

### Compatibilité
- `engines.dsh: >=0.1.2-rc.1` ; peer dependencies toutes verrouillées `>=0.1.2-rc.1`.
- Installation, démarrage, appel réel `ego_navigate` et acceptation du panneau d'observation en direct validés sous DSH 0.1.2-rc.1 (Windows/web profile) ; `0.1.2-alpha.x` déclarés installables mais non testés ; `<0.1.2-rc.1` → utiliser v0.8.0 et antérieures.

## [0.8.1] - 2026-08-28 — Compatibilité DSH 0.1.2-alpha.1

### Changements
- **Migration du demi-corps client vers `@deepseek-ai/dsh-client-store`** : 0.1.2-alpha.1 renomme `@deepseek-ai/dsh-client-runtime` (y compris le sous-chemin `/client`) en `@deepseek-ai/dsh-client-store` (le graphe de modules client utilise le nom de paquet nu comme id de module statique). La signature de `createSnapshotStore` ne change pas.
- **Id d'enregistrement du module client = nom de paquet déclaré `dsh-ego-browser`** : en 0.1.2, l'id des lignes du boot manifest est généré d'après le `name` du package.json, et le nom de spécification de ligne du loader doit coïncider (vérification d'égalité du nom `nearestPackage`) ; un montage par alias (clé de chargement de jonction `@dsh-external/ego-browser`) est jugé « not a client row » par le scanner → le panneau d'observation disparaissait silencieusement. Le banner ID de tsdown et le nom de ligne de `cordis.patch.yml` sont unifiés au nom du paquet déclaré ; le `dsh-ego-browser` du `dsh-plugin.json` reste inchangé.
- **`dsh.client.inject` ne déclare que les vraies lignes du graphe** : en 0.1.2, `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots` sont des modules statiques (hors du graphe de modules) ; les déclarer comme arêtes d'injection laissait l'entrée en pending silencieux (module non matérialisé, panneau non monté, aucune erreur). Ne restent que locale / ui-settings-plugins, les deux vraies lignes du graphe.
- **Le service optionnel webServer passe à la livraison par injection imbriquée** : le résolveur strict de services de 0.1.2 renvoyait undefined pour `ctx.get('webServer')` sans déclaration d'injection → routes d'observation `/api/ego/*` silencieusement non enregistrées → couche de données du panneau en 401/état vide. Passage à `ctx.inject(['webServer'], cb)` (routes enregistrées seulement quand le service est là ; les hôtes TUI/headless sans serveur web restent tools-only sans blocage).
- **Peer dependencies alignées sur la famille 0.1.x** (client-locale / client-ui-slots / client-ui-settings-plugins / dsh-settings / dsh-tools déclarés `>=0.1.1-rc.2`), `engines.dsh: >=0.1.2-alpha.1`.
- Vérifié après corrections : modules client normalement matérialisés, tab sidebar « Agent 浏览器 » et flux d'observation/prise de main opérationnels, routes `/api/ego/*` en 200, streaming en direct sur `streaming`, chaînes de clic/saisie sur l'image joignables (pointerdown → `/api/ego/input` → dispatch CDP).

## [Unreleased]

Double pipeline d'images pour la fenêtre d'observation : correction de la cause racine du protocole CDP, ajout d'un backend optionnel FFmpeg H.264/fMP4.

### Ajouts / améliorations
- **Paramètres de démarrage personnalisés** : la carte de réglages gagne deux champs, « paramètres CLI ego-browser additionnels » et « paramètres de lancement Chrome additionnels ». Les premiers s'ajoutent à l'argv de `ego-browser nodejs` et prennent effet dès le prochain appel d'un outil `ego_*` ; les seconds sont pontés via `EGO_LINUX_EXTRA_ARGS` vers le `launch()` de la runtime vendored, avec effet seulement au prochain démarrage à froid du navigateur (le navigateur est un singleton résident — il faut `ego-browser --stop` ou un redémarrage de DSH pour qu'il redémarre). Les deux côtés black-listent les flags qui briseraient le plan de contrôle auto-géré du plugin (`--status`/`--stop`/`--help`/`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` etc.) ; pour `--proxy-server`, passez par `EGO_LINUX_PROXY`. `ego_doctor` rapporte les paramètres actuellement en vigueur.
- FFmpeg passe à une installation explicite à la demande : CDP ne dépend plus de `ffmpeg-static` et ne l'installe plus. La page de réglages détecte d'abord le chemin personnalisé, le PATH système et le caché géré ; l'option FFmpeg est désactivée tant que la vérification de compatibilité n'est pas terminée, avec un téléchargement en un clic à version fixe et vérification SHA-256.
- Nouveau `githubMirror` : remplace `https://github.com` par la base HTTPS renseignée par l'utilisateur ; tag de release BtbN figé sous Windows/Linux, assets de plateforme figés sous macOS. Le téléchargement entre dans un répertoire temporaire de `~/.dsh/cache/ego-browser/ffmpeg/`, la publication atomique n'a lieu qu'après vérification, décompression et probe de capacité toutes réussies.
- L'image d'observation gagne un proxy de saisie clavier partiel : texte normal et collage via `Input.insertText`, l'IME chinois est envoyé en une fois après la fin de composition, les touches de contrôle et les raccourcis via `Input.dispatchKeyEvent`. Le focus n'est pris qu'après un clic sur l'image d'observation, sans voler la saisie de DSH lui-même.
- Nouveau réglage `ffmpegBitrateKbps` (500-20000 kbps) ; valeurs par défaut 2000/4000/8000 kbps pour bas/équilibré/haut. L'encodeur utilise le débit cible, le débit de pointe et le tampon VBV, remplaçant la valeur par défaut d'environ 200 kbps de `h264_mf` et le `libx264 crf=28`.
- La fenêtre DSH passée en arrière-plan ne rompt plus watch/SSE/video ; le TTL de lease monte à 120 secondes, et les requêtes start/switch/renew sont dédupliquées en single-flight pour éviter que la limitation des minuteurs en arrière-plan ne pérenne la capture ni n'alterne sans fin `starting`.
- `CaptureManager` + lease du watcher : un seul backend actif et une seule cible regardée à la fois ; la capture s'arrête quand le panneau est masqué.
- Le backend CDP distingue correctement l'ID d'ACK de frame et la session flattened du target, les erreurs de protocole sont visibles ; 20 FPS par défaut, limitation latest-frame, garde-fou à target unique, suppression du repassage forcé des animations transparentes.
- Backend FFmpeg : Windows utilise `gfxcapture(hwnd)` pour capturer directement la surface D3D11 de la fenêtre Chrome, les autres plateformes gardent le crop de la source d'affichage ; encodage en H.264 fragmented MP4, lecture via HTTP binaire et MediaSource, isolation des données des anciens processus par generation.
- Nouveaux réglages : `captureBackend`, paliers de qualité, FPS CDP/FFmpeg, largeur maximale et encodeur ; migration centralisée des anciens champs.
- Nouveaux tests unitaires : parseur MP4, ACK CDP, CaptureManager, migration de configuration, argv par plateforme.

### Limites de plateforme
- Windows exige que FFmpeg inclue `gfxcapture` ; le HWND est apparié par PID du navigateur, titre du target et limites de fenêtre CDP ; la page cible reste capturée même si la fenêtre est couverte ou déplacée, et le retour à `gdigrab desktop` est interdit. Le comportement en fenêtre réduite reste décidé par Windows Graphics Capture.
- Linux X11 utilise `x11grab`, macOS `avfoundation` en crop d'écran ; occlusion et permissions système affectent toujours ces deux plateformes.
- Wayland : si le FFmpeg embarqué n'a pas d'entrée Portal/PipeWire utilisable, erreur explicite `unsupported-ffmpeg-pipewire`, pas de `kmsgrab` root, pas de basculement silencieux vers tout le bureau ni de façade de réussite.

### Corrections
- **Souris parfois totalement sans requête / clavier toujours inutilisable** : le plan de contrôle ne dépend plus de `streamState` ni de la synchronisation spaces, il n'envoie que selon le target de l'image courante ; le worker conserve la validation finale des targets périmés. Auparavant le frontal n'avait aucun écouteur clavier ni support protocole — le chemin complet text/keyDown/keyUp est comblé dans cette version.
- **FFmpeg en marche mais la tab affichait CDP** : l'état de capture est désormais unifié depuis le SSE, la réponse watch, les spaces capture et watch/status ; en l'absence de backend, la valeur courante est conservée, l'écrasement par défaut vers CDP est interdit.
- **Fenêtre about:blank résiduelle après `space_open`** : l'espace de tâches ouvert avec succès devient l'espace le plus récemment actif ; les outils suivants qui omettent `space` (navigate/click/fill etc.) réutilisent cet espace au lieu de retomber sur le `dsh-agent` fixe en créant une seconde fenêtre. À la fermeture de l'espace actif, retour aux valeurs par défaut de la configuration.
- **watch/start 502 et input 500** : la sonde de capacité du binaire FFmpeg et de `gfxcapture` passe en sous-processus asynchrone, la santé du worker n'est plus bloquée pendant le démarrage ; le délai de proxy du worker pour watch start/switch monte à 30 secondes, couvrant le plafond complet de la fenêtre, de l'encodeur et de l'init MP4. Le host transmet tel quel le statut HTTP du worker et l'erreur JSON, et ne renvoie 502 que si le worker est réellement injoignable. L'entrée est validée côté client et côté worker ; un target invalide renvoie 409 `capture-target-stale`, plus enveloppé en 500.
- **FFmpeg sélectionné dans les réglages mais la tab montrait toujours CDP** : quand plusieurs fibres chargeaient le plugin en même temps, le pont de réglages enregistré plus tard, en présence d'un namespace dupliqué, retombait à tort sur une composition de config vide, et le cast worker recevait `captureBackend:auto`. Désormais un même scope unique est partagé pour le service de réglages ; la carte de réglages, la passerelle et le cast-server lisent toujours la même configuration persistée. Un worker au ralenti qui reçoit une mise à jour de configuration publie immédiatement le nouvel état du backend, sans garder l'ancien étiquetage CDP.
- **FFmpeg sous Windows ne filme plus la fenêtre de premier plan de l'utilisateur** : auparavant les paramètres étaient fixes — `gdigrab ... -i desktop` — avec un recadrage par coordonnées de page seulement au démarrage, si bien que dès que Chrome passait en arrière-plan, DSH ou une autre application recouvrant la zone partait au streaming. Désormais le target est d'abord résolu en HWND via `Browser.getWindowForTarget` et l'énumération des fenêtres de premier niveau Win32, puis `gfxcapture` capture la surface de la fenêtre isolée ; les différentes fenêtres Chrome des différents espaces de tâches se voient attribuer des HWND distincts. Une tab en arrière-plan de la même fenêtre renvoie `ffmpeg-target-not-visible`, sans montrer la mauvaise tab ni voler le focus.
- L'encodage Windows privilégie le chemin matériel D3D11 de `h264_mf` ; la sonde d'encodeur utilise un pipeline réel à HWND, pour éviter que l'image de test logicielle ne juge faussement l'encodage matériel indisponible. `fps/setpts` explicites fixent 30 FPS, le fragmentage fMP4 descend à 100 ms, et `skip_trailer` évite l'erreur de parseur `mfra` lors des arrêts gracieux.
- **L'état de connexion survit aux redémarrages de DSH (fidèle à la philosophie de l'ego-lite d'origine)** : auparavant, après un redémarrage manuel / un arrêt forcé de DSH il fallait se reconnecter — à la réception de SIGTERM/SIGINT le worker ne faisait que détacher sans écrire sur disque, et la grâce de 4 s du `--stop` de la désinstallation du plugin ne suffisait pas, tombant souvent dans le repli de crash SIGTERM. Désormais, avant de s'éteindre, le worker envoie au navigateur un CDP `Browser.close` (fermeture gracieuse, le journal des cookies est fusionné dans le profile sur disque), et la grâce du teardown du plugin monte à 8 s, assez pour fermer gracieusement jusqu'au bout. **Vérifié en pratique** : après redémarrage gracieux, la connexion est intégralement conservée ; après arrêt forcé (SIGKILL), l'état de connexion longue durée est lui aussi écrit sur disque et relu au redémarrage.

### Refonte d'ingénierie
- **Migration JS pur → TypeScript (PR #14)** : les sources déménagent de `lib/` vers `src/` (`src/index.ts` couche outils, `src/client/index.ts` frontend, `src/worker/ego-cast-worker.ts` worker), `lib/` et `bin/ego-cast-worker.mjs` deviennent des artefacts de build (précompilés et versionnés). La chaîne de build devient `pnpm typecheck` (barrière de types tsc, tsconfig.json + tsconfig.client.json) + `pnpm test` (vitest) + `pnpm run build` (trois bundles tsdown). Les tests migrent en parallèle de `tests/*.test.mjs` vers `.test.ts` avec ajout de `vitest.config.ts`. `lib/` ne se modifie plus à la main.

## [v0.8.0] - 2026-08

Intégration de la tab sidebar : quand `dsh-better-sidebar` est disponible, la fenêtre de consultation en direct s'enregistre comme tab natif de la sidebar plutôt que comme fenêtre flottante.

### Ajouts
- **Intégration de la tab dsh-better-sidebar** : `apply()` sonde opportunément le service sidebar via `ctx.get('betterSidebar')` (et non `ctx.betterSidebar` — cela exigerait une déclaration `inject`, ferait du sidebar une dépendance dure et empêcherait tout le plugin, carte de réglages comprise, de se charger en son absence) ; si disponible, enregistre via `registerTab()` une tab `ego-browser:watch` (`single: true`, résident), sinon retombe sur la fenêtre flottante d'origine. C'est le mode documenté de consommation de services optionnels de DSH (voir la note approval-seam, le postmortem 0001).
- **Ouverture automatique de la tab au premier appel d'un outil `ego_*`** : les chemins execute de `defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` appellent `markEgoToolCall()` pour incrémenter le compteur côté host, compteur diffusé avec la réponse de `/api/ego/spaces`. `LivePreviewController` détecte le saut 0 → >0 et appelle `ctx.get('betterSidebar').openTab({ type: 'ego-browser:watch' })`, la tab se déploie automatiquement. Le drapeau `autoOpened` garantit une seule ouverture par session.
- **Composant de tab React `EgoBrowserTab`** : rendu du contenu de la tab sidebar avec `React.createElement` + `bindSnapshotSelector` (en-tête / barre d'onglets / vue principale en direct / couche historique / bandeaux d'invite login et captcha). La trace de navigation passe du tiroir latéral au mode couche superposée (le bouton d'historique prend le contenu entier de la tab, cliquer une entrée entre en prévisualisation ou retourne au direct), adapté à la faible largeur de la sidebar.
- **Classe vanilla `LivePreviewController`** : extraite du code DOM impératif de la fenêtre flottante — polling / SSE / caché de frames / zoom / mappage inverse des coordonnées d'entrée / suivi automatique — pour que le composant React s'y abonne via `subscribe`+`getSnapshot` et transmette les événements pointer/wheel par appels de méthodes. Le contrôleur tient directement la ref du `<img>` pour remplacer `src` sur place à la fréquence de fusion rAF, sans déclencher un re-rendu React à chaque frame.
- **`dsh-better-sidebar` n'est pas listé comme peer dependency** : consommation opportuniste via `ctx.get()`, sans déclaration `inject`, donc sans peer à déclarer. Avec le sidebar installé, tab ; sans lui, retour à la fenêtre flottante — les deux déploiements restent propres.

### Choix de conception (dits franchement)
- **Hybride plutôt que réécriture totale** : React tient la structure d'UI (en-tête / onglets / bandeaux / couche historique), le contrôleur vanilla tient le pipeline de frames temps réel (SSE / fusion rAF / mappage inverse des coordonnées / transmission des entrées). Environ 1000 lignes de logique de streaming fragile n'ont pas été réécrites en hooks React, pour limiter le risque de régression.
- **Historique en couche superposée** : le tiroir latéral de la fenêtre flottante donnait deux colonnes étroites à la faible largeur de la sidebar (~300-400 px) ; la couche superposée exploite le mieux l'espace.
- **Condition de course (connue, acceptée)** : si `dsh-better-sidebar` se charge après ego-browser, `ctx.betterSidebar` peut encore valoir `undefined` au moment où `apply()` tourne, et l'on retombe sur la fenêtre flottante. Le chargeur de modules de DSH charge généralement dans l'ordre des dépendances, et le sidebar, plugin d'UI de base, se charge en premier ; sinon, un simple rafraîchissement de page suffit.
- **Le code de la fenêtre flottante est conservé tel quel** : `mountFloatingWatch()` est le déplacement mécanique du corps d'effet d'origine, sans changement de logique, garantissant une expérience identique à 0.7.x en l'absence de sidebar.

## [v0.7.1] - 2026-08

Version de correction : un seul `ego_space_open` n'ouvre plus deux fenêtres de navigateur.

### Corrections
- **`ego_space_open` n'ouvre plus deux fenêtres de navigateur** : auparavant, au lancement, `"about:blank"` était passé en paramètre positionnel, ce qui ouvrait une tab résiduelle dans le browser context par défaut ; or `ego_space_open` passe par `useSpace+ensureRealTab`, qui ouvre une autre tab dans son propre browser context — Chrome isole les contextes différents dans des fenêtres distinctes, d'où deux fenêtres visibles. Désormais `LAUNCH_FLAGS` gagne `--no-startup-window` et `launch()` ne passe plus d'URL positionnelle : le démarrage se fait à zéro tab ; la première tab est créée par `ego_space_open` (ou tout outil structuré `ego_*` passant par `useSpace+ensureRealTab`) dans son propre contexte — c'est la seule fenêtre que voit l'utilisateur. Le vieux commentaire prétendait que `--no-startup-window` casserait toutes les opérations `page.*` — c'était la conclusion d'avant l'introduction du routage `useSpace+ensureRealTab`, désormais invalide pour les outils structurés. **Régression connue (acceptée)** : dans `ego_cli` / `ego_script`, si le heredoc appelle directement `page.*` sans passer d'abord par `taskSpaces.useOrCreate`, une erreur `"no active tab to attach session"` est levée — le message est clair, et l'usage recommandé n'est pas affecté.

## [v0.7.0] - 2026-08

Mise à jour mineure : effet de respiration de la lampe d'état de la fenêtre d'observation + gestion mémoire du frontend + corrections de timeout des outils et de multiplateforme.

### Ajouts
- **Effet de respiration de la lampe d'état de la fenêtre d'observation** : le point vert du badge du FAB reste allumé en vert quand l'agent pilote réellement le navigateur (`busy`), et respire au ralenti (halo vert périodique de 2,4 s) ; le point d'état « consultation en direct » du panneau suit la même logique busy/respiration. L'ancienne sémantique « busy=jaune, idle=vert » est inversée en « vert au travail, respiration au repos ».

### Corrections
- **Le paramètre `timeoutMs` de `ego_script` était ignoré** : le timeout par exécution déclaré dans le schéma n'a jamais pris effet, toutes les exécutions usaient du délai de grâce par défaut de 15 s du plugin. Désormais `timeoutMs` traverse `runEgoScript` et agit réellement, avec retour à la valeur par défaut en cas d'absence ou d'invalidité.
- **Gestion mémoire du frontend** : `frameCache` de la fenêtre d'observation (le dernier JPEG dataURL de chaque tab) et `pageMeta` s'accumulaient sans limite par `targetId`, une fuite lente au fil des longues sessions/multiples tabs. Désormais le caché des tabs fermés est élagué selon la table des tabs vivants, et `frameCache` reçoit un plafond `MAX_CACHED_FRAMES=12` avec priorité aux plus anciens.
- **Le repli du répertoire utilisateur codé en dur `/root` passe à `os.homedir()`** : dans la détection des chemins d'état, le répertoire utilisateur POSIX par défaut passe du `/root` fixe au `os.homedir()` correct multiplateforme, supprimant le piège pour les environnements non root/conteneurs.

### Ingénierie
- Ajout de `.gitattributes` : sauts de ligne LF unifiés (`* text=auto eol=lf`), éliminant les soubresauts CRLF de l'arborescence de travail dus à `core.autocrlf` sous Windows et les faux diagnostics de diff/cp.

## [v0.6.1] - 2026-04

Version de correction : chaîne d'auto-réparation + stabilité du worker de la fenêtre d'observation, utilisabilité de la barre d'onboarding du panneau.

### Corrections
- **La désinstallation du plugin ne bloque plus la sortie de l'hôte / ne casse plus l'auto-réparation** : le teardown de `ctx.effect` passe de `await ego-browser --stop` (15 s de grâce, qui retenaient la sortie de l'hôte) à fire-and-forget — l'hôte peut être relevé proprement par `dsh-web-guard` en 10 s et le turn interrompu peut se poursuivre automatiquement.
- **Guard d'instance unique du worker de la fenêtre d'observation + nettoyage des états périmés** : le même `ego-cast-worker.mjs` pouvait être lancé à la fois depuis le répertoire d'installation et depuis un clone de dev, et `ensureWorker` relançait un autre worker quand le pid connu était mort — `ego-cast.json` pointait alors sans cesse vers un worker mort/en retard et le panneau perdait le streaming. Désormais, au démarrage, le worker énumère et arrête les autres processus homonymes (via `powershell -EncodedCommand` sous Windows, `ps` en POSIX), supprime le `ego-cast.json` périmé, et fait de son `{port,pid}` la seule autorité.
- **Barres d'onboarding de connexion/captcha fermables manuellement** : ajout d'un bouton × ; les deux barres s'affichent en exclusivité mutuelle (captcha prioritaire), plus de « impossible à fermer » ni de « double barre comprimant l'image ».
- **La fenêtre d'observation suit activement la page en cours d'opération de l'agent** : auparavant le panneau prenait « le dernier re-dessin » (lastActive) pour la page courante, les re-dessins des pages d'animation/vidéo en arrière-plan volaient la vue, et l'écran principal ne sautait pas quand l'agent changeait de page. Désormais le worker obtient via DevTools `/json/list` la tab active MRU du navigateur (même jugement que `tabs.mjs` du runtime ego), la marque `active: true` et la place en premier dans `/api/spaces` comme dans le SSE ; le suivi automatique du frontal ne suit que la page active et ignore les frames des re-dessins en arrière-plan.

## [v0.6.0] - 2026-04

Assainissement de la santé du code (convergence d'ingénierie).

- Élimination de la bombe d'écrasement de build : suppression de l'ancien `src/` (561 lignes de version périmée) et de `tsconfig.json`, établissement de **`lib/` comme unique source d'autorité**. `npm run build` passe de « compilation tsc de src→lib (l'ancienne version écrasait, tous les outils disparaissaient) » à « vérification syntaxique de `lib/` (`node --check`) ».
- Unification de l'enregistrement des outils : `ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` passent au chemin `withEgoLock` + reprise au démarrage à froid des autres outils (sécurité de concurrence).
- Fin du fork : les nouvelles capacités (capture des téléchargements, détection de captcha, 30+ outils) font foi avec `lib/`.

## [v0.5.0] - 2026-04

Streaming en temps réel + manipulation directe du navigateur depuis la fenêtre de surveillance.

- Correction du bug majeur du streaming en temps réel : `screencastFrame` lisait le mauvais champ, les frames en direct n'ont jamais réellement transité par le SSE. Corrigé — les pages dynamiques approchent 10 à 30 images/s.
- Le transfert en streaming de cast-server passe à `node:http` (le bufferisation des réponses chunked par fetch retardait la première frame).
- La souris de la fenêtre de surveillance manipule directement le navigateur de l'agent : défilement à la molette, clic/drag sur le vrai navigateur (`/api/ego/input` → CDP `Input.dispatchMouseEvent`), Ctrl+molette pour zoomer, Ctrl+drag pour déplacer, double-clic pour réinitialiser, coordonnées en mappage inverse sur le viewport réel avec correction de letterbox.
- Nouveau `/api/ego/stream` (SSE) : frames en temps réel + liste de pages.
- Barre d'invitation de connexion + « Connecté, enregistrer » (déclenche `/api/ego/flush` pour écrire sur disque) ; correction du chemin du répertoire d'état de `ego_auth_flush` sous Windows.

## [v0.4.0] - 2026-04

Multiplateforme (adaptation Windows concrétisée).

- Support natif Windows : `IS_WIN` + `windowsChromeCandidates()` détectent automatiquement les répertoires d'installation de Chrome/Edge/Brave ainsi que `PATH`/`%PATHEXT%`.
- Le service injecté passe au choix binaire `webServer`/`httpServer`, la fenêtre d'observation se monte aussi sous Windows.
- Chemins d'état multiplateformes : Windows `%LOCALAPPDATA%\ego-lite-linux`, POSIX `$XDG_STATE_HOME/ego-lite-linux`.

## [v0.3.0] - 2026-04

Corrections et améliorations.

- Reprise automatique au démarrage à froid : chaque action `ego_*` lance un nouveau sous-processus `ego-browser`, et la période de préchauffage de session produisait parfois `CDP channel is not open` / timeout DevTools. Jusqu'à 3 retents avec backoff progressif intégrés, uniquement pour les erreurs transitoires de démarrage à froid ; les vraies erreurs sont transmises immédiatement.

## [v0.2.0] - 2026-04

Point fort : le frontend d'observation en temps réel.

- `lib/client.js` : UI en verre dépoli sombre, bolite 🌐 permanente en bas à droite, cliquez pour voir l'image en direct de l'agent.
- Gestion des onglets : barre d'onglets horizontale + `×` par onglet pour fermer (ferme réellement l'onglet du navigateur).
- Zoom/glisser/réinitialisation, polling dynamique (actif 2 s / immobile 8 s), navigation réutilisant l'onglet.
- `bin/ego-cast-worker.mjs` : s'attache au navigateur utilisé par l'agent, pousse les frames via CDP en temps réel, redémarre automatiquement après crash.
- Prêt à l'emploi : `bin/ego-chrome-wrapper.sh` fourni avec le paquet, `--no-sandbox` automatique sous root/headless.
