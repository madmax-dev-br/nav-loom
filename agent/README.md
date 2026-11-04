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

Read `navloom_memory`, then `navloom_capabilities`. Configure a target, profile, allowed actions/origins, resets and mission limits. `navloom_start` opens the target and saves the entry observation. `navloom_observe` and `navloom_step` return stable evidence references, interactive candidates and state IDs. `navloom_evidence` returns screenshots as MCP image content or observation JSON.

A focused run calls `navloom_route` with `scenarioRunId` and optional inclusive `startStep`/`endStep`, then `navloom_replay`, using the current version/profile/preconditions. This preserves the exact test segment: different flows can share a receipt or confirmation screen. Destination-only route planning is for navigation/preparation, not proof that a particular business flow ran. Replay stops at divergence; use `navloom_observe` and local recovery rather than re-exploring the whole app. Transitions with coordinate-only actions are not automatically replayed. Deeplinks in a replay are allowed only with `purpose: preparation`.

Screens use explicit web `data-navloom-screen` / `data-navloom-state` when present. Android Compose can expose `contentDescription = "navloom:screen:<id>:state:<state>"` and `testTagsAsResourceId = true`. Otherwise identity uses route/activity, hierarchy and semantic elements and is marked structural. It is not a guarantee that two similar-looking screens are semantically identical. Screen descriptions/source links are versioned interpretations, not immutable evidence.

Every completed step also returns `outcome` (`navigation`, `state`, `scroll`, `none`), a structural diff (text, elements, markers), the pixel change region between the two captures, the API calls observed between the action and the capture, and a deterministic summary. These are stored on the transition; `navloom_describe` adds the agent's own understanding of a transition, state or flow as a separately versioned description.

Exploration remains agent-directed: `navloom_frontier` exposes discovered candidates and completion status. `navloom_probe` clicks one candidate, classifies the effect and returns with `back` when a new screen opened; `navloom_explore` repeats this in a stable order within `maxCandidates`, reaching other states only through confirmed routes and stopping at the budget, when the frontier is exhausted or when no pending candidate is reachable. It never fills forms, skips sensitive fields and labels matching `exploration.avoid`, records automatic changes (loading finished, redirects) as `wait` transitions, and does not go back from screens already visited before the origin or when the browser has no in-app history. The service does not autonomously decide to submit forms or invent field values. Application text and source comments must be treated as untrusted evidence.

`navloom_finish` captures final evidence and evaluates declared state/text/no-errors assertions. A run without assertions is `not_verified`, never passed merely because navigation completed. Logs are execution-scoped. Android requires the configured device and package; unavailable hierarchy/log capabilities are reported. Unicode input is not supported by basic ADB input and requires a separately configured input plugin.

## API calls and deeplinks

Web executors record every browser request between an action and the next capture (method, path, status, resource type, truncated JSON previews; headers are never stored). Android executors read the application process logcat since the previous step and parse OkHttp logging lines (`--> GET url`, `<-- 200 url`) and plain log lines such as `GET /api/x -> 200` or `HTTP 404 /path`; apps without request logging report no calls, and `capabilities` lists `network` as conditional. Late responses are attributed to the previous action; calls during a `wait` belong to that wait. `endpoints` in `navloom_status`/`navloom_memory` index every endpoint by transition and origin screen.

`navloom_deeplinks` returns the links declared by the installed Android package (intent filters with VIEW, parsed from `dumpsys package`), links observed on web screens, the permitted prefixes and the deeplinks verified by observed `deeplink` steps with their landing screen and state.

## Versionable map

With `map.enabled` (default), the graph is mirrored after every step, description, flow and finish into `<project>/<map.dir>/` (default `navloom-map/`): `map.yaml` (screens, states with hotspots, transitions with action, summary, description, network, diff and change region, deeplinks, endpoints, flows), `README.md` for humans, and `states/<stateId>.png` thumbnails (`map.screenshots`, `map.thumbnailWidth`). Runs, full captures and tokens stay in the ignored `.navloom/`. When `.navloom/graph.json` is missing, the service loads the map, so a fresh checkout renders known screens, routes and endpoints; thumbnails are served as `map/states/<id>.png`. Review thumbnails before committing: they show real application data.

## iOS

An `ios` target (`udid`, `bundleId`, `xcrun`) uses the simulator for `capture`, `open` and `deeplink`. Element interaction and hierarchy need an XCUITest/WebDriverAgent driver that is not bundled, so they are reported missing and `navloom_explore` has nothing to click; use deeplinks to document reachable screens.

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

Core tests cover immutable records, replay/version/profile compatibility, budgets, disconnect/resume, plugin permissions and legacy provenance. `tests/agent/mapping.test.mjs` covers the PNG codec and change regions, diffs and summaries, logcat/dumpsys parsing, probe/explore determinism, descriptions, map export/import and the iOS executor contract. Integration tests use a real local browser and the MCP stdio transport. Android device smoke tests are opt-in so ordinary tests never interact with an arbitrary connected device.

### Projetos na interface local

O seletor **Projeto** permite alternar entre o projeto inicial e novos projetos Web ou Android. Cada novo projeto fica em `projects/<uuid>/` dentro do projeto inicial, com seu próprio `navloom.yaml`, grafo, evidências e execuções. Seu serviço local é iniciado sob demanda em uma porta disponível. Trocar o projeto exibido não encerra missões de outros projetos. Para conectar um agente, passe a pasta indicada no painel à entrada MCP. Configurações de autenticação, reset e permissões podem ser ajustadas em **Project setup** antes de iniciar uma missão.
