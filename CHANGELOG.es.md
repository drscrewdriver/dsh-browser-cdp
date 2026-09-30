## [0.18.0] - 2026-09-29 — Línea DSH 0.2.0-rc.1 (compat/0.2.0: adaptación puramente de metadata, cero cambios de código)

### Añadidos
- **Implementación `captureWithinBudget` en el worker de render** (corrección del bloqueo en máquina real de la línea 0.2.0): el `capture` de `bin/cdp-render-worker.mjs` invocaba hasta ahora una función nunca definida (la cadena de captura en máquina real fallaba siempre, y quedaba enmascarada por la sonda con puerta). Ahora implementada: escalera de calidad JPEG (arranque en 72, paso 12, suelo en 24, el superamiento del presupuesto se informa honestamente como `overBudget`) + reducción geométrica vía `scale.maxWidth` + rutas de un solo disparo para PNG/sin presupuesto; `data` se devuelve en base64 para consumo por la cadena de juicio JEV. Prueba real: Chrome/153 conectado realmente, presupuesto cumplido al primer intento (attempt 1, q=72).
- **Activado el semi-`noImplicitAny` del cliente**: `tsconfig.client.json` sube a `noImplicitAny: true`, los 401 implicit-any quedan todos explícitos (`scripts/fix-implicit-any.mjs` codemod posicional preciso + acabados manuales); las anotaciones de tipo no tienen efecto alguno en ejecución, `client-input.test.ts` resincronizado por regex sobre las fuentes.
- **Sondas con puerta habilitadas en máquina real**: sonda CDP remota (4/4) y sonda de render (1/1) pasadas con éxito contra un Chrome/153 local real — ciclo discovery→attach→inspect→input→binding + cadena de capturas con presupuesto. cli-probe y login-import e2e siguen atados a la runtime Linux vendored, puertas mantenidas (N/A en esta máquina).

### Cambios
- **Cambio de generación de las peerDependencies (sustitutivo)**: las seis `@deepseek-ai/dsh-client-locale` / `dsh-client-store` / `dsh-client-ui-settings-plugins` / `dsh-client-ui-slots` / `dsh-settings` / `dsh-tools` pasan de `>=0.1.7-rc.1 <0.1.8-0` → `>=0.2.0-rc.1 <0.2.1-0`; la línea 0.1.7 queda congelada en 0.17.x, para DSH 0.1.2-rc.1 ~ 0.1.7 use 0.17.x.
- **`engines.dsh` sincronizado en ambos sitios**: tanto el `engines.dsh` de primer nivel como el `dsh.engines.dsh` anidado pasan a `>=0.2.0-rc.1 <0.2.1-0` (la barrera en ejecución solo lee los peers, los metadata quedan coherentes).
- **Cambio de generación de las devDependencies**: `@deepseek-ai/dsh-tools` y `@deepseek-ai/dsh-sandbox` pasan de la línea 0.1.7 → `>=0.2.0-rc.1 <0.2.1-0`, el typecheck resuelve así los tipos del host 0.2.0 — el «todo verde» prueba compatibilidad con 0.2.0, no un residuo 0.1.7.
- **Justificación del cero código**: el composer/`forkSession` de 0.2.0 es una extensión de firma retrocompatible, este plugin entrega las selecciones mediante la fachada `ctx.get('conversation').input` (sin llamar a `submit()`, sin contrato de override), o sea fuera del alcance.
- Badges/matriz de compatibilidad de versiones/notas de adaptación del README reescritas en clave 0.2.0.

### Verificación
- Doble typecheck tsconfig + build + vitest (656 passed / 11 skipped) contra `dsh-tools@0.2.0-rc.1`, todo verde; `npm ls` sin invalid / conflictos de peers.

### Varios
- Versión en `dsh-plugin.json` 0.17.0 → 0.18.0 (este campo se quedaba atrás del package.json, alineado de paso en esta versión).
- Árbol de dependencias reconstruido por completo desde npmmirror, `package-lock.json` regenerado y commiteado.

## [Unreleased] — Pipeline estilo JEV: DOM+captura+intención → juicio Laya/JEV (fase 10 / R5-R6, rama stage9-ego-cli)

### Añadidos
- **Pipeline estilo JEV (T10.1–T10.19)**: contrato de fotograma (captura de pantalla + DOM numerado + intención + progreso de acciones) + costura de juicio (responder solo con números, jamás con selectores).
  - Worker de render `bin/cdp-render-worker.mjs`: cliente CDP de conexión única, `attachPage()` (enable de `Page/Runtime/DOM/Accessibility` en el orden M0.3), `gatherInteractive(limit)`, `captureWithinBudget()` (escalera de calidad JPEG + reducción + `overBudget` informado honestamente).
  - Tres primitivas `noul`/`choice`/`score` (`src/jev/wire.ts`) + límites de protocolo (`choice.criteria` no vacío y ≤255, tabla vacía rechaza siempre, porque un `criteria` vacío es un 422 mal leído como fallo del modelo) + `validateQuestions()` que reporta todo de golpe + `THRESHOLD_BUCKETS`/`bucketFor`.
  - Costura de juicio `JudgeProvider` + cadena de degradación `jev → laya → rule → refuse` (**los no disponibles se saltan sin llamarlos**, cada fallo de tramo entra en la trace; `refuse` es un resultado, no una excepción).
  - Superficie de cuatro herramientas `bcdp_jev_status` / `bcdp_jev_frame` / `bcdp_jev_ask` (`dryRun` true por defecto, `round=control|chapter|pick` por niveles) / `bcdp_jev_run` (trace paso a paso). `attachGate()` intercepta de forma uniforme «no hay navegador activo»; `bcdp_doctor` gana cinco líneas sobre la cadena de juicio.
  - Bucle `src/jev/loop.ts`: los seis efectos todos inyectados, `BudgetLedger` verifica antes de gastar, terminación en seis estados (incluido `exhaustedKind`), conjunto de exclusión estructuralmente eficaz, umbral de recaptura, `#PROGRESS` generado mecánicamente.
- **Prioridad de laya (revisión del 2026-09-24)**: por defecto `judgePrefer='laya,rule'` (sin jev, ya que JEV no puede registrarse); `jevUrl` vacío significa no participación. Sin clave, `bcdp_jev_status` imprime por sí solo el arranque local (`ENGINE=laya … uvicorn laya_api.main:app`, puerto 8000, `ALLOW_DEV_LOGIN=true`).
- **Capitulación de acciones por capítulos (reducción en tres niveles)**: el worker deduce de la cadena paternal AX de los `childIds` el ancestro estructurado más próximo como capítulo (lista blanca `CHAPTER_ROLES`, numeración por orden de documento a igual role: `form#1`/`form#2`); `control → chapter → pick`, con un solo capítulo se salta la ronda de capítulos; umbrales repartidos en cubos por número de candidatos (20 → «unos pocos × unos pocos», ambas rondas caen en los cubos estrictos).
- **Aislamiento del contexto de juicio**: lista blanca de cuatro segmentos `INTENT/PROGRESS/FRAME/HISTORY` + aserción tras el ensamblado `assertJudgeIsolation()` (cualquier título en mayúsculas desnudo se rechaza); `IntentStateInput` carece estructuralmente de campo session — **quien gobierna la UI del navegador no lleva el prefijo de sesión completo**.
- **Interruptor de evaluación `jevEvaluate` (activado por defecto, commit `208ae38`)**: tras cada paso, juicio `inprogress/done/fail`; `fail` o «done sin verificar» → `escalate`, con una lista ordenada de `RecoveryOption[]` (`reload` primero, un render obsoleto esconde una confirmación ya escrita), derivada de `recoveryFor(reason, lastAction)`.
- **class de los elementos operados conservado (commit `f79a272`)**: cuando `act` alcanza un solo elemento, `DOM.getOuterHTML` se recupera perezosamente y se normaliza vía `bin/record-normalize.mjs` — las reglas de reescritura están permitidas, pero los rasgos de localización como `class`/`id`/`role`/`aria-*`/`data-testid` se **conservan**, solo se podan los tokens de envoltura del inspector (como `trae-browser-inspect-draggable`) y el `style`; el outerHTML completo entra en `Escalation.actedOn` para la recuperación por el LLM, la reference compacta en HISTORY.

### Verificación
- Tests completos 630 passed / 11 skipped (sondas con puerta); los dos `tsc` pasados; `lib/index.js` de 206.613 → 316.544 → 317.402 B (prueba en bytes de que los módulos están cableados).
- Parapetos: `tests/worker-dispatch.test.ts` (afirma que `act/reload/scroll/fill` caen todos sobre funciones declaradas — justamente la clase de bug que `ed6eccf` dejó pasar en silencio), `tests/record-normalize.test.ts` (clava el conservado del class, la poda de los tokens chrome, la permanencia de los atributos de localización).

### Límites conocidos (honestidad sin maquillaje)
- **Todavía sin extremo a extremo en máquina real** (T10.22 pendiente): los tests unitarios cubren protocolo/umbrales/terminación/capítulos/ensamblado, no la cadena real.
- **Precisión del juicio no medida**: los cubos de umbrales sirven para calibrar, no prueban que las elecciones sean acertadas.
- **Lista blanca de capítulos no calibrada en sitios reales**: `CHAPTER_ROLES` sale de la tabla de roles AX; si un sitio mete todos los controles en `div` sin nombre, todo cae en el capítulo único `page`, degradación al segundo nivel (degradación conocida, no un error).
- **`render.ts` se adhiere de nuevo en cada llamada**: las conexiones duraderas tipo sesión requerirían de parte del host un contrato de spawn reanudable, hoy inexistente — el coste queda documentado.

## [Unreleased] — Polimorfismo de los tipos de conexión: objeto de conexión CLI ego local (fase 9 / R7, rama stage9-ego-cli)

### Añadidos
- **Tipado de la secuencia de conexiones**: `BrowserLink = CdpLink | EgoCliLink` (campo discriminante `kind: 'cdp' | 'ego-cli'`). El orden del array **sigue siendo la prioridad**, `activeTargetId` puede apuntar a cualquiera de los dos tipos.
- **Conexión CLI ego local** (`kind='ego-cli'`, **solo máquina local, como máximo una a nivel global**):
  - Cadena de resolución del CLI de cuatro niveles: `cliPath` explícito → `ego-browser` del PATH → helper dentro del paquete de la app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime incorporada;
  - **Reconocimiento de la forma de spawn**: primero **ejecución directa**, ante `EACCES`/`ENOEXEC`/`ENOENT` retroceso a `node <path>` (el CLI verdadero es un ejecutable dentro del paquete de la app, `ego-browser-v2`/la versión incorporada es JS — ambas formas existen realmente, adivinar la extensión dejaría todo inutilizable);
  - **Sin inyección de `EGO_LINUX_CDP_URL`**: esa env pertenece solo al port Linux incorporado, el CLI nativo de macOS no la lee; eso es exactamente la razón de ser de este tipo;
  - **La sonda de disponibilidad pasa por un heredoc mínimo** (el mismo canal `nodejs` del trabajo real); `--status` sirve solo como atajo **oportunista** con breve timeout de 2 s (ante `unknown option` o no-JSON del CLI, degradación silenciosa, **sin veredicto de fallo**);
  - Cinco códigos de fallo y **ningún retroceso silencioso**: `cli-not-found` / `cli-not-executable` / `cli-probe-timeout` / `cli-probe-failed` / `cli-sdk-path-unsupported`.
- **`--sdk-path` como capacidad opcional**: no se pasa por defecto (se usa el harness oficialmente emparejado del CLI); si la activación explícita es rechazada (`unknown option`) → se anota `cli-sdk-path-unsupported` y **un solo reintento automático sin ese flag**.
- Novedades en `bcdp_doctor`: `links: n (cdp x, ego-cli y)`, `cli: <path> (<origin>, shape <shape>)`, `naming: … legacy ego_* aliases OFF/ON` y un aviso `conflict:` si el plugin upstream está instalado en la misma máquina.

### Cambios (Breaking)
- Clave de ajustes `cdpTargets` → **`links`** (la clave antigua se lee como reserva durante una versión, sus líneas equivalen a `kind='cdp'`, **cero pérdidas**).
- Combinación `cdpMode='remote'` + elemento activado siendo un CLI local → `mode-kind-mismatch` explícito (se acabó la desviación silenciosa hacia otro elemento).
- La semántica de `remoteEnabled` se estrecha al **solo CDP remoto**: las conexiones CLI locales no se ven afectadas.

### Corregido
- El separador de rutas y el separador de PATH de `makeWhich` siguen ahora a la **plataforma simulada** (antes los valores del host vía `node:path`: una búsqueda darwin/linux en Windows componía `dir\file` y nunca encontraba nada).

## [0.16.0] - 2026-09-23 — Cierre de la fase 2b + interruptor de desactivación suave del CDP remoto

### Añadidos
- **Interruptor general `remoteEnabled` (T2.18)**: desactivar temporalmente el CDP remoto sin borrar la secuencia de objetivos — apagado, la secuencia queda intacta pero toda exploración y conexión remotas cesan; las llamadas `bcdp_*` reciben el error explícito `remote-disabled`; interruptor visible en la tarjeta de ajustes y en `bcdp_doctor`; reactivable en cualquier momento. Ortogonal a `allowLocalFallback` (con el remoto apagado, auto puede retroceder al lanzador local).
- **`cdpMode=local` enganchado al lanzador propio (cierre de la 2b)**: el modo local ahora arranca vía M0.9 un navegador gestionado e inyecta su endpoint, la runtime incorporada se adhiere a él en vez de arrancar en frío por su cuenta; el caché se marca `endpointSource: local`.
- **Dos líneas nuevas en `bcdp_doctor`**: `remote CDP: enabled/DISABLED` y `attach: <status> (source: …) @ <endpoint>` (visibilidad completada en los tres sitios, T2.16).

## [0.15.0] - 2026-09-23 — Lanzador local del navegador (fase 2b / M0.9)

### Añadidos
- **Arranque local gestionado**: cuando `allowLocalFallback` está activo y el endpoint activado es inalcanzable, se arranca automáticamente el Chrome/Chromium/Edge local (descubrimiento explícito → tabla de candidatos por plataforma), se inyecta `http://127.0.0.1:<port>` y se continúa trabajando; el badge de adherencia muestra `endpointSource: local-fallback`; **retroceso inverso prohibido**.
- **Reúso en singleton** (T2.13): `launcher.json` registra pid/puerto/profile; solo se reutilizan las instancias arrancadas por nosotros y que aún respondan.
- **Parada y recuperación** (T2.14): en win32 `taskkill /T /F` mata el árbol completo (medidos 0 huérfanos); el reaper de inactividad recupera de paso las instancias locales.
- **Ajustes**: `localHeadless`, `localUserDataDir` (por defecto `~/.dsh/cache/dsh-browser-cdp/chrome-profile`, nunca el profile cotidiano).
- **Política de puertos** (T2.11): un puerto libre se preasigna y pasa explícitamente, sin depender de los mecanismos sin verificar DevToolsActivePort/puerto 0.
- **Resolución del conflicto de rótulos**: título de la pestaña/bolita de la ventana de observación «Agent 浏览器» → «CDP 浏览器» (análisis en findings A.5).

## [0.14.0] - 2026-09-23 — Referencias de selección agregadas por página en bloques diccionario, con la conexión CDP de origen

### Cambios
- **Agregación por página**: una referencia transporta solo el contenido de una única página web — los elementos múltiples de una misma página se funden en **un mismo bloque**, las selecciones en otras páginas producen bloques nuevos.
- **Envoltura diccionario** (por analogía con los adjuntos de imagen previamente convertidos en bloques): el bloque en el borrador tiene esta forma:
  `[CDP-PICKS page="…" targetId="…" endpoint="…"]` + JSON (`cdpEndpoint`/`targetId`/`pageUrl`/`pageTitle`/`elements[]`) + `[/CDP-PICKS]`.
- **Origen rastreable**: el bloque contiene `cdpEndpoint` (el worker lo deduce de `active.wsUrl` recortando `/devtools/*`) + `targetId`; cada entrada de `elements[]` lleva un `backendNodeId` — `bcdp_cdp` puede consultar directamente la estructura DOM del elemento vía `DOM.describeNode({backendNodeId})`; se añaden `pageUrl`/`pageTitle`.
- worker: nuevo `PickElement.source` (`Target.getTargets` recoge los metadata de página + `getEndpoint` inyecta la fuente de conexión).
- Continuidad semántica: sin envío automático (v0.13.0), continuación de la numeración `n` en la misma página.

## [0.13.0] - 2026-09-23 — Entrega de selecciones cambiada a referencias numeradas, suprimido el envío automático

### Cambios (Breaking)
- **Se acabó el envío automático**: el camino submit() de «Añadir a la conversación» se retira por completo — cualquier acción de selección se limita a escribir en el borrador del campo de entrada, **el envío queda siempre en manos del usuario** (Intro en el campo o clic en enviar).
- **Referencias numeradas**: cada selección añade al borrador `[pick N] <descripción del elemento>`, N continúa automáticamente la secuencia de `[pick N]` ya presentes en el campo — las selecciones múltiples forman una lista ordenada.
- **La barra flotante pasa a una sola acción**: «Referir en la conversación (Ctrl+J o ↵)» — ambos atajos son equivalentes, en el estado confirmado aparece «✓ Referido en el campo de entrada».

## [0.12.0] - 2026-09-23 — Des-ego: identidad de proxy de navegador CDP (fase 8)

### Cambios (Breaking)
- **33 herramientas `ego_*` → `bcdp_*`**: `bcdp_status` / `bcdp_navigate` / `bcdp_doctor` … (prefijo derivado del id del plugin, libre en el ecosistema). Los scripts que citan los nombres antiguos pueden transitar por el nuevo ajuste `legacyEgoToolNames: true` (registra además los alias `ego_*`; mutuamente excluyente con el plugin upstream ego-browser).
- **Rutas HTTP `/api/ego/*` → `/api/bcdp/*`**, pasarela de ajustes `/ego/api/*` → `/bcdp/api/*` (panel sincronizado).
- **Renombrado de recursos**: `bin/ego-cast-worker.mjs` → `bin/cdp-cast-worker.mjs`, `bin/ego-chrome-wrapper.sh` → `bin/cdp-chrome-wrapper.sh` (lógicas de emparejamiento/limpieza de procesos worker sincronizadas).
- **Clave de configuración** `egoCliArgs` → `runtimeArgs` (la clave antigua se lee automáticamente durante una versión, sin pérdidas de ajustes).
- **Rótulos**: la autodenominación del panel EN/ZH unificada en «CDP 浏览器代理 / CDP browser bridge», sin empezar por ego; README sincronizado.
- El cableado interno (variables de entorno `EGO_LINUX_*`) y el nombre del directorio de la runtime vendored **no cambian deliberadamente** (seguridad de las actualizaciones).
- Efecto colateral: **posible coexistencia** con el upstream `Fisfzy/ego-browser` (nombres de herramientas/rutas todos desfasados).

## [0.11.1] - 2026-09-23 — Correcciones: dos juicios erróneos del estado de selección en el panel

### Corregido
- El estado intermedio `picked` del worker (capturado, a la espera de acción) era tomado por el panel como un fallo mostrando «selección fallida» — ahora se muestra correctamente la descripción del elemento.
- Al armar el panel, la base de entregas se alineaba con `picks` y se tragaba la entrega de la selección hecha **antes del armado** — la base retrocede un grado, la selección a la espera de acción se entrega necesariamente.

# Changelog

Todos los cambios visibles para el usuario quedan agrupados bajo el número de versión correspondiente. El formato sigue [Keep a Changelog](https://keepachangelog.com/), la semántica de versiones sigue [SemVer](http://semver.org/).

## [0.11.0] - 2026-09-23 — Entrega M1.6 a la conversación + camino de retroceso de selección por coordenadas

### Añadidos
- **Entrega de los resultados de selección en la conversación (M1.6 / T5.6–T5.7)**: las dos acciones de la barra flotante de página ahora escriben de verdad en la conversación — «Comentar en la conversación» escribe la descripción del elemento en el borrador del campo de entrada (el usuario completa su comentario y envía por sí mismo); «Añadir a la conversación» escribe en el borrador y **envía automáticamente** (el mismo camino adjudication que el botón de enviar). Antes de enviar se verifica `phase === 'plain'`; una sola entrega por selección; el resultado (✓ enviado a la conversación / ✓ escrito en el campo / entrega fallida + motivo) se muestra en la línea de estado de la ventana de observación.
- **Camino de retroceso de selección por coordenadas (T5.1b)**: en modo selección, hacer clic sobre la captura en directo de la ventana de observación = seleccionar — las coordenadas convertidas se envían al worker, con resolución del punto tocado vía `DOM.getNodeForLocation` (sin depender del canal de eventos Overlay), recorriendo la misma cadena descripción/medición/inyección de UI. Soportado tanto en la barra lateral como en la ventana flotante.
- worker: nueva `POST /api/pick/click {targetId, x, y}`; el host reenvía en sincronía `/api/ego/pick/click`.

### Notas
- Un clic al vacío que no alcanza ningún nodo informa explícitamente «selección fallida (no-node-at-point)», sin vuelta silenciosa a idle (fixtures de clics al vacío, T5.8).

## [0.10.0] - 2026-09-23 — Cimientos CDP P0 + selección de elementos (cuerpo R6) + Set-of-Marks (R4)

### Añadidos
- **Selección de elementos (cuerpo R6)**: la barra de herramientas de la ventana de observación gana un interruptor «Seleccionar elemento» (uno en la barra lateral y otro en la ventana flotante, ambos a la izquierda de «Abrir la página real»). Activado, se seleccionan elementos en la verdadera página elegida: marco de selección azul cielo 2 px + barra flotante pegada al elemento, con dos acciones «Comentar en la conversación Ctrl+J» / «Añadir a la conversación ↵», luego aparece en el sitio «✓ Transferido a la conversación» y se recoge a los 2,5 s; al completarse una acción el modo selección se rearma automáticamente, las selecciones en ráfaga no exigen volver al panel. Cambiar de pestaña / cerrar el panel sale de la selección y limpia la UI inyectada.
- **Captura Set-of-Marks (mecánica + pasarela R4)**: `POST /api/ego/marks` devuelve en una llamada captura de pantalla + mapa numerado de los elementos interactivos en orden de documento (filtrado del árbol AX, `n = 1..N`, con rect del viewport y descripción semántica de una línea), resaltado opcional de un solo elemento. Implementación puramente CDP, cero inyecciones en la página; el mapa numerado es la alternativa a la restricción de Overlay, que solo puede resaltar un nodo por vez (restricción medida).
- **Cimientos de la sesión CDP permanente (P0)**: bajo `src/cdp/` — endpoint (normalización/descubrimiento de endpoints, 8 códigos de error estructurados), session (emparejamiento de ids de comando/timeout por comando/reconexión con backoff/**reproducción de la secuencia enable tras la reconexión**), events (distribución por dominio/afinidad de estado de los dominios/orden `DOM.enable → Overlay.enable`), dom, input (**ningún camino de escritura directa de `.value`**, reverificación del punto de clic), page (semántica de coordenadas de documento para el clip de captura, `highlightConfig` forzado dentro del proceso, `Runtime.addBinding`).
- **Sondas en máquina real** (disparadas por `CDP_PROBE_URL`, saltadas por defecto): descubrimiento 19 ms → conexión 7 ms → comando 1–5 ms → retorno binding 42 ms, pruebas en toda la cadena.

### Notas
- **Frontera de entrega**: el «transferido a la conversación» de la barra flotante de página es por ahora un estado de UI; el cableado del lado host para escribir en el campo de entrada de la conversación (`conversation.input.for(actx).setDraft/submit`) no está terminado, los resultados de selección son actualmente observables vía `lastPick`/`lastAction` de `GET /api/ego/pick`.

## [0.9.1] - 2026-09-23 — Corrección: objetivos CDP que desaparecen del panel tras guardar

### Corregido
- **Tras un guardado exitoso del panel de ajustes, toda la secuencia de objetivos CDP desaparecía de la interfaz (los datos en realidad sí se escribían)**: al reconstruir el borrador de ajustes con la config devuelta por el servidor en el callback de éxito del guardado se perdían tres campos — `cdpTargets` / `activeTargetId` / `cdpMode` (presentes en `load()`, ausentes en ese camino). Tras «añadir objetivo → meter endpoint → guardar», los objetivos retrocedían enseguida a «todavía no hay objetivos», aunque `~/.dsh/settings.yaml` contenía los objetivos correctos y el `activeTargetId` correcto. Los tres campos quedan completados en el camino de éxito del guardado, alineados con `load()`.
  > Nota de investigación: `ALLOWED_KEYS` del lado de `/ego/api/set` igual que `sanitizeJsonArray` funcionaban con normalidad, el problema estaba solo en la reconstrucción del borrador del cliente; ni la pasarela ni el esquema perdían campos.

## [0.9.0] - 2026-09-23 — Secuencia de objetivos CDP + activación (R1) + nombre de paquete unificado en dsh-browser-cdp

### Añadidos
- **Secuencia de objetivos CDP y activación (R1)**: nuevas configuraciones `cdpTargets` (secuencia ordenada) / `activeTargetId` (activación de un punto) / `cdpMode` (`auto`/`local`/`remote`) / `cdpProbeTimeoutMs`. Cada herramienta `ego_*` maneja **el** endpoint activado, no el navegador local.
- **Editor de secuencia en el panel de ajustes**: añadir/quitar/editar objetivos + ordenación vertical, activación por radio, botón «sonda» por entrada y badge de alcanzabilidad (estado en tiempo real por sondeo desde `/ego/api/cdp-status`). La validación de endpoints solo admite `http(s)://host:port` o `ws(s)://…`, un esquema ilegal produce un error explícito en lugar de una interpretación silenciosa.
- **Cadena de activación explícita**: `resolveEgoEnv` inyecta `EGO_LINUX_CDP_URL` según `cdpMode`; los cambios de ajustes (y el primer arranque) disparan `refreshAttach` para volver a sondear el endpoint activado, y cuando el endpoint cambia `setAttachEndpoint` reinicia el cast worker para que vuelva a adherirse al mismo navegador. La tabla de decisiones `decideAttach` garantiza que un fallo **nunca retrocede en silencio** al navegador local — bajo `auto`/`remote`, sin activación o si es inalcanzable, siempre se devuelve un error estructurado.
- **Endpoints nuevos de la pasarela**: `POST /ego/api/cdp-status` (lectura del estado de activación en tiempo real), `cdp-refresh` (sondear de nuevo manualmente y refrescar la adherencia del worker), `cdp-probe` (sonda de un solo disparo sobre cualquier endpoint, resultado reescrito en los campos `probe*` del objetivo).
- **Nombre de paquete unificado en `dsh-browser-cdp`**: `cordis.patch.yml`, `dsh-plugin.json` (`id`/`name`/Scene·SettingsSection id/namespace), namespace de ajustes, id de la pestaña sidebar del cliente (`dsh-browser-cdp:watch`), textos de locale y prefijos de logs, todo alineado.
- **Publicación del repositorio en `github.com/drscrewdriver/dsh-browser-cdp`**: `package.json#repository` y `dsh-plugin.json#source` repuntados desde el upstream `Fisfzy/dsh-ego-browser` (MIT, atribución conservada) hacia este repositorio. Soportada la instalación directa desde GitHub: `dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp` (pnpm recupera el tarball vía `codeload.github.com`, sin publicación en el registro), con posibilidad de fijar `#v0.9.0` / `#<sha>`.

### Tests
- Nuevo `tests/cdp-targets.test.ts` (26 casos): `normalizeEndpoint` / `sanitizeTargets` / auxiliares de secuencia / `probeEndpoint` (fetch inyectable, sin leer el reloj real) / `decideAttach` / `refreshAttach`+caché. Cobertura completa de los caminos de análisis, sonda y decisión de `cdp-targets.ts`.

## [0.8.5] - 2026-09-18 — Importación de estado de sesión + recuperación en reposo + lote de correcciones de la ventana de observación

### Añadidos
- **Importación del estado de sesión desde el navegador del sistema (#46)**: nueva herramienta `ego_login_import` + bloque «importar estado de sesión desde el navegador del sistema» en la tarjeta de ajustes + ruta `POST /api/ego/login-import`. Copia por dominio las cookies de sesión del Chrome/Edge/Brave cotidiano al navegador del agente: arranque headless del binario real con el Profile real (alias de junction que esquiva la restricción CDP del directorio por defecto de Chromium ≥136, satisfaciendo a la vez el anclaje de ruta de la App-Bound Encryption), lectura vía CDP `Storage.getCookies`, filtrado, escritura en el Profile persistente vía `Storage.setCookies`. Soporte de `source/domains/profile/closeSource/dryRun`; si el navegador de origen está en marcha se le puede cerrar con elegancia antes de importar (la ventana se restablece en el siguiente arranque); **respaldo automático de la base de cookies de origen antes de importar, restauración automática ante un vaciado detectado**; los valores de las cookies no entran ni en los registros ni en las salidas.
- **Recuperación automática en reposo (#47, opt-in)**: nuevo ajuste `idleTimeoutMin` (por defecto 0, apagado). Tras N minutos sin llamadas `ego_*`, el navegador de fondo se detiene con elegancia vía `--stop` (en reposo medidos ~425 MB), la siguiente llamada arranca en frío en 2-4 s. Mirar la ventana de observación no cuenta como actividad (anotado en el texto de los ajustes).
- **Botón «Pop-out» de la ventana de observación (#51)**: la ventana flotante y la pestaña de la barra lateral ganan un botón que llama al comando de la runtime `ego-browser --open` — la instancia headless se sustituye en el sitio por una con ventana del mismo Profile (se conservan las pestañas), una con ventana pasa al frente. La conclusión de que la vista previa CDP en modo headless ya es utilizable también quedó comprobada en la práctica.

### Corregido
- **Captura del viewport toda blanca tras el desplazamiento (PR #50)**: el origen del clip de `Page.captureScreenshot` está en coordenadas de documento; la captura del viewport estaba fija en `{x:0,y:0}`, y tras desplazarse el clip caía en una zona sin pintar (`captureBeyondViewport: false`) — de ahí la imagen vacía. Ahora se usa `pageInfo().sx/sy` (`scrollX/scrollY`) como origen del clip; el boundingBox del viewport del locator también recibe el desplazamiento de scroll, en línea con el followClip de `spaces-server`.
- **El enlace externo del chat era capturado por la ventana de observación y no se renderizaba (#48)**: la declaración `urlTarget` de la pestaña de la barra lateral era demasiado ancha (reclamaba todo el http(s)) cuando esa pestaña es solo una imagen de streaming. Declaración retirada, los enlaces externos vuelven a la pestaña browser integrada.
- **Tras el reinicio del navegador todos los `ego_*` avisaban de task space not found**: el id numérico del espacio memorizado del lado del plugin quedaba en suspenso tras el reinicio. Nuevo `runWithStaleSpaceRetry`: a la detección de ese error, reconstrucción automática por nombre del espacio y un solo reintento (cobertura completa de las herramientas de acción + ego_cli/ego_captcha/ego_script).
- **En multi-sesión la ventana de observación se abría en la sesión equivocada (#53, PR #54)**: `markEgoToolCall` transporta el id de la sesión llamante, la apertura automática localiza la barra lateral por sesión; la guardia de un solo uso pasa a ser por sesión, el flujo de detección queda permanente.

### Comunidad
- Fusionados los PR #50 (corrección de captura, hpqc032), #52 (i18n en inglés de la ventana de observación, M4cd1r; añadimos una corrección del valor por defecto de `wt()` para restablecer el typecheck), #54 (alcance de sesión, xiaochaZ).

## [0.8.4] - 2026-09-15 — Correcciones de la cadena de arranque del worker de la ventana de observación + fusiones de PR comunitarios

### Corregido
- **La ventana de observación nunca arrancaba en DSH ≥ 0.1.5 (#34 / #38 / #43)**: al spawn del worker le faltaba el `cwd` obligatorio para el subprocess provider de 0.1.5, y la excepción la tragaba un `catch` desnudo, de modo que `ensureWorker()` devolvía siempre null. Añadido `cwd`.
- **El worker se suicidaba al arrancar (defecto 2 de #34 / #40)**: la coincidencia laxa por subcadena de `stopSiblingWorkers()` tomaba el subprocess runner de DSH por un worker par, y `taskkill /T` mataba en bloque su propio árbol de procesos — el worker moría antes de escribir `ego-cast.json`. La coincidencia se estrecha a «el argumento de script directo de node es ego-cast-worker.mjs», con exclusión de su propia cadena de ancestros.
- **En el host Electron (DSH Desktop) todos los `ego_*` avisaban de no @@DSH_RESULT@@ (#42)**: al pasar un env explícito al spawn faltaba `ELECTRON_RUN_AS_NODE`, y el proceso hijo arrancaba como una segunda aplicación Electron. `resolveEgoEnv` y el spawn del worker añaden automáticamente `ELECTRON_RUN_AS_NODE=1` cuando existe `process.versions.electron`.
- **Respuesta vacía de /api/ego/stream cuando el worker está caído (#39, PR #44)**: `proxyWorkerStream(-1)` se cortocircuita a un SSE silencioso (escribe la cabecera `text/event-stream` y queda en silencio en la conexión larga), sin disparar el `ERR_SOCKET_BAD_PORT` que desgarraba la conexión; con 42 líneas de tests nuevos.
- **En Windows EGO_LINUX_HEADLESS se ignoraba en silencio (#35)**: el `EGO_LINUX_HEADLESS=1` explícito tiene ahora prioridad sobre la inferencia por defecto `hasDisplay=true` de win32, en coherencia con la ayuda del CLI / la documentación del README.
- **Arranque web del cliente bloqueado por completo en hosts sin dsh-better-sidebar**: la lista estática de inject del cliente retira `betterSidebar` (el loader esperaría eternamente el servicio ausente), sustituida por reconocimiento vía `ctx.get` + montaje inmediato de la bolita de observación flotante + ascenso a pestaña de barra lateral vía `ctx.inject` cuando el servicio aparece (gracias al esquema del PR #45).

### Añadidos
- **Interruptor de aislamiento sandbox de los espacios de tareas `isolateSpaces` (PR #31)**: apagado por defecto, los espacios de tareas reutilizan el Profile persistente en disco y el estado de sesión sobrevive a los reinicios (cubre la petición de #1); al encenderlo se vuelve al aislamiento sandbox en memoria. Las descripciones de las herramientas `ego_space_open`/`ego_space_close` se inyectan dinámicamente según el modo; corregida la imposibilidad de persistir los ajustes booleanos de la pasarela.

### Varios
- Corregidos los marcadores de plantilla `allowBuilds` sin rellenar en `pnpm-workspace.yaml` que impedían a pnpm 11 instalar; añadida una fixture de config para `isolateSpaces` en los tests.
- Fusionados los PR #36 (matriz de compatibilidad de versiones del README), #31, #44; cerrado el #45 ya superado.

## [0.8.3] - 2026-09-07 — Compatibilidad DSH 0.1.2-rc.1 + correcciones de seguridad/estabilidad

### Seguridad
- **Corregidas las rutas `/api/ego/*` sin autenticación**: las rutas exactas se activaban antes de la barrera de confianza del prefijo `/api` del host, de modo que `GET /api/ego/stream` dejaba salir fotogramas en directo sin credenciales y `POST /api/ego/input` permitía introducir entradas sin credenciales (manejo entre sitios). Envoltura uniforme de webServer.register: todas las rutas ego exigen una cookie `dsh-auth-*` con SameSite=Strict, que las páginas maliciosas naturalmente no llevan; la guardia solo actúa sobre las rutas del propio plugin, sin ensuciar los registros de otros plugins en el singleton del host.

### Corregido
- **Fallo de arranque del cliente en hosts sin dsh-better-sidebar (#29)**: el `inject` declarado en rígido y el acceso desnudo a la propiedad `ctx.betterSidebar` lanzaban «without inject» con resolver estricto. La declaración se conserva (es una condición de resolución) + el acceso se envuelve en try/catch con paso explícito del parámetro — un host sin sidebar retrocede a la bolita flotante en lugar de quedarse congelado entero.
- **Regresión del arranque en frío en Windows**: el soporte Xvfb de #22 cambiaba sin `DISPLAY` el valor por defecto de headless a arranque de Xvfb, cuando Windows tiene sesión de escritorio y no tiene Xvfb → el arranque en frío caía con «no X display / no Xvfb binary». `ensureXDisplay` y el `hasDisplay` de entrada ganan una rama win32 (la sesión de escritorio cuenta como display, las ventanas con interfaz se abren directamente, retorno al comportamiento de adaptación de v0.4.0).
- **Lista blanca de ajustes de la pasarela sin `egoCliArgs`/`chromeArgs`**: `/ego/api/set` descartaba en silencio estos dos campos de configuración, imposible de persistir — añadidos a `ALLOWED_KEYS`.

### Fusiones (PR comunitarios + local)
- Fusionados 6 PR comunitarios: `#20` ejecución root, `#22` xvfb, `#16` detección headless macOS, `#24` corrección schemastery `link:`, `#28` compatibilidad DSH 0.1.2-rc.1/v0.1.3-alpha.1 (peer/engines endurecidos), `#13` estabilidad Windows.
- Corregido el error de sintaxis JSON del manifiesto por una coma ausente en dsh-plugin.json (fuente del bloqueo de inclusión en directorios).
- Añadido el LICENSE MIT; completadas las notas de cadena de suministro/permisos; los `*.map` dejan de rastrearse.
- Auditoría oficial build-dsh-plugin superada: `status: READY_FOR_PINNED_SOURCE_VERIFICATION`, `route: direct`, `blockers: 0`.

### Compatibilidad
- `engines.dsh: >=0.1.2-rc.1`; peer dependencies todas fijadas en `>=0.1.2-rc.1`.
- En DSH 0.1.2-rc.1 (Windows/web profile) completados instalación, arranque, llamada real de `ego_navigate` y aceptación del panel de observación en directo; `0.1.2-alpha.x` declarados instalables pero no probados; `<0.1.2-rc.1` → use v0.8.0 y anteriores.

## [0.8.1] - 2026-08-28 — Compatibilidad DSH 0.1.2-alpha.1

### Cambios
- **Migración de la mitad cliente a `@deepseek-ai/dsh-client-store`**: 0.1.2-alpha.1 renombra `@deepseek-ai/dsh-client-runtime` (incluido el subcamino `/client`) a `@deepseek-ai/dsh-client-store` (el grafo de módulos del cliente usa el nombre de paquete desnudo como id de módulo estático). La firma de `createSnapshotStore` no cambia.
- **Id de registro del módulo cliente = nombre de paquete declarado `dsh-ego-browser`**: en 0.1.2 el id de las líneas del boot manifest se genera del `name` del package.json, y el nombre de la especificación de línea del loader debe coincidir (verificación de igualdad del nombre `nearestPackage`); un montaje por alias (clave de carga junction `@dsh-external/ego-browser`) era juzgado «not a client row» por el escáner → el panel de observación desaparecía en silencio. El banner ID de tsdown y el nombre de línea de `cordis.patch.yml` se unifican al nombre del paquete declarado; el `dsh-ego-browser` del `dsh-plugin.json` queda sin cambios.
- **`dsh.client.inject` declara solo las líneas reales del grafo**: en 0.1.2 `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots` son módulos estáticos (fuera del grafo de módulos); declararlos como aristas de inyección dejaba la entrada en pending silencioso (módulo no materializado, panel no montado, ningún error). Solo quedan locale / ui-settings-plugins, las dos líneas reales del grafo.
- **El servicio opcional webServer pasa a entrega mediante inyección anidada**: el resolutor estricto de servicios de 0.1.2 devolvía undefined para `ctx.get('webServer')` sin declaración de inyección → rutas de observación `/api/ego/*` silenciosamente no registradas → capa de datos del panel en 401/estado vacío. Cambio a `ctx.inject(['webServer'], cb)` (rutas registradas solo cuando el servicio está; los hosts TUI/headless sin servidor web quedan tools-only sin bloqueo).
- **Peer dependencies alineadas con la familia 0.1.x** (client-locale / client-ui-slots / client-ui-settings-plugins / dsh-settings / dsh-tools declaradas `>=0.1.1-rc.2`), `engines.dsh: >=0.1.2-alpha.1`.
- Verificado tras las correcciones: módulos del cliente materializados con normalidad, pestaña sidebar «Agent 浏览器» y flujo de observación/toma de control operativos, rutas `/api/ego/*` en 200, streaming en directo sobre `streaming`, cadenas de clic/entrada sobre la imagen alcanzables (pointerdown → `/api/ego/input` → dispatch CDP).

## [Unreleased]

Doble avance de pipeline de imagen para la ventana de observación: corrección de la raíz del protocolo CDP y añadido de un backend opcional FFmpeg H.264/fMP4.

### Añadidos / mejoras
- **Parámetros de arranque personalizados**: la tarjeta de ajustes gana dos campos, «parámetros CLI adicionales para ego-browser» y «parámetros de arranque adicionales para Chrome». Los primeros se añaden al argv de `ego-browser nodejs` y surten efecto desde la siguiente llamada a una herramienta `ego_*`; los segundos llegan puenteados vía `EGO_LINUX_EXTRA_ARGS` al `launch()` de la runtime vendored, con efecto solo en el próximo arranque en frío del navegador (el navegador es un singleton residente — solo `ego-browser --stop` o un reinicio de DSH lo hará reiniciar). Ambos lados vetan los flags que romperían el plano de control autogestionado del plugin (`--status`/`--stop`/`--help`/`--user-data-dir`/`--remote-debugging-port`/`--headless`/`--proxy-server` etc.); para `--proxy-server` pase por `EGO_LINUX_PROXY`. `ego_doctor` informa de los parámetros vigentes en este momento.
- FFmpeg pasa a instalación explícita a demanda: CDP ya no depende de `ffmpeg-static` ni lo instala. La página de ajustes comprueba primero la ruta personalizada, el PATH del sistema y el caché gestionado; la opción FFmpeg queda desactivada hasta completar la comprobación de compatibilidad, con descarga a un clic de versión fija y verificación SHA-256.
- Nuevo `githubMirror`: sustituye `https://github.com` por la base HTTPS indicada por el usuario; en Windows/Linux tag de release BtbN fijo, en macOS assets de plataforma fijos. La descarga entra en un directorio temporal de `~/.dsh/cache/ego-browser/ffmpeg/`; la publicación atómica ocurre solo tras verificar, desempaquetar y sondear capacidades, todo con éxito.
- La imagen de observación gana un proxy parcial de entrada de teclado: texto normal y pegar via `Input.insertText`, el IME chino se envía de una vez al terminar la composición, las teclas de control y atajos via `Input.dispatchKeyEvent`. El foco solo se toma tras un clic en la imagen de observación, sin robar la entrada del propio DSH.
- Nuevo ajuste `ffmpegBitrateKbps` (500-20000 kbps); por defecto 2000/4000/8000 kbps para bajo/equilibrado/alto. El codificador usa bitrate objetivo, bitrate pico y buffer VBV, en sustitución del valor por defecto de unos 200 kbps de `h264_mf` y del `libx264 crf=28`.
- Que la ventana de DSH pase a segundo plano ya no rompe watch/SSE/video; el TTL del lease sube a 120 segundos, y las peticiones start/switch/renew se deduplican en single-flight, para que la limitación de los temporizadores de fondo no genere capturas caducadas ni alternancia sin fin de `starting`.
- `CaptureManager` + lease del watcher: al mismo tiempo un solo backend activo y un solo target observado; con el panel oculto la captura se detiene.
- El backend CDP distingue correctamente el ID de ACK del fotograma y la flattened target session, los errores de protocolo son visibles; 20 FPS por defecto, limitación latest-frame, retaguardia de un solo target, supresión del redibujado forzado de animaciones transparentes.
- Backend FFmpeg: Windows usa `gfxcapture(hwnd)` para capturar directamente la superficie D3D11 de la ventana Chrome, las demás plataformas conservan el recorte de la fuente de pantalla; codificación en H.264 fragmented MP4, reproducción vía HTTP binario y MediaSource, aislamiento de los datos de procesos viejos por generation.
- Ajustes nuevos: `captureBackend`, niveles de calidad, FPS CDP/FFmpeg, anchura máxima y codificador; migración centralizada de los campos antiguos.
- Tests unitarios nuevos: parser MP4, ACK CDP, CaptureManager, migración de configuración, argv por plataforma.

### Límites de plataforma
- Windows exige un FFmpeg que incluya `gfxcapture`; el HWND se empareja por PID del navegador, título del target y límites de ventana CDP; aun con la ventana tapada o movida, la página objetivo sigue capturándose, y está prohibido retroceder a `gdigrab desktop`. El comportamiento con la ventana minimizada lo decide Windows Graphics Capture.
- Linux X11 usa `x11grab`, macOS `avfoundation` como recorte de pantalla; la oclusión y los permisos del sistema siguen afectando a ambas plataformas.
- Wayland: si el FFmpeg incluido no tiene una entrada Portal/PipeWire utilizable — error explícito `unsupported-ffmpeg-pipewire`, sin `kmsgrab` root, sin cambio silencioso a todo el escritorio y sin fingir un éxito.

### Corregido
- **Ratón a ratos del todo sin peticiones / teclado constantemente inservible**: el plano de control ya no depende de `streamState` ni de la sincronización spaces, sino que envía solo según el target de la imagen actual; el worker conserva la verificación final de targets caducados. Antes el frontend no tenía ningún escuchador de teclado ni soporte de protocolo — el camino completo text/keyDown/keyUp queda aquí cerrado.
- **FFmpeg en marcha pero la pestaña mostraba CDP**: el estado de captura se unifica ahora desde el SSE, la respuesta watch, spaces capture y watch/status; a falta de backend se conserva el valor actual, la sobreescritura por defecto a CDP está prohibida.
- **Ventana about:blank residual tras `space_open`**: el espacio de tareas abierto con éxito se convierte en el espacio activo más reciente; las herramientas siguientes que omiten `space` (navigate/click/fill etc.) reutilizan ese espacio en lugar de retroceder al fijo `dsh-agent` creando una segunda ventana. Al cerrarse el espacio activo se restablecen los valores por defecto de la configuración.
- **watch/start 502 e input 500**: la sonda de capacidades del binario FFmpeg y de `gfxcapture` pasa a subproceso asíncrono, la salud del worker ya no se bloquea durante el arranque; el timeout del proxy del worker para watch start/switch sube a 30 segundos, cubriendo el techo completo de ventana, codificador e init MP4. El host transmite tal cual el status HTTP del worker y el error JSON, y devuelve 502 solo si el worker es realmente inalcanzable. La entrada se valida en ambos lados, cliente y worker; un target inválido devuelve 409 `capture-target-stale`, en vez de envolverse en un 500.
- **FFmpeg elegido en los ajustes pero la pestaña seguía mostrando CDP**: cuando varias fibras cargaban el plugin a la vez, el puente de ajustes registrado después, ante un namespace duplicado, retrocedía por error a una composition config vacía, y el cast worker recibía `captureBackend:auto`. Ahora el mismo servicio de ajustes comparte un único scope; la tarjeta de ajustes, la pasarela y el cast-server leen siempre la misma configuración persistida. Un worker en reposo que recibe una actualización de configuración publica enseguida el nuevo estado del backend, sin retener la vieja etiqueta CDP.
- **FFmpeg en Windows ya no filma la ventana en primer plano del usuario**: antes los parámetros eran fijos — `gdigrab ... -i desktop` — con un recorte por coordenadas de página solo al arrancar, así que en cuanto Chrome pasaba a segundo plano, DSH u otra aplicación que cubriera la zona se iban al streaming. Ahora el target se resuelve primero en HWND vía `Browser.getWindowForTarget` y la enumeración Win32 de ventanas de primer nivel, luego `gfxcapture` captura la superficie de la ventana aislada; las distintas ventanas Chrome de los distintos espacios de tareas reciben HWND distintos. Una pestaña en segundo plano de la misma ventana avisa `ffmpeg-target-not-visible`, sin mostrar la pestaña equivocada ni robar el foco por iniciativa propia.
- La codificación de Windows privilegia el camino hardware D3D11 de `h264_mf`; la sonda del codificador usa un pipeline real con HWND, para que un fotograma de prueba por software no declare falsamente indisponible el codificador hardware. `fps/setpts` explícitos fijan 30 FPS, la fragmentación fMP4 baja a 100 ms, y `skip_trailer` evita el error del parser `mfra` en las paradas con elegancia.
- **El estado de sesión sobrevive a los reinicios de DSH (fiel a la filosofía del ego-lite original)**: antes, tras un reinicio manual / un matado forzado de DSH había que volver a iniciar sesión — al recibir SIGTERM/SIGINT el worker solo se despegaba sin escribir en disco, y la gracia de 4 s del `--stop` en el teardown del plugin no bastaba, acabando a menudo en el retroceso de crash por SIGTERM. Ahora, antes de apagarse, el worker envía al navegador un CDP `Browser.close` (cierre con elegancia, el journal de cookies se funde en el profile en disco), y la gracia del teardown del plugin sube a 8 s, suficiente para cerrar con elegancia del todo. **Comprobado en la práctica**: tras un reinicio con elegancia la sesión se conserva íntegra; incluso tras matado forzado (SIGKILL) el estado de sesión de larga duración queda escrito en disco y legible al reiniciar.

### Refactorización de ingeniería
- **Migración de JS puro → TypeScript (PR #14)**: las fuentes se mudan de `lib/` a `src/` (`src/index.ts` capa de herramientas, `src/client/index.ts` frontend, `src/worker/ego-cast-worker.ts` worker), `lib/` y `bin/ego-cast-worker.mjs` se vuelven artefactos de build (precompilados y versionados). La cadena de build pasa a `pnpm typecheck` (barrera de tipos tsc, tsconfig.json + tsconfig.client.json) + `pnpm test` (vitest) + `pnpm run build` (tres bundles tsdown). Los tests migran en paralelo de `tests/*.test.mjs` a `.test.ts` con añadido de `vitest.config.ts`. `lib/` ya no se edita a mano.

## [v0.8.0] - 2026-08

Integración de pestaña sidebar: cuando `dsh-better-sidebar` está disponible, la ventana de consulta en directo se registra como pestaña nativa de la sidebar en lugar de como ventana flotante.

### Añadidos
- **Integración de la pestaña dsh-better-sidebar**: `apply()` reconoce oportunísticamente el servicio sidebar vía `ctx.get('betterSidebar')` (no `ctx.betterSidebar` — eso exigiría una declaración `inject`, haría del sidebar una dependencia rígida y sin él no dejaría cargar todo el plugin, tarjeta de ajustes incluida); si está disponible, registra vía `registerTab()` una pestaña `ego-browser:watch` (`single: true`, residente), si no, retrocede a la ventana flotante original. Es el patrón documentado de consumo de servicios opcionales de DSH (ver nota approval-seam, postmortem 0001).
- **Apertura automática de la pestaña en la primera llamada a una herramienta `ego_*`**: los caminos execute de `defineEgoTool` / `ego_cli` / `ego_captcha` / `ego_script` llaman a `markEgoToolCall()` para incrementar el contador del lado host, contador que se distribuye con la respuesta de `/api/ego/spaces`. `LivePreviewController`, al detectar el salto 0 → >0, llama a `ctx.get('betterSidebar').openTab({ type: 'ego-browser:watch' })`, la pestaña se despliega sola. El flag `autoOpened` garantiza una sola apertura por sesión.
- **Componente de pestaña React `EgoBrowserTab`**: renderiza el contenido de la pestaña sidebar con `React.createElement` + `bindSnapshotSelector` (cabecera / barra de pestañas / vista principal en directo / capa de historial / bandas de aviso login y captcha). La traza de navegación pasa del cajón lateral a la capa superpuesta (el botón de historial toma toda el área de contenido de la pestaña, un clic en una entrada entra en la vista previa o vuelve a la directo), adaptado a la anchura estrecha de la sidebar.
- **Clase vanilla `LivePreviewController`**: extraída del código DOM imperativo de la ventana flotante — sondeo / SSE / caché de fotogramas / zoom / mapeo inverso de coordenadas de entrada / lógica de seguimiento automático — para que el componente React se suscriba vía `subscribe`+`getSnapshot` y reenvíe los eventos pointer/wheel mediante llamadas a métodos. El controlador sostiene directamente la ref del `<img>`, sustituyendo `src` en el sitio a la frecuencia de fusión rAF, sin obligar a React a un re-render por fotograma.
- **`dsh-better-sidebar` no figura como peer dependency**: consumo oportunista vía `ctx.get()`, sin declaración `inject`, y por tanto sin peer que declarar. Con sidebar instalado, pestaña; sin él, retroceso a la ventana flotante — ambos despliegues quedan limpios.

### Decisión de diseño (dichas con franqueza)
- **Híbrido en vez de reescritura total**: React lleva la estructura de UI (cabecera / pestañas / bandas de aviso / capa de historial), el controlador vanilla lleva el pipeline de fotogramas en tiempo real (SSE / fusión rAF / mapeo inverso de coordenadas / reenvío de entradas). Unas 1000 líneas de lógica de streaming frágil no se reescribieron en hooks de React, para bajar el riesgo de regresiones.
- **Historial como capa superpuesta**: el cajón lateral de la ventana flotante daba dos columnas muy estrechas con la anchura reducida de la sidebar (~300-400 px); la capa superpuesta aprovecha mejor el espacio.
- **Carrera (conocida, aceptada)**: si `dsh-better-sidebar` carga después de ego-browser, `ctx.betterSidebar` puede seguir siendo `undefined` cuando corre `apply()`, y se retrocede a la ventana flotante. El cargador de módulos de DSH suele cargar en orden de dependencias, y el sidebar, como plugin UI de base, carga primero; si no, basta refrescar la página.
- **El código de la ventana flotante se conserva tal cual**: `mountFloatingWatch()` es el traslado mecánico del cuerpo del effect original, sin cambios de lógica, garantizando sin sidebar una experiencia idéntica a la de 0.7.x.

## [v0.7.1] - 2026-08

Versión de corrección: un solo `ego_space_open` ya no abre dos ventanas del navegador.

### Corregido
- **`ego_space_open` ya no abre dos ventanas del navegador**: antes, al arrancar, `"about:blank"` se pasaba como argumento posicional, lo que abría una pestaña residual en el browser context por defecto; y `ego_space_open` va por `useSpace+ensureRealTab`, abriendo otra pestaña en su propio browser context — Chrome aísla los contextos distintos en ventanas separadas, y el usuario veía dos ventanas. Ahora `LAUNCH_FLAGS` gana `--no-startup-window` y `launch()` ya no pasa un URL posicional: el arranque parte de cero pestañas; la primera pestaña la crea `ego_space_open` (o cualquier herramienta estructurada `ego_*` que pase por `useSpace+ensureRealTab`) en su propio contexto — queda como la única ventana que el usuario ve. El viejo comentario afirmaba que `--no-startup-window` rompería todas las operaciones `page.*` — era la conclusión de antes de introducir el enrutado `useSpace+ensureRealTab`, ya no válida para las herramientas estructuradas. **Regresión conocida (aceptada)**: si el heredoc en `ego_cli` / `ego_script` llama directamente a `page.*` sin pasar antes por `taskSpaces.useOrCreate`, ahora lanza `"no active tab to attach session"` — el mensaje de error es claro, y el uso recomendado no se resiente.

## [v0.7.0] - 2026-08

Versión menor: efecto respiración de la luz de estado de la ventana de observación + gobierno de memoria del frontend + correcciones de timeout de herramientas y multiplataforma.

### Añadidos
- **Efecto respiración de la luz de estado de la ventana de observación**: el punto verde del badge del FAB queda encendido cuando el agente maneja realmente el navegador (`busy`), y respira en reposo (halo verde periódico de 2,4 s) con el navegador abierto sin acciones; el punto de estado «consulta en directo» del panel sigue la misma lógica busy/respiración. La vieja semántica «busy=amarillo, idle=verde» se invierte en «verde al trabajo, respiración en reposo».

### Corregido
- **El parámetro `timeoutMs` de `ego_script` se ignoraba**: el timeout por ejecución declarado en el esquema nunca hizo efecto, todas las ejecuciones usaban la gracia por defecto de 15 s del plugin. Ahora `timeoutMs` atraviesa `runEgoScript` y hace efecto de verdad, con retorno al defecto si falta o es inválido.
- **Gobierno de memoria del frontend**: `frameCache` de la ventana de observación (el último JPEG dataURL de cada pestaña) y `pageMeta` se acumulaban sin límites por `targetId` — una fuga lenta en sesiones largas/muchas pestañas. Ahora el caché de las pestañas cerradas se poda según la tabla de pestañas vivas, y `frameCache` recibe un techo de seguridad `MAX_CACHED_FRAMES=12` con prioridad a las más antiguas.
- **El retroceso de home codificado en duro `/root` pasa a `os.homedir()`**: en la detección de rutas de estado, el home POSIX por defecto pasa del `/root` fijo al `os.homedir()` correcto multiplataforma, eliminando la trampa para los entornos sin root/contenedores.

### Ingeniería
- Nuevo `.gitattributes`: fines de línea LF unificados (`* text=auto eol=lf`), eliminando el temblor CRLF del árbol de trabajo causado por `core.autocrlf` en Windows y los falsos diagnósticos de diff/cp.

## [v0.6.1] - 2026-04

Versión de corrección: cadena de autorreparación + estabilidad del worker de la ventana de observación, usabilidad de la barra de onboarding del panel.

### Corregido
- **La desinstalación del plugin ya no bloquea la salida del host / no rompe la autorreparación**: el teardown de `ctx.effect` pasa de `await ego-browser --stop` (15 s de gracia que retenían la salida del host) a fire-and-forget — el host puede ser levantado limpio por `dsh-web-guard` en 10 s y un turn interrumpido puede continuar automáticamente.
- **Guardia de instancia única del worker de la ventana de observación + limpieza de estados caducados**: el mismo `ego-cast-worker.mjs` podía arrancar a la vez desde el directorio de instalación y desde un clon de dev, y `ensureWorker` levantaba otro cuando el pid conocido estaba muerto — `ego-cast.json` apuntaba así constantemente a un worker muerto/atrasado y el panel perdía el streaming. Ahora, al arrancar, el worker enumera y detiene los demás procesos homónimos (en Windows vía `powershell -EncodedCommand`, en POSIX vía `ps`), borra el `ego-cast.json` caducado y hace de su `{port,pid}` la única autoridad.
- **Bandas de onboarding de login/captchas cerrables manualmente**: se añade un botón ×; ambas bandas se muestran en exclusión mutua (captcha prioritario), se acabó el «imposible cerrar» y la «doble banda que comprime la imagen».
- **La ventana de observación sigue activamente la página en la que opera el agente**: antes el panel tomaba «el último redibujado» (lastActive) como página actual, los redibujados de páginas de animación/vídeo en segundo plano robaban la vista, y la vista principal no saltaba cuando el agente cambiaba de página. Ahora el worker obtiene vía DevTools `/json/list` la pestaña activa MRU del navegador (el mismo juicio de `tabs.mjs` de la runtime ego), la marca `active: true` y la pone primera en `/api/spaces` igual que en el SSE; el seguimiento automático del frontend sigue solo a la página activa e ignora los fotogramas de redibujados en segundo plano.

## [v0.6.0] - 2026-04

Saneamiento de la salud del código (convergencia de ingeniería).

- Eliminada la bomba de sobrescritura de build: se retiran el `src/` viejo (561 líneas de versión superada) y `tsconfig.json`, estableciendo **`lib/` como única fuente de autoridad**. `npm run build` pasa de «compilación tsc de src a lib (la versión vieja sobreescribía, todas las herramientas se perdían)» a «verificación sintáctica de `lib/` (`node --check`)».
- Unificado el registro de herramientas: `ego_captcha` / `ego_help` / `ego_doctor` / `ego_script` pasan al camino `withEgoLock` + reintentos en frío de las demás herramientas (seguridad de concurrencia).
- Fin del fork: las capacidades nuevas (captura de descargas, detección de captchas, 30+ herramientas) hacen fe con `lib/`.

## [v0.5.0] - 2026-04

Streaming en tiempo real + operación directa del navegador desde la ventana de monitorización.

- Corregido el bug clave del streaming en tiempo real: `screencastFrame` leía el campo equivocado, los fotogramas en directo nunca pasaron realmente por el SSE. Corregido — las páginas dinámicas rozan 10~30 fps.
- El reenvío en streaming de cast-server pasa a `node:http` (el buffering de las respuestas chunked por parte de fetch retrasaba el primer fotograma).
- El ratón de la ventana de monitorización opera directamente el navegador del agente: desplazamiento con rueda, clic/arrastre sobre el navegador real (`/api/ego/input` → CDP `Input.dispatchMouseEvent`), Ctrl+rueda para zoom, Ctrl+arrastre para desplazar, doble clic para restablecer, coordenadas mapeadas en inverso sobre el viewport real con corrección de letterbox.
- Nuevo `/api/ego/stream` (SSE): fotogramas en tiempo real + lista de páginas.
- Banda de invitación al inicio de sesión + «Sesión iniciada, guardar» (dispara `/api/ego/flush` para escribir en disco); corregida la ruta del directorio de estado de `ego_auth_flush` en Windows.

## [v0.4.0] - 2026-04

Multiplataforma (adaptación Windows concretada).

- Soporte nativo de Windows: `IS_WIN` + `windowsChromeCandidates()` detectan automáticamente los directorios de instalación de Chrome/Edge/Brave y `PATH`/`%PATHEXT%`.
- El servicio inyectado pasa a la elección entre dos, `webServer`/`httpServer`, la ventana de observación se monta también en Windows.
- Rutas de estado multiplataforma: Windows `%LOCALAPPDATA%\ego-lite-linux`, POSIX `$XDG_STATE_HOME/ego-lite-linux`.

## [v0.3.0] - 2026-04

Correcciones y mejoras.

- Reintento automático en el arranque en frío: cada acción `ego_*` levanta un nuevo subproceso `ego-browser`, y la fase de precalentamiento de la sesión producía a veces `CDP channel is not open` / timeout de DevTools. Integrados hasta 3 reintentos con backoff progresivo, solo para los errores transitorios del arranque en frío; los errores reales pasan de inmediato.

## [v0.2.0] - 2026-04

Lo más brillante: el frontend de observación en tiempo real.

- `lib/client.js`: UI de vidrio esmerilado oscuro, bolita 🌐 permanente abajo a la derecha, un clic y se ve la imagen en directo del agente.
- Gestión de pestañas: barra de pestañas horizontal + `×` por pestaña para cerrar (cierra de verdad la pestaña del navegador).
- Zoom/arrastre/restablecimiento, sondeo dinámico (activo 2 s / quieto 8 s), navegación que reutiliza la pestaña.
- `bin/ego-cast-worker.mjs`: se adhiere al navegador que usa el agente, empuja fotogramas vía CDP en tiempo real, se reinicia solo tras un cuelgue.
- Listo para usar: `bin/ego-chrome-wrapper.sh` viene en el paquete, `--no-sandbox` automático bajo root/headless.
