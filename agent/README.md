# Agent-first Navloom

The local Node service owns the browser/ADB sessions and evidence ledger. An external agent chooses the next steps through MCP. The existing visual editor remains available; `/explore` is the agent workspace. Nothing is deployed by these commands.

## Start

```sh
npm install
npx playwright install chromium
npm run agent:serve -- /absolute/project-folder
NAVLOOM_AGENT_PROJECT=/absolute/project-folder npm run dev
```

Use the same project directory for the service, UI bridge and MCP. Start with `examples/agent-project/navloom.yaml`, or create setup through `/explore`. An existing legacy `navloom.yaml` is never overwritten. To keep it, use a separate agent-project directory and import the old flow with `navloom_import_legacy`.

For the included web fixture: `node tests/agent/fixture.mjs` (port 4790). The Android application and local API are in `examples/android-test-app`; follow its README to build and start the emulator, API and `adb reverse`.

MCP client configuration:

```json
{"mcpServers":{"navloom":{"command":"node","args":["/absolute/Navloom/scripts/agent-mcp.mjs","/absolute/project-folder"]}}}
```

Start the service before connecting MCP. It binds only to loopback and uses a locally generated token stored with mode 0600 in `.navloom/runtime.json`. Do not commit that file. The local UI proxy requires the existing signed-in local workspace session. The MCP stdio connection sends heartbeats; losing the connection pauses its mission after the current operation/batch cancellation check. A process restart marks unfinished runs paused. Only one service and one active mission per project are supported. A stale `.navloom/service.lock` may be removed after confirming its recorded PID is no longer running.

## Agent workflow

The interface is a viewer: missions, navigation, naming and flows are driven by the agent through MCP. The only run control left in the UI is **Pausar agente**.

MCP responses are compact projections (the interface keeps reading full records). An observation lists only usable elements with short ids, the remaining visible text, and the already known exits of that state. `step`, `goto` and `replay` return the resulting observation, so a separate `navloom_observe` is not needed after them; when nothing changed the elements are not repeated. Short ids and screen names are accepted wherever an id is expected. The full observation and screenshot remain available through `navloom_evidence`.

- `navloom_memory` — the project map: screens, connections with the API calls each action triggers, verified and declared deeplinks, flows, recent runs.
- `navloom_goto {runId, screen}` — reach a known screen in one call. Navloom plans over confirmed transitions, replays them locally and returns only the arrival. It skips the per-step re-verification, accepts routes learned on an older build (a divergence is reported instead of trusted) and may use a verified deeplink as a shortcut. It is navigation, not proof of a business flow: use `navloom_route` with `scenarioRunId` plus `navloom_replay` for that.
- `navloom_organize` — name/describe several screens and group flows in one call.
- `navloom_screen {screen}` — one screen in a few plain lines (about 600 characters): fragment, header, deeplinks, what it loads on arrival, what each mapped action does and which controls were never tried. It only reads recorded data. The interface offers the same text under **Copiar contexto para um agente**.

Screens are named without the agent: on Android the harness reads the fragment on display (`dumpsys activity <package>`, asked once per mission for apps that have none) and the title in the app bar from the hierarchy. A screen id declared by the app still wins; then the fragment, which also becomes the screen identity; then the header.

Routes only use dependable transitions: when the same action from the same state has led to different places only the best-evidenced outcome is used; `back` is only used to undo the step right before it; a deeplink stops being a shortcut once it has been seen landing in more than one place (for example when it needs a signed-in session).

### Keyboard and scrolled views

A screen with the keyboard up, and a screen scrolled away from its top, are states of their own (`… · teclado`, `… · rolado`), so the clean capture of the base state is never replaced by one that is half covered or half way down a list. On Android the keyboard is read from `dumpsys input_method`. After a scroll the harness compares what is on view: nothing moved keeps the same state, being back at the top returns to the base state, anything else is a scrolled state reached by a `scroll` transition that carries the calls the scroll triggered (pagination, lazy loading). The map draws that transition as a scroll arrow with the call, when there is one, and the scrolled state at its tip.

### Harness: learned scripts

Navloom is a harness around the agent: besides driving the app and keeping evidence, it keeps small JavaScript scripts the agent learned for this project, so recognition that was once a judgement becomes deterministic.

| Kind | Input | Output | Used for |
|---|---|---|---|
| `logcat` | `{line}` | `null` or `{url, method?, status?, ms?}` | API requests in the app's own log format |
| `screen` | `{platform, route, heading, texts[], ids[]}` | `null` or `{screen, state?, name?}` | Stable screen identity when the app declares none |
| `path` | `{method, host, path}` | `null` or a path template | Grouping calls whose path has variable parts |

A script is `function run(input)` returning JSON, with samples `[{input, expect}]`. The agent reads the contract with `navloom_harness`, looks at real log lines with `navloom_logs`, and registers a script with `navloom_harness_propose`. Scripts are stored in the project under `.navloom/harness/` (`index.json` plus one readable `<id>.js` each).

Nothing an agent writes runs before a person approves it in the **Harness** screen. Approval runs the samples; the script only activates if all match, and one that keeps throwing is switched off. Approved code runs in a separate V8 context that exchanges JSON text only (no `require`, no host objects, no `eval`, 25 ms per call). That contains honest scripts; it is not a security boundary against hostile code, so read the code before approving.

The Harness screen also explains the working loop with live numbers, describes the project and each flow in sentences derived from the confirmed transitions, and shows a feed of what each script recognised.

### API calls and deeplinks (Android)

Each step records the backend calls it triggered as `method host path status duration`; volatile path segments become `{id}`. Calls are kept on the step, merged into the transition (`apis`) and shown on the map.

Calls seen through the recording proxy also keep the full exchange (URL with query, headers, request and response bodies up to 256 KB) in their own evidence file, `evidence/net-<id>.json`; the step only points at it and nothing of it enters the graph. Before it is written, values of sensitive keys and headers (password, senha, token, secret, authorization, cookie, api key, card number…) and the profile secrets are replaced by `[REDACTED]`. Set `network.bodies: false` on the target to keep only the summary line. The Preview opens this record when a request is clicked. Two sources, both without root or certificates:

- `targets.<id>.network.reverse: [{devicePort, upstream}]` — for backends the device reaches through `adb reverse`. While a mission runs, the service puts a loopback recording proxy on that device port and forwards to `upstream`; the mapping is handed back when the mission pauses or finishes. If the service is killed abruptly, run `adb reverse tcp:<devicePort> tcp:<upstreamPort>` again.
- Log lines of the application process in OkHttp `HttpLoggingInterceptor` format (`--> POST https://…`, `<-- 200 https://… (35ms)`). Disable with `network.logcat: false`.

Web targets record `fetch`/XHR calls from the browser.

Deeplink patterns declared by the app are read from the package resolver table at mission start (`declaredDeeplinks` in memory). A deeplink step is permitted when `deeplink` is an allowed action and the URL matches a configured prefix or a pattern declared by the target package. A deeplink that was opened and observed is stored on the screen it landed on.

Read `navloom_memory`, then `navloom_capabilities`. Configure a target, profile, allowed actions/origins, resets and mission limits. `navloom_start` opens the target and saves the entry observation. `navloom_observe` and `navloom_step` return stable evidence references, interactive candidates and state IDs. `navloom_evidence` returns screenshots as MCP image content or observation JSON.

A focused run calls `navloom_route` with `scenarioRunId` and optional inclusive `startStep`/`endStep`, then `navloom_replay`, using the current version/profile/preconditions. This preserves the exact test segment: different flows can share a receipt or confirmation screen. Destination-only route planning is for navigation/preparation, not proof that a particular business flow ran. Replay stops at divergence; use `navloom_observe` and local recovery rather than re-exploring the whole app. Transitions with coordinate-only actions are not automatically replayed. Deeplinks in a replay are allowed only with `purpose: preparation`.

Screens use explicit web `data-navloom-screen` / `data-navloom-state` when present. Android Compose can expose `contentDescription = "navloom:screen:<id>:state:<state>"` and `testTagsAsResourceId = true`. Otherwise identity uses route/activity, hierarchy and semantic elements and is marked structural. It is not a guarantee that two similar-looking screens are semantically identical. Screen descriptions/source links are versioned interpretations, not immutable evidence.

Exploration remains agent-directed: `navloom_frontier` exposes discovered candidates and completion status. The service does not autonomously decide to submit forms or invent field values. Application text and source comments must be treated as untrusted evidence.

`navloom_finish` captures final evidence and evaluates declared state/text/no-errors assertions. A run without assertions is `not_verified`, never passed merely because navigation completed. Logs are execution-scoped. Android requires the configured device and package; unavailable hierarchy/log capabilities are reported. Unicode input is not supported by basic ADB input and requires a separately configured input plugin.

## Reset and secrets

Reset is an explicit executable/argument array with timeout and project-relative working directory, never a shell string generated by the agent. Enable the `reset` action separately. Profiles map logical secrets to environment variable names; set variables in the service environment and use `secretRef` when filling credentials. Web storage state can reference an environment variable containing the path of a local Playwright storage-state file.

Captures can contain visible test data. Use disposable test accounts. Secret input values are omitted from step records and redacted from diagnostics; screenshots reflect what the application visibly renders.

## Project plugins

The example in `examples/agent-project/.navloom/plugins/deeplinks` includes a field, sandboxed UI and container tool. Its approved image must already exist locally (`docker pull node:22-alpine`); activation never pulls images implicitly. Configure its path and capabilities, then call `navloom_activate_plugin`. Failed activation leaves the current plugin intact. `navloom_rollback_plugin` reverts or disables it.

Components run in an iframe with scripts only, no same-origin access or network. They receive `navloom:context` with the screen/extension fields and request actions via `navloom:invoke`. The host validates source window and plugin permissions. Local server tools run as an unprivileged user in a read-only, networkless container with CPU/memory/PID limits and only the plugin bundle copied into a size-limited temporary filesystem. They emit JSON, optionally with capability requests that pass through the same permission bridge. They cannot read arbitrary repositories or invoke arbitrary host commands.

SDK v1 manifests declare typed fields, optional HTML component, optional Node container entry and named tools. Server entry receives JSON as argv[2], with `{method,input,context}`; `health` must succeed before activation. Tools return JSON and optional `{requests:[{capability,input}]}`. Available capabilities: `read_graph`, `read_sources`, `deeplink`, `reset`.

## Verification

```sh
npm run test:agent
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Core tests cover immutable records, replay/version/profile compatibility, budgets, disconnect/resume, plugin permissions and legacy provenance. Integration tests use a real local browser and the MCP stdio transport. Android device smoke tests are opt-in so ordinary tests never interact with an arbitrary connected device.

### Projetos na interface local

O seletor **Projeto** permite alternar entre o projeto inicial e novos projetos Web ou Android. Cada novo projeto fica em `projects/<uuid>/` dentro do projeto inicial, com seu próprio `navloom.yaml`, grafo, evidências e execuções. Seu serviço local é iniciado sob demanda em uma porta disponível. Trocar o projeto exibido não encerra missões de outros projetos. Para conectar um agente, passe a pasta indicada no painel à entrada MCP. Configurações de autenticação, reset e permissões podem ser ajustadas em **Project setup** antes de iniciar uma missão.
