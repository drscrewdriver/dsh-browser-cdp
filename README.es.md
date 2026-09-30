# dsh-browser-cdp — El navegador del agente visible (conexión CDP)

[简体中文](README.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Italiano](README.it.md) | [Русский](README.ru.md) | [Español](README.es.md)

<p align="center">
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue" alt="DSH >= 0.2.0-rc.1">
  <img src="https://img.shields.io/badge/DSH--better--sidebar-%3E%3D0.12.2(optional)-red" alt="dsh-better-sidebar >= 0.12.2 (optional)">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?logo=node.js&logoColor=white" alt="Node >= 22">
</p>

> **Repositorio**: `github.com/drscrewdriver/dsh-browser-cdp` (antes `dsh-ego-browser`, derivado del proyecto upstream [Fisfzy/dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser)) ｜ Historial de versiones: ver [CHANGELOG.md](CHANGELOG.md)

### Matriz de compatibilidad de versiones

| Dependencia | Versión mínima | Versión recomendada | Notas |
|---|---|---|---|
| **DSH** (DeepSeek Harness) | `0.2.0-rc.1` | `≥ 0.2.0-rc.1 <0.2.1-0` | Línea 0.2.0: las peer dependencies están fijadas de forma sincronizada en `>=0.2.0-rc.1 <0.2.1-0`; el host mantiene retrocompatibilidad con la API de plugins (el composer/`forkSession` de 0.2.0 es una extensión de firma, el plugin es solo llamador, sin cambios necesarios). La superficie de ajustes declarativa introducida desde 0.1.7 (campos Config `.volatile()` que generan automáticamente el formulario de ajustes) continúa en 0.2.0. Para DSH `0.1.2-rc.1` ~ `0.1.7` use la línea **0.17.x**; para 0.1.0-rc.x / 0.1.1-rc.x use v0.8.0 o anterior |
| **dsh-better-sidebar** | `0.12.2` (opcional) | `≥ 0.17.1` | Sin él, retroceso automático a la esfera de observación flotante; `< 0.12.2` funciona pero la intercepción de enlaces externos (`urlTarget`) se degrada en silencio |
| **Node.js** | `22` | — | Incluido con el entorno del harness |

**Notas de adaptación a todas las versiones de DSH**: esta versión (**desde v0.18.0, línea 0.2.0**) apunta a DSH `0.2.0-rc.1+`: respecto a la línea 0.1.7 (v0.17.x) **cero cambios de código**, mero relevo de dependencias/metadata — el host 0.2.0 es retrocompatible con la API de plugins, y este plugin entrega las selecciones mediante la fachada `ctx.get('conversation').input` (sin llamar a `submit()`, sin override), quedando fuera del alcance de los cambios de 0.2.0. La superficie de ajustes declarativa, introducida en 0.1.7, funciona así: el plugin ya no registra ninguna sección de ajustes (la API de registro `ctx.settings` fue eliminada por el host); en su lugar, los campos configurables se marcan con `.volatile()` en el esquema Config y la página de ajustes del host genera el formulario automáticamente; los cambios en los campos volatile surten efecto en caliente mediante el evento `loader/volatile-update`, sin recargar el plugin. Las API esenciales del host (`defineTool`, `ctx.tools.register`, `ctx.subprocess.spawn`, `ctx.webServer.register`, `ctx.inject`, la fábrica CJS `ModuleLoader`, `cordis.patch.yml`) conservan su forma desde 0.1.2. Para DSH `0.1.2-rc.1` ~ `0.1.7` use la línea **0.17.x**.

**Notas de adaptación a dsh-better-sidebar**: este plugin registra una pestaña en la barra lateral y escucha los enlaces externos mediante el servicio `ctx.betterSidebar` (obtenido de forma defensiva con try-catch). Versiones de introducción de las API clave:

| API | Uso en este plugin | Versión de introducción en better-sidebar |
|---|---|---|
| `registerTab()` / `openTab()` / `ctx.betterSidebar` | Registro + apertura de pestaña | v0.9.0+ |
| `TabDescriptor.single` | Pestaña de instancia única | v0.9.0+ |
| `TabDescriptor.urlTarget` | Intercepción de enlaces externos | **v0.12.2+** (por debajo, la intercepción de enlaces falla en silencio) |

---

**Detalles del soporte de versiones de DSH**: cambios principales de v0.8.2 → v0.8.3: fusión de 6 PR comunitarios (adaptación root/xvfb/macOS headless, compatibilidad rc.1, estabilidad Windows), corrección de la vulnerabilidad de rutas `/api/bcdp/*` sin autenticación, del fallo de arranque del cliente en hosts sin dsh-better-sidebar (#29), de la regresión de arranque en frío en Windows (falsa detección de Xvfb introducida por #22) y la carencia de `runtimeArgs`/`chromeArgs` en la lista blanca de ajustes de la pasarela. Puntos de adaptación: renombrado del runtime cliente (`@deepseek-ai/dsh-client-store`), id de registro del módulo cliente y nombre de la línea de carga según el nombre del paquete declarado, `dsh.client.inject` que declara solo las líneas reales del grafo de módulos, `webServer` entregado mediante inyección anidada (servicio opcional) y sincronización con el modo pestaña de barra lateral (dsh-better-sidebar).

**Soporte de barra lateral ([dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar))**: cuando el host tiene instalado `dsh-better-sidebar` (recomendado ≥ v0.12.2), la ventana de observación en tiempo real se registra como **pestaña nativa de la barra lateral** — «Navegador del agente» aparece en el menú «+» de la barra lateral, se abre con un clic y queda anclada junto al cajón de la barra lateral; la pestaña se abre automáticamente en la primera llamada del agente a una herramienta `bcdp_*` (desde v0.8.5 la apertura se acota a la sesión llamante — en multi-sesión ya no aparece en la sesión equivocada). Sin `dsh-better-sidebar` se retrocede automáticamente al modo **esfera de observación flotante** en la esquina inferior derecha (`#dsh-ego-fab`). Ambas formas comparten el mismo conjunto de capacidades: streaming SSE en tiempo real / clic / entrada / captura de descargas. La ventana de observación ofrece además un botón «Pop-out»: el navegador del agente en ejecución headless se sustituye con un clic por una ventana con interfaz del mismo Profile (se conservan las pestañas), útil para tomar el control manualmente.

**Importación del estado de sesión (novedad en v0.8.5)**: la herramienta `bcdp_login_import` copia **por dominio** las cookies de sesión de tu Chrome/Edge/Brave cotidiano al navegador del agente (arranque headless del binario real + lectura transparente vía CDP, compatible con la App-Bound Encryption de Chrome 127+, sin descifrado offline; si el navegador de origen está en marcha se puede cerrar con elegancia antes de importar, la ventana se restaura en el siguiente arranque). Los valores de las cookies no aparecen en ningún registro ni salida; antes de importar, la base de cookies de origen se respalda automáticamente y se restaura ante un vaciado anómalo. Combinado con el Profile persistente en disco por defecto, el estado de sesión importado sobrevive a los reinicios de forma permanente.

Un **proxy de navegador CDP**: integra [CitroLabs/ego-lite](https://github.com/CitroLabs/ego-lite) (un Chromium para agentes de IA) como runtime incorporada en el DeepSeek Harness, maneja el navegador con **38 herramientas estructuradas `bcdp_*`** y lo acompaña de un **frontend de observación en tiempo real** — mientras el agente opera páginas en segundo plano, ves cada página que visita como una retransmisión en directo y puedes incluso intervenir directamente.

**Una particularidad propia (self-observation)**: el agente usa precisamente este Chromium — incluso cuando maneja **el propio DSH** (gestión de sesiones, tablero de tareas, ajustes), la ventana de observación lo muestra en directo y puedes tomar el control en cualquier momento. No se trata solo de «ver al agente trabajar en la web»: hasta la manipulación de la propia interfaz de DSH por parte del agente es íntegramente visible y controlable.

**Listo para usar**: el paquete del plugin incorpora la runtime ego (`runtime/`, MIT, ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — sin clonar el repositorio oficial, sin compilar a mano; el wrapper `--no-sandbox` viene con el paquete: root / Docker / máquinas sin pantalla arrancan en un paso.

---

## Nuestras verdaderas ventajas (no eslóganes, sino capacidades verificables en el código y frente a la competencia)

Otros plugins que conectan ego-lite a DSH sacan de él solo **3 herramientas** — un script `run`, una guía `help`, una comprobación `status` — y el navegador sigue siendo una **caja negra en segundo plano**. Este plugin sigue otro camino: **abrir la caja negra y, desde el primer momento, dar plenamente las capacidades de «ver» y de «controlar»**.

| Capacidad | Este plugin (este repositorio) | Plugin similar (Da1dr1em/dsh-ego-browser) |
|---|---|---|
| Número de herramientas estructuradas | **38**, responsabilidad única, invocación determinista | **3** (`run`/`help`/`status`) |
| Ventana de observación en tiempo real (doble backend CDP JPEG / FFmpeg H.264 + barra de pestañas + cajón de historial) | ✅ Sí | ❌ No |
| Manipulación **directa** con el ratón del navegador real desde la ventana de observación (clic/arrastrar/scroll devueltos al CDP) | ✅ Sí | ❌ No |
| **Selección de un elemento en la ventana de observación → captura y referencia en el campo de entrada de la conversación** (bloque estructurado `[CDP-PICKS]`, señalización manual del objetivo) | ✅ Sí | ❌ No |
| Guardia de instancia única del worker + autorreparación ante cuelgues/duplicados | ✅ Sí | ❌ No |
| Captura de descargas `bcdp_download` / detección de captchas `bcdp_captcha`/`bcdp_page_info` | ✅ Sí | ❌ No |
| Adaptación a plataformas (detección automática Linux/macOS/Windows + retrocesos root/headless/`--no-sandbox`) | ✅ Todas las plataformas | Solo host de vista previa Windows, configuración manual |
| Persistencia en disco del estado de sesión `bcdp_auth_flush` | ✅ Sí | ⚠️ Solo mención a nivel de documentación |

**Tres diferencias clave:**
- **Ver**: en otros casos es una caja negra que «al terminar te cuenta el resultado»; nosotros retransmitimos en directo — **ves al agente operar** y detectas al instante si se atasca en un captcha o toma un mal camino.
- **Controlar**: en otros casos solo lectura; nuestra ventana de observación **maneja directamente** el mismo navegador del agente — si hace falta, tomas tú el control (zoom/arrastrar/clic), sin interrumpir al agente ni empezar de nuevo.
- **Señalar con precisión**: **seleccionas** un elemento de la página en la ventana de observación; el plugin captura su `backendNodeId`/`tag`/`id` y descripción semántica, y lo incorpora como bloque estructurado `[CDP-PICKS]` al borrador del campo de entrada de la conversación (las selecciones múltiples en una misma página se fusionan y numeran automáticamente) — el agente recibe un objetivo exacto, sin tener que adivinar «a qué botón te refieres».

> La comparación anterior se basa en hechos públicos verificables: el código de este repositorio (`bin/cdp-cast-worker.mjs` streaming en tiempo real + devolución de entradas CDP, `lib/index.js` con 38 herramientas registradas, `lib/cast-server.js` puente hacia el host, `deliverPickToConversation` en `lib/client.js` para las referencias de selección) y el código fuente/README del plugin similar (cuyo `src/tools.ts` registra únicamente `ego_browser_run` / `ego_browser_help` / `ego_browser_status`). Este documento no menosprecia a nadie — solo afirmamos qué capacidades hemos implementado y verificado además.

**Frente al propio [ego-lite](https://github.com/CitroLabs/ego-lite), esto es lo que añadimos (todo verificable en el código de este repositorio):**

| Capacidad | Descripción (código correspondiente) |
|---|---|
| **Frontend de observación** | ego-lite por sí solo es un CLI headless (solo scripts heredoc + salida textual); le hemos añadido **streaming SSE en tiempo real + barra de pestañas + cajón de historial + manipulación directa con el ratón desde la ventana de observación + selección de elementos con referencia en el campo de entrada** (`bin/cdp-cast-worker.mjs`, `lib/cast-server.js`, `createPickControl`/`deliverPickToConversation` en `lib/client.js`), convirtiendo «ver», «controlar» y «señalar» en capacidades de primer orden |
| **Listo para usar + autosuficiente en todas las plataformas** | `resolveEgoEnv` detecta automáticamente Chrome/Edge/Brave, wrapper `--no-sandbox` incorporado, cero configuración bajo root / Docker / sin pantalla (`lib/index.js`); no hace falta instalar antes un host GUI como exige la vía oficial |
| **Capa de robustez** | Reintentos automáticos en el arranque en frío (solo se reintentan fallos CDP transitorios, los errores reales no se tragan), guardia de instancia única del worker + reinicio automático tras cuelgue, teardown del plugin en fire-and-forget sin bloquear la salida del host, techo del caché de fotogramas en el frontend (`withWarmupRetry` / `makeEnsureWorker` / `frameCache`) |
| **Herramientas de operación** | `bcdp_doctor` (diagnóstico del entorno), `bcdp_captcha` (detección de captchas), `bcdp_auth_flush` (persistencia de sesión), `bcdp_login_import` (importación de sesión desde el navegador del sistema), `bcdp_http` (peticiones en el contexto del navegador), etc. — una capa que los helpers CLI nativos no ofrecen |
| **self-observation** | Incluso cuando el agente maneja la propia interfaz de DSH, todo es visible en directo y se puede tomar el control |

> No pretendemos igualar los snapshots a nivel de kernel ni la experiencia multiwindow nativa de la app macOS oficial; este repositorio resuelve: «traer las mismas capacidades de navegador a DSH + Linux/WSL — y hacerlo visible».

---

## Qué problema resuelve

Los navegadores genéricos no están pensados para agentes, y gran parte de las interacciones web (estados de sesión, captchas, renderizado dinámico, formularios, sitios que exigen sesión humana) solo pueden afrontarse con un navegador real — de ahí la herencia de la familia ego del upstream: **«dejar que el agente use tu navegador ya con sesión iniciada, sin molestarte»** ([sitio oficial](https://github.com/CitroLabs/ego-lite)).

Este plugin lo conecta a DSH y resuelve el punto más doloroso — **no ves lo que hace el agente ni puedes intervenir** — con una ventana de observación:

> 🌐 Un clic en la bolita abre la retransmisión; 🟦 barra de pestañas para cambiar/cerrar; 🕘 cajón de historial para revisar; 🔍 zoom y desplazamiento; 🖱️ toma de control directa del navegador real desde la ventana. **En una frase: el agente trabaja en el navegador, tú lo ves todo y puedes tomar el control en cualquier momento.**

### Algunos escenarios típicos de arranque

- **Documentación / recolección de datos**: pide al agente que entre en CNKI / Google Scholar y recolecte página a página; desde la ventana de observación lo ves desplazarse, pulsar «siguiente página», descargar PDFs — si se atasca por el camino, te das cuenta al momento.
- **Formularios y sesiones**: el agente rellena un formulario a medias, en la ventana de observación aparece un captcha — tomas el control, resuelves el captcha y devuelves el mando al agente para que continúe.
- **QA / pruebas de humo**: pide al agente que recorra con clics tu propio producto; la ventana de observación se convierte en una «grabación de pantalla que habla», con el añadido del repaso del historial.
- **Ver al agente manejar el propio DSH** (self-observation): cuando el agente gestiona sesiones / ajusta los ajustes, todo es visible en la ventana de observación y puedes intervenir.

---

---

## Requisitos previos

| Requisito | Notas |
|---|---|
| Node ≥ 22 | Incluido con el entorno del harness |
| **Cualquier Chrome / Chromium / Brave / Edge** | Detección automática, o `EGO_LINUX_CHROME` para indicarlo; bajo root con el wrapper incluido |
| DSH + dshx | Mecanismo de carga de plugins |
| DSH Web con interfaz gráfica (para la ventana de observación) | Las sesiones headless siguen pudiendo usar las herramientas `bcdp_*`, simplemente sin ventana de observación |

## Instalación

**Método 1: instalación directa desde GitHub (recomendado)**

```sh
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp
# También se puede fijar a un commit / tag concreto:
dsh plugin --profile web add github:drscrewdriver/dsh-browser-cdp#v0.9.0
```

> La instalación `github:` recupera el tarball del repositorio mediante pnpm pasando por `codeload.github.com`, **sin publicar nada en el registro npm**; usa directamente el `lib/` **precompilado y versionado** del repositorio (`files` contiene solo `lib/`, `bin/`, `runtime/`, `cordis.patch.yml`, `dsh-plugin.json`), por lo que **no se activa ningún script de build** y no hacen falta devDependencies. La entrada del host `lib/index.js`, el cliente `lib/client.js` y el worker `bin/cdp-cast-worker.mjs` se distribuyen todos con el repositorio.

**Método 2: tarball local / URL git**

```sh
dshx install dsh-browser-cdp <dsh-browser-cdp.tgz>      # tarball o URL git, ambos válidos
dshx list                                                # debe mostrar: [on] dsh-browser-cdp
```

> **Nota sobre el renombrado del paquete**: el nombre del paquete de este plugin es **`dsh-browser-cdp`** (nombres anteriores: `dsh-ego-browser`, alias `@dsh-external/ego-browser`). Desde DSH Desktop 2.0.5 existe una comprobación de coherencia «nombre de dependencia del profile == nombre real del paquete»: si el profile aún referencia el nombre antiguo, el arranque cae en modo de recuperación. Tras actualizar, renombra **tanto** la clave de dependencia en el `package.json` del profile **como** la entrada en `dsh.profile.bundles` a `dsh-browser-cdp`:

   ```diff
   - "dsh-ego-browser": "github:Fisfzy/ego-browser",
   + "dsh-browser-cdp": "github:drscrewdriver/dsh-browser-cdp",
   ```

   ```diff
   - "dsh-ego-browser",
   + "dsh-browser-cdp",
   ```

En los ajustes de la ventana de observación se pueden elegir `captureBackend=auto|cdp|ffmpeg` (por defecto `auto`, actualmente resuelto a CDP), los niveles de calidad, CDP FPS/calidad JPEG/anchura máxima, así como FFmpeg FPS/anchura máxima/bitrate/codificador/ruta personalizada. El plugin comprueba primero la ruta personalizada, el PATH del sistema y el caché gestionado; la descarga de GitHub puede sustituir `https://github.com` por `githubMirror`, por ejemplo `https://gh-proxy.com/github.com`. El bitrate de FFmpeg va de 500 a 20000 kbps, con valores por defecto 2000/4000/8000 kbps para los niveles bajo/equilibrado/alto.

Sin ninguna configuración del lado del host: `resolveEgoEnv` detecta automáticamente root / ausencia de pantalla y aplica los retrocesos. Las rutas del host para la ventana de observación (`/api/bcdp/spaces` etc.) solo se registran si existe un servidor HTTP; en headless son un no-op seguro.

## Formas de conexión: endpoint CDP / CLI ego local

La lista de conexiones del panel de ajustes está **ordenada** — **el orden es la prioridad**, y el elemento activado gobierna cada llamada `bcdp_*`. Hay dos tipos de elementos:

| Tipo | Qué hace | Restricciones |
|---|---|---|
| **Endpoint CDP** | Pasa la dirección de un navegador con puerto de depuración ya abierto al runtime incorporado (inyección de `EGO_LINUX_CDP_URL`), que se **adhiere** a él | Se permiten varios |
| **CLI ego local** | El CLI ego de la máquina maneja **por sí mismo** su navegador ego-lite local — **no se inyecta ningún endpoint** | **Solo máquina local, como máximo uno a nivel global** |

**Por qué existe el segundo tipo**: el `EGO_LINUX_CDP_URL` inyectado es un contrato privado del **port Linux incorporado**; el `ego-browser` nativo que acompaña a la app `ego lite` en macOS **simplemente no lo lee**. Si «endpoint CDP» fuese el único tipo, los usuarios de macOS no podrían aprovechar su ego-lite ya con sesión iniciada — tendrían que conectarse a un puerto remoto o dejar que el port arrancara un Chromium de stock. El tipo CLI local cierra exactamente esa brecha.

Orden de resolución (con `cliPath` vacío): ruta explícita → `ego-browser` en el PATH → helper dentro del paquete de la app macOS (`/Applications/ego lite.app/…/Helpers/ego-browser`) → runtime incorporada del plugin.

Dos valores por defecto que conviene conocer:

- **`--sdk-path` está desactivado por defecto**: por defecto se usa el harness que trae el CLI (el emparejado oficial); solo al activarlo se inyecta el paquete harness de este plugin. Si el CLI no reconoce ese flag, el plugin registra una pista y **reintenta automáticamente una vez sin él** — toda la cadena no queda por ello inutilizada.
- **La sonda de disponibilidad pasa una vez por un heredoc real** (el mismo canal usado para el trabajo real), así que **no es gratuita**: la sonda puede desencadenar el arranque en frío del navegador de fondo (medidos unos 1,3 s con el port incorporado).

Relación con otros interruptores:

- `cdpMode`: `auto` sigue al elemento activado (ambos tipos valen); `remote` **solo acepta endpoints CDP** y avisa explícitamente `mode-kind-mismatch` si el elemento activado es un CLI local; `local` va por el lanzador local gestionado.
- `remoteEnabled` (interruptor general remoto) **solo gobierna el CDP remoto**, sin efecto sobre las conexiones CLI locales.
- `allowLocalFallback` / `localHeadless` / `localUserDataDir` actúan solo sobre el retroceso de los endpoints CDP y los arranques gestionados.

`bcdp_doctor` informa del recuento de tipos de la secuencia actual, la ruta realmente resuelta del CLI y su forma, así como (si el plugin upstream `dsh-ego-browser` está instalado en la misma máquina) un aviso de coexistencia.

## Lista de herramientas (38, prefijo `bcdp_`, índice completo en `bcdp_help`)

| Categoría | Herramientas |
|---|---|
| Espacios de tareas | `bcdp_space_open` `bcdp_space_close` `bcdp_status` |
| Lectura de páginas | `bcdp_snapshot` (árbol semántico) `bcdp_page_info` `bcdp_read_element` |
| Navegación/espera | `bcdp_navigate` (reutiliza la pestaña) `bcdp_wait` `bcdp_wait_for_selector` `bcdp_wait_for_url` `bcdp_wait_for_response` |
| Interacción | `bcdp_click` `bcdp_fill` `bcdp_hover` `bcdp_drag` `bcdp_select` `bcdp_check` `bcdp_key` `bcdp_scroll` |
| Ejecución/depuración | `bcdp_js` (evaluación en la página) `bcdp_cdp` (CDP crudo) `bcdp_cli` (heredoc arbitrario) `bcdp_script` (script multietapa) |
| Salidas | `bcdp_screenshot` `bcdp_download` `bcdp_upload` |
| Sesión/seguridad | `bcdp_auth_flush` (persistencia de sesión) `bcdp_login_import` (importación de sesión entre navegadores) `bcdp_captcha` `bcdp_dialog` |
| Metaherramientas | `bcdp_help` `bcdp_doctor` `bcdp_http` |
| Revisión (JEV/Laya, servicio externo de juicio opcional) | `bcdp_jev_status` `bcdp_jev_frame` `bcdp_jev_ask` `bcdp_jev_run` `bcdp_jev_attempt` |

## Cómo usar la ventana de observación

La **🌐 bolita permanente** en la esquina inferior derecha → clic para abrir:

- **Vista principal**: retransmisión en directo de la página actual del agente; clic/arrastrar/rueda actúan directamente sobre la página, Ctrl+rueda para hacer zoom, Ctrl+arrastrar para desplazar, doble clic para restablecer. Tras un clic en la vista se puede escribir directamente con el teclado: IME chino, pegar, Tab/Intro/flechas y atajos Ctrl/Cmd admitidos.
- **Selección de elemento** (referencia por selección): pulsa el botón de la barra de herramientas para entrar en modo selección y luego haz clic en cualquier elemento de la vista en directo — el plugin captura su `backendNodeId`/`tag`/`id` y descripción semántica, y lo incorpora como bloque estructurado `[CDP-PICKS]` al borrador del campo de entrada de la conversación; las selecciones múltiples en la misma página se fusionan automáticamente en el mismo bloque y se numeran en secuencia, y el agente las usa con precisión por número. Funciona tanto con la bolita flotante como con la pestaña de la barra lateral.
- **Barra de pestañas**: fila horizontal arriba, clic para cambiar, `×` para cerrar.
- **Cajón de historial** (🕘): repasar la traza de visitas en orden cronológico.
- Durante las acciones, la línea de URL de abajo muestra los avisos en el sitio y se restaura a los 2 segundos.
- Tras cerrar el panel, ocultar la pestaña de la sidebar o desmontar el componente, la producción de imágenes se detiene al terminar la cortesía de 1,5 segundos. Que la ventana de DSH pase a segundo plano por sí sola no detiene el streaming, para evitar reconstruir WGC/FFmpeg repetidamente al volver al primer plano; un cierre anómalo queda cubierto por el plazo de gracia del lease del worker de 120 segundos.

### Backends de imagen

- `cdp`: JPEG vía `Page.startScreencast`, 20 FPS por defecto. Cada fotograma fuente se acusa inmediatamente (ACK) con el ID de fotograma proporcionado por Chrome; solo se conserva el último fotograma pendiente; solo se captura la pestaña que se está viendo, y las páginas estáticas vuelven por defecto a una captura cada 3 segundos.
- `ffmpeg`: en Windows `gfxcapture(hwnd)` captura directamente la superficie D3D11 de la ventana Chrome objetivo; las demás plataformas usan un recorte de la fuente de pantalla. Después codificación H.264 fragmented MP4 → trozos binarios HTTP → MediaSource `<video>`, sin pasar por Base64/SSE.
- `auto`: por defecto se elige CDP; si la detección falla, FFmpeg no se descarga automáticamente. FFmpeg solo es seleccionable una vez instalado y superada la comprobación de capacidades; si un backend FFmpeg guardado deja de ser válido, la sesión de observación retrocede a CDP mostrando el motivo.
- En Windows FFmpeg debe incluir `gfxcapture`. El plugin empareja el HWND mediante el PID del navegador, el título del target y los límites de ventana CDP; la captura de la página objetivo continúa aunque la ventana se mueva o quede tapada, y está prohibido retroceder a la grabación del escritorio. Si el target es una pestaña en segundo plano de la misma ventana Chrome, se emite un error explícito en lugar de mostrar la pestaña visible o robar el foco. En macOS se necesita el permiso «Grabación de pantalla» en el primer uso; en X11 Chromium y FFmpeg deben compartir el mismo `DISPLAY`; en Wayland, ante la falta de entrada Portal/PipeWire, aparece un aviso para volver al CDP.

La instalación gestionada de FFmpeg va a `~/.dsh/cache/ego-browser/ffmpeg/`, sin escribir nada en el directorio del plugin. Windows/Linux usan un tag de release BtbN fijo; macOS usa assets fijos del release de GitHub `ffmpeg-static` (sus binarios Intel/Apple Silicon proceden respectivamente de Evermeet/OSXExperts). Todas las descargas fijan el SHA-256 del recurso; solo se extrae el ejecutable principal de FFmpeg, sin instalar `ffprobe` ni `ffplay`. En Windows/Linux el desempaquetado usa el `tar` del sistema; si falta, aparece un error explícito antes de la descarga.

> Nota sobre el estado de sesión: las cookies de los espacios de tareas están aisladas entre sí — inicia sesión en el espacio correspondiente. Tras reiniciar DSH, el estado de sesión en ejecución se borra (las cookies de ejecución de Chrome solo se escriben en disco al cerrar con elegancia), hará falta volver a iniciar sesión — escanear el código QR es rápido.

## Cómo funciona

- **Capa de herramientas**: cada herramienta arma sus parámetros en un script JS, que se entrega por stdin a `ego-browser nodejs` mediante `ctx.subprocess`, con el host manejando el Chromium compartido vía CDP. Los resultados se analizan gracias a la línea centinela `@@DSH_RESULT@@`. Todos los `bcdp_*` se serializan con un mutex dentro del proceso, los errores se normalizan de forma uniforme.
- **Ventana de observación**: `lib/client.js` gestiona el lease del watcher, el `<img>` JPEG y el `<video>` MSE; `lib/cast-server.js` retransmite el SSE de metadata, la API watch y el vídeo binario con contrapresión; en el worker, `CaptureManager` garantiza un único backend activo y un único target actual. El plano de control CDP (pestañas, viewport, entrada, captcha) es independiente del backend de imagen.

## Pipeline estilo JEV: dejar que el LLM gobierne el bucle del navegador (fase 10)

El **contrato de fotograma** «un fotograma ≡ captura de pantalla + DOM numerado + intención + progreso de las acciones», junto con la **costura de juicio** «el juez responde solo con números, jamás con selectores», se concreta en un pipeline ejecutable, testeable y archivable. El juicio lo aporta un servicio externo **Laya / JEV** (ver más abajo), el bucle lo gobierna este plugin.

**Cuatro herramientas** (`defineTool` del lado del host; las peticiones de juicio salen por HTTP desde el proceso del plugin, sin pasar por la sesión del agente):

| Herramienta | Qué hace | Cuándo usarla |
|---|---|---|
| `bcdp_jev_status` | **Ejecutarla primero**: disponibilidad de la cadena de juicio + diagnóstico de configuración, **no envía ninguna petición** | Primer paso cuando se sospecha un problema de config/cadena |
| `bcdp_jev_frame` | Captura un fotograma (captura de pantalla + candidatos numerados + intención), para ver lo que verá el juez | Depurar el contenido de los fotogramas, comprobar la numeración de candidatos |
| `bcdp_jev_ask` | Ensambla el cuerpo de la petición; `dryRun` es true por defecto, `round=control\|chapter\|pick\|evaluate` permite examinar por niveles antes de enviar | Ver con claridad la petición de juicio antes de enviarla |
| `bcdp_jev_run` | Ejecuta el bucle completo y devuelve la traza paso a paso (candidatos / top / presupuesto / acierto de cada paso) | Cuando de verdad quieras dejarlo actuar |

**La cadena por defecto es `laya → rule`**. JEV de momento no puede registrarse, por eso no se escribe por defecto; cuando sea posible bastará con reintroducir `jev` en el orden de preferencia `judgePrefer` y rellenar `jevUrl`. Sin clave, `bcdp_jev_status` imprime por iniciativa propia cómo levantar el servicio en local (`ENGINE=laya … uvicorn laya_api.main:app`, puerto **8000** y no 7789, `ALLOW_DEV_LOGIN=true` para crear una clave). Los jueces no disponibles se **saltan sin llamarlos** (laya exige autenticación sin rama anónima, faltar la clave implica inevitablemente un 401); cada salto y cada fallo entran en la traza, jamás retrocesos silenciosos; `refuse` es un resultado, no una excepción.

**Reducción en tres niveles (el LLM gobierna el proceso en vez de adivinarlo todo de una vez)**:
1. `control` — actuar o no (5 opciones fijas: `pick_button` / `sleep` / `next` / `prev` / `done`);
2. `chapter` — qué capítulo (agrupación por contenedores AX, subiendo por la cadena paternal de los `childIds` hacia el ancestro estructurado más próximo, como `form#1` / `form#2`; con un solo capítulo esta ronda se salta);
3. `pick` — qué número elegir dentro del capítulo + un `score` de riesgo.

La división en capítulos no es decorativa: los umbrales se reparten en cubos según el número de candidatos, y **descomponer un 20-a-1 en «unos-pocos-a-1 × unos-pocos-a-1» hace que ambas rondas caigan en cubos más estrictos** (`top≥0.5` y `top−second≥0.15`), más controlables que un 20-a-1 único (`top≥0.6`). El juez **responde solo con números**; coordenadas/selectores los remide cada vez la capa de ejecución (`DOM.getBoxModel` + reverificación del punto con `DOM.getNodeForLocation` antes del clic); los rectángulos del fotograma nunca sirven de base al clic.

**El contexto de juicio está aislado**: solo se admiten los cuatro segmentos `INTENT` / `PROGRESS` / `FRAME` / `HISTORY`, **jamás el prefijo de sesión de la sesión del agente**; cualquier segmento extra provoca un error inmediato en el ensamblado (por aserción, no por convención). `PROGRESS` (número de pasos / intentos y resultados por capítulo / acciones realmente logradas / presupuesto restante) lo **genera mecánicamente** el propio bucle, no lo escribe el modelo — el progreso escrito por un modelo es el segundo canal de alucinación más difícil de descubrir.

**Interruptor de evaluación `jevEvaluate` (activado por defecto, se puede desactivar en el panel de ajustes)**: tras cada paso ejecutado, el juez reevalúa el progreso: `inprogress` / `done` / `fail`. Ante `fail` o un «done sin verificar» no se adivina el siguiente paso: se **pasa a `escalate`** — con una lista ordenada de `RecoveryOption` (por ejemplo, primero `reload` para refrescar, porque un render obsoleto puede ocultar una confirmación ya escrita), dejando al LLM decidir entre recuperarse o detenerse.

**Estados terminales del bucle**: `done` (autoverificación contra `successCriteria`) / `blocked` (detenido por el presupuesto) / `exhausted` (presupuesto agotado, con `exhaustedKind`) / `stuck` (mismo ancla y misma acción 3 veces seguidas sin cambios) / `unavailable` (sin juez) / `error` / `escalate`.

> Registro honesto del estado actual: esta fase ha demostrado que **protocolo, umbrales, terminación, capítulos, ensamblado y aislamiento** son correctos (cubierto por los tests unitarios `bcdp_jev_*`), pero **el recorrido de extremo a extremo sobre un navegador real aún no se ha ejecutado** (T10.22 pendiente); la **precisión** del juicio no se ha medido en campo (los cubos de umbrales sirven para calibrar, no prueban que las elecciones sean acertadas). Los elementos operados archivados conservan los rasgos de localización como `class` (solo se despojan los tokens de envoltura del inspector), para devolvérselos al LLM en un escalate y facilitar la recuperación.

## Desarrollo

El código fuente está en `src/` (TypeScript), los artefactos de build en `lib/` (bundles de host + cliente) y `bin/cdp-cast-worker.mjs` (bundle del worker).

```sh
pnpm typecheck   # barrera de tipos tsc (tsconfig.json principal + tsconfig.client.json cliente)
pnpm test        # tests unitarios vitest
pnpm run build   # tres bundles tsdown: lib/index.js + lib/client.js + bin/cdp-cast-worker.mjs
```

> Edita directamente `src/` (`src/index.ts` capa de herramientas, `src/client/index.ts` frontend, `src/worker/cdp-cast-worker.ts` worker). Añade las nuevas herramientas en `registerActionTools` con `t({...})`, completa el índice `bcdp_help` (`src/help.ts`) y ejecuta `pnpm typecheck && pnpm test && pnpm run build`. `lib/` y `bin/cdp-cast-worker.mjs` son artefactos de build (precompilados y versionados), no los edites a mano.

`node_modules/` solo contiene enlaces simbólicos a un checkout de DSH (resolución de tipos en compilación); en ejecución, el harness resuelve `@deepseek-ai/dsh-tools`.

## Limitaciones conocidas (dichas con honestidad)

- **Windows**: adaptado a nivel de plugin desde v0.4.0; la runtime ego-lite subyacente sigue siendo un port comunitario sin soporte oficial en Windows — la estabilidad de flujos complejos de varios pasos puede ser inferior a macOS.
- **Captura FFmpeg por plataforma**: Windows ya usa `gfxcapture(HWND)`, que exige un build reciente con ese filtro; un FFmpeg antiguo en el PATH se salta con la sugerencia de descargar una versión compatible. Linux usa `x11grab`, macOS `avfoundation` como recorte de pantalla; ScreenCaptureKit en macOS y un helper Portal para Wayland son mejoras futuras.
- **Entorno de instalación**: los paquetes peer de DSH de este repositorio no están todos en el registro npm público. Un `pnpm install` normal puede fallar al resolver los peers `@deepseek-ai/*`; la instalación vía profile de DSH debe aportar esos peers. CDP no depende de FFmpeg y no descarga binarios durante la instalación del plugin.
- **Calidad de los snapshots**: en Linux el árbol semántico se reconstruye vía CDP `DOMSnapshot`, no a nivel de kernel como en macOS — escenarios complejos con iframe/canvas pueden degradar.
- **Fiabilidad del host (Linux)**: PR comunitarios sin fusionar — el estado de pestañas/espacios puede perderse entre llamadas CLI cruzadas; el plugin va defendido: los flujos simples son estables, los complejos pueden requerir reintentos.
- **Persistencia del estado de sesión**: las cookies de ejecución de Chrome solo se escriben en disco al cerrar con elegancia; tras un cierre forzado y reinicio hará falta volver a iniciar sesión.
- El esquema de salida es permisivo (`additionalProperties: true`); el cliente se guía por los valores realmente devueltos.

## Licencia y atribución

El plugin en sí está bajo MIT. La runtime incorporada integra código MIT de ego-lite; los builds FFmpeg descargables opcionalmente conllevan obligaciones GPL-3.0-or-later. Antes de usar o redistribuir, lee las licencias de las fuentes de build y la información sobre obtención del código fuente — ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Cadena de suministro y permisos

Hechos deterministas aportados para la inclusión en directorios y la revisión:

- **Archivos de ejecución**: `lib/` (artefactos de build, generados de forma determinista desde el TypeScript de `src/` con `npm run build` mediante tsdown), `bin/` (scripts ejecutables de entrada del worker y de ffmpeg-probe), `cordis.patch.yml` (capa de ensamblado), `dsh-plugin.json` (manifiesto). Los `*.map` son solo sourcemaps de depuración, sin papel en ejecución, declarados excluidos.
- **Artefactos nativos/ejecutables**: `runtime/` incorpora la runtime ego-lite (MIT; procedencia e inventario archivo por archivo en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) — es la función central del plugin (host Chrome/CDP gestionado y autosuficiente), un artefacto ejecutable transportado a propósito, no un subproducto de build. `runtime/PATCHES.md` documenta todos los parches locales aplicados al upstream.
- **Dependencias**: la única dependencia en ejecución es `@deepseek-ai/schemastery` (una implementación equivalente la aporta el host DSH); las peer dependencies son todas servicios del host `@deepseek-ai/dsh-*`. Los módulos externos del bundle cliente los resuelve la tabla de módulos del host, sin arrastrar dependencias npm.
- **Servicios externos**: sin telemetría, sin llamadas a APIs externas. El único comportamiento de red es **opcional**: el instalador de FFmpeg descarga un build desde GitHub (o el espejo configurado por el usuario) por instrucción del usuario; verificación de fuentes y obligaciones de licencia: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Fronteras de fallo**: sin webServer en el host (TUI/headless) las rutas watch se saltan con seguridad; si el worker no arranca, las rutas watch devuelven un JSON con `ok:false` en lugar de quedarse colgadas; los procesos del navegador terminan junto con el teardown del host (`--stop` en fire-and-forget, sin bloquear la salida del host).
- **Permisos**: el campo `permissions` del manifiesto está vacío — las lecturas/escrituras de archivos del conjunto de herramientas quedan confinadas a los directorios de espacios gestionados por ego y al área de trabajo del usuario; el acceso a red va por el navegador del agente gestionado, no por el proceso del host.

---

## Enlaces amigos

También obras del ecosistema de plugins de DeepSeek Harness, nos recomendamos mutuamente:
