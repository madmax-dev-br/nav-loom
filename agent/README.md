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

Start the service before connecting MCP. It binds only to loopback and uses a locally generated token stored with mode 0600 in `.navloom/runtime.json`. Do not commit that file. The local UI proxy requires the existing signed-in local workspace session. The MCP stdio connection sends heartbeats; losing the connection pauses its mission after the current operation/batch cancellation check. A process restart marks unfinished runs paused. Only one service and one active mission per project are supported. `.navloom/service.lock` (`agent/lock.mjs`) holds `{pid,started,id}` of the running service and heals itself: a start takes over the lock of a service that died without cleanup (SIGKILL, crash, power loss) and refuses only while its owner is really alive — its pid runs and, against a reused pid, the lock was touched in the last 30 s (the service touches it every 10 s) or the service of `runtime.json` answers `/health`. Nobody needs to delete it by hand.

## Agent workflow

The interface is a viewer: missions, navigation, naming and flows are driven by the agent through MCP. The only run control left in the UI is **Pausar agente**.

MCP responses are compact projections (the interface keeps reading full records). An observation lists only usable elements, one line each (`id label`, with `(fill)`, `(scroll)` or `(fill, secret)` before the label when the action is not a click), the remaining visible text, and the already known exits of that state. `step`, `goto` and `replay` return the resulting observation, so a separate `navloom_observe` is not needed after them; when nothing changed the elements are not repeated. Short ids and screen names are accepted wherever an id is expected. The full observation and screenshot remain available through `navloom_evidence`.

- `navloom_memory` — the project map: screens, connections with the API calls each action triggers, verified and declared deeplinks, flows, recent runs.
- Mission modes (`mode` of `navloom_start`, also accepted by `navloom_goto`): `record` maps new things; `validate` walks what is recorded and reports what differs; `walk` only navigates (the default of a mission `goto` opens by itself) and keeps nothing but how dependable each direct route proved. With `review: required` in `navloom.yaml` (the default) a mission never writes the recorded map: it works on a draft (`.navloom/drafts/<run>.json`, a copy taken when it starts). When it stops, `agent/review.mjs` compares the draft with that copy: `new` (a screen, state or connection that did not exist) and `different` (the same action landing on another screen, a known screen in an unrecorded state while validating, API calls that appeared, disappeared or answered with another status). With nothing to look at, the fresh captures are kept and the mission ends `unchanged`; otherwise it stays `pending` until a person approves or discards it in Execuções (`review_decide` is interface-only, never an MCP tool). Approval merges item by item, so edits made to the recorded map meanwhile are kept, and a call that no longer happens stops being expected. `review: auto` records as it goes and still reports the comparison. `navloom_review {runId}` (extended tier) returns it; `finish`/`run` include its status.
- `navloom_goto {screen}` — reach a known screen with no agent reasoning. For the destination Navloom builds a decision graph from confirmed transitions (for every known state, the one action that leads closer; `agent/navigate.mjs`) and then loops: observe, look the action up, act. Because it decides again after each step it works from wherever the app is: a state whose content changed still uses the screen's known control, text typed into a form when the route was learned is typed again, a detour through an unknown screen is left with back and, once, a restart at the entry screen (Android: force-stop and launch). Verified deeplinks are shortcuts; an action that lands elsewhere is counted (`walks`/`misses` on the transition) and costs more next time. Without `runId` it uses the active mission or starts one and returns its `runId`. `status: stuck` returns the screen where knowledge ran out and leaves the mission running: continue with `navloom_step`, and those steps join the graph. `plan: true` lists the decisions without touching the device. Results per destination are kept in `graph.routes` and shown under Harness → Rotas diretas. It is navigation, not proof of a business flow: use `navloom_route`/`navloom_replay` for that.
- Accounts and environments: a profile is an account; `environments` in `navloom.yaml` declare the same app elsewhere (a mock, staging), each with optional target overrides. Missions and `goto` take `profile`/`environment`. Screens and states are shared and record which profiles and environments saw them; transitions, their API calls and the entry screen (`graph.entries[target@environment]`) are kept per environment, the first declared one stored as the default so older maps stay valid. `goto` reuses a way learned in another environment at a small extra cost; route/replay stay strict. Validation reports a destination another account or environment explains as `variant`, not `different`. `navloom_ask kind=account` lets a person pick a profile or create one in the interface, its sign-in kept only as local secrets (`<id>_login`, `<id>_password`).
- Entry points (`agent/flowgraph.mjs`): for every screen, the shortest dependable walk from where the app opens in each environment (screens on the way, actions, secrets typed, backend writes), verified deeplinks that always landed there, controls that open it from any screen, and the screens with a direct way in; each named flow starts where its first screen starts. Listed as `entryPoints` in `navloom_memory`, as **Pontos de entrada** in the map's README and `entryPoints` in `map.yaml`, and as **Como chegar** in `navloom_screen`. When `goto` gives up it returns `diagnosis`: where it is (`unknown_screen`, `unknown_state`, `no_way_forward`), what it expected and got, and the forks the same action is known to take there; the agent analyses only then, and asks the person (`navloom_ask kind=decision`) when the scenario is not clear.
- `navloom_organize` — name/describe several screens and group flows in one call.
- `navloom_merge {into, from}` — fold screens (or `kind: state` states) recorded twice into one (see Screen recognition). `as: "state"` turns the screens in `from` into states of `into`.
- Screen links — a person copies `navloom://screen/<screenId>[?state=<stateId>]` from the map (**Copiar link**, format in `lib/screen-link.mjs`) and pastes it to the agent with what they want done. Every operation accepts the link where it takes a screen or a state (see Screen links).
- `navloom_screen {screen}` — one screen in a few plain lines (about 600 characters): fragment, header, deeplinks, what it loads on arrival, what each mapped action does and which controls were never tried. It only reads recorded data. The interface offers the same text under **Copiar contexto para um agente**.

Screens are named without the agent: on Android the harness reads the fragment on display (`dumpsys activity <package>`, asked once per mission for apps that have none) and the title in the app bar from the hierarchy. A screen id declared by the app still wins (or an approved `screen` script, which may name a screen already on the map by its id); then the fragment, which also becomes the screen identity.

### Screen recognition

Without either, a screen is recognised by what it always shows, not by its exact content (`agent/recognize.mjs`). Every screen keeps a profile: the tokens its clean captures had (resource ids, the title and its first word, control labels with numbers and amounts taken out, field ids or hints but never their values, static texts, the selected tab, the web path without ids) and how often each appeared. A capture is scored against every profile of the same Android activity: recall of what the screen always shows weighs more than precision, tokens count by kind, by how steady they are on that screen (texts seen once are taken as data, controls as structure) and by how rare they are among screens (the top bar and the tab bar are on every screen and count little). A capture that lacks most of a screen's steady controls and brings controls of its own counts against it. The navigation adds to the score: a scroll keeps the screen, typing and waiting rarely leave it, `back` returns to where the trail came from, and an action taken before from the same state likely lands where it landed. At 0.6 or more, with a margin over the runner-up, it is that screen; otherwise it is a new one and the closest ones are kept as `lookalike`. Nothing on view (a frame between screens) is a `carregando` state of the previous screen; a dialog or popup over a screen (a focused window that is not an activity, or a window smaller than the display) is a state of the screen beneath.

States are the moment a screen is in: `erro`, `carregando`, `vazio`, `concluído`, `diálogo`, read from what it shows (error texts anywhere, "nothing here" or "done" only when they are the headline), plus the keyboard, plus about the same controls (Jaccard 0.6). A text or a list that changed is the same state. The stale check before an action compares this structure, and recorded actions find their control again when it moved or its counter changed (`locate`: exact identity, then resource id and role, then role and label, never a guess between two).

Android observations also carry what the system says about navigation, read in the same `adb shell` round trip: the resumed activity (null during a cold start, so it is never mistaken for another screen), the app's activity stack and the focused window. Field identities no longer include what was typed.

`navloom_merge {into, from}` folds screens (or states) recorded twice into one, rewriting states, transitions (joined when they became the same), flows, entries, deeplinks, remembered help, goto results and plugin fields, and keeping the old id as an alias. Merges are logged in `graph.merges`; a mission's merges wait in its draft and are applied to the recorded map on approval. `navloom_memory` lists `possibleDuplicates`; `navloom_similar` returns the pairs. Maps recorded before profiles existed get them at the next mission start from their own evidence (or the controls saved on the states).

`navloom_merge {into, from, as: "state"}` turns a screen into a state of another screen: a dialog, a step or a variant that was recorded apart. The states of `from` move to `into` with their ids, evidence and transitions, take the name of the screen they were, and are marked `distinct` so no merge joins them to another state (a plain merge joins the states the two screens had in common). The screen disappears and its id becomes an alias. It is logged in `graph.merges` with `as: "state"` and waits for approval like any merge (reviewed as "Tela virou estado").

### Screen links

`resolveLinks` (`agent/operations.mjs`) runs once for every operation, before its `call`: an argument that is a `navloom://screen/...` link (alone, however the chat wrapped it) becomes the id. Under `state`/`stateId`, or `id`/`into`/`from` beside `kind: "state"`, it gives the state; elsewhere the screen. A link to a state passed as `screen` also fills the operation's own state argument when it has one (`navloom_goto` goes to that state). A link inside a sentence, or in what an action types or opens (`value`, `url`), stays text. A link to a state passed to `navloom_screen` shows that state (also `state`: an id or the state's name). Ids folded by a merge are followed through `graph.aliases`/`graph.stateAliases`, by the same trail whether they arrive in a link or bare, full or short (`resolveScreen`/`resolveState`, `agent/graph.mjs`); a link to a screen that no longer exists fails with a message that says so. `navloom_screen {screen: link}` is how the agent looks before changing anything: besides the context lines it lists the states with their ids and the screens it looks like, with the merge call for each case.

`navloom_harness {suggest: "screen"}` writes the `screen` script from the map (`agent/learn.mjs`): for each screen its title, selected tab, ids and short texts present in nearly every capture of it and in no capture of another screen, checked against those captures before it is offered; a rule that claims another screen's capture asks for all its anchors, then is left out. The agent proposes it with `navloom_harness_propose` and a person approves it as any other script.

Routes only use dependable transitions: when the same action from the same state has led to different places only the best-evidenced outcome is used; `back` is only used to undo the step right before it; a deeplink stops being a shortcut once it has been seen landing in more than one place (for example when it needs a signed-in session).

### Nothing a mission found is lost

Pending drafts never expire. Approval merges field by field. Approving or discarding moves the draft to `.navloom/drafts/archive/` (latest 60 missions) instead of deleting it, and `review_decide {decision: restore}` (interface only) brings a discarded mission, a walk or one that lost its comparison back to pending. A walk that reached something the map never had (a `goto` continued by hand after `stuck`) waits for a decision (`review.kept: walk_found_new`) instead of being dropped. A missing base copy is rebuilt from the recorded map (`review.baseMissing`), and a resumed mission keeps its own draft even if the review setting changed.

### API call attribution

Each call carries the time it happened: the proxy's own time, or the logcat line's device time moved to this machine's clock (`syncClock`, three `date +%s%3N` samples, shortest round trip). A response-only line is moved back by its duration. A call belongs to the last step whose action came before it (150 ms skew), wherever its line was read, so slow responses no longer land on the next screen; calls before any action belong to startup. `apiDoubts` (in `navloom_memory`) lists endpoints usually seen in one place and sometimes in another. `navloom_organize {apis:[{endpoint, screen, role: load|action, via?}]}` (or `navloom_apis`) sets a rule that applies to new calls and re-places every recorded call from the runs' evidence (`agent/apis.mjs`).

### Graph algorithms

- Exploration picks the nearest frontier: one shortest-path search to every state with pending candidates (`planRoute` with a goal set), not the first candidate in screen order.
- Duplicate detection weighs content 75% and neighbourhood 25%: the labelled ways out of and into each screen (`neighbourhood` in `agent/recognize.mjs`).
- Entry points carry screen-level dominators (Cooper–Harvey–Kennedy): `mustPass` for each screen, leaving out what every walk passes, and the dominator tree as the map README's **Árvore de fluxo**.
- Tabs work from every screen that shows them: a tab-bar control named like the section its destination shows selected becomes a way from every state whose tab bar has it (`tabEdges` in `agent/navigate.mjs`), for `goto` and entry points alike.

### Keyboard and scrolled views

A screen with the keyboard up, and a screen scrolled away from its top, are states of their own (`… · teclado`, `… · rolado`), so the clean capture of the base state is never replaced by one that is half covered or half way down a list. The elements and the screenshot are two round trips to the device: when the keyboard opened or closed between them (`keyboardShown` is asked again after the screenshot), both are taken again, so a picture with the keyboard never lands on the clean state. A capture is never recorded on a state with another keyboard, whatever chose that state (a scroll, the app's own state key, a merge): it becomes the sibling state of the same screen. On Android the keyboard is read from `dumpsys input_method`. After a scroll the harness compares what is on view: nothing moved keeps the same state, being back at the top returns to the base state, anything else is a scrolled state reached by a `scroll` transition that carries the calls the scroll triggered (pagination, lazy loading). The map draws that transition as a scroll arrow with the call, when there is one, and the scrolled state at its tip.

### Harness: learned scripts

Navloom is a harness around the agent: besides driving the app and keeping evidence, it keeps small JavaScript scripts the agent learned for this project, so recognition that was once a judgement becomes deterministic.

| Kind | Input | Output | Used for |
|---|---|---|---|
| `logcat` | `{line}` | `null` or `{url, method?, status?, ms?}` | API requests in the app's own log format |
| `screen` | `{platform, route, heading, texts[], ids[], section}` | `null` or `{screen, state?, name?}` | Stable screen identity when the app declares none; `navloom_harness {suggest: "screen"}` writes it from the map |
| `path` | `{method, host, path}` | `null` or a path template | Grouping calls whose path has variable parts |

A script is `function run(input)` returning JSON, with samples `[{input, expect}]`. The agent reads the contract with `navloom_harness`, looks at real log lines with `navloom_logs`, and registers a script with `navloom_harness_propose`. Scripts are stored in the project under `.navloom/harness/` (`index.json` plus one readable `<id>.js` each).

Nothing an agent writes runs before a person approves it in the **Harness** screen. Approval runs the samples; the script only activates if all match, and one that keeps throwing is switched off. Approved code runs in a separate V8 context that exchanges JSON text only (no `require`, no host objects, no `eval`, 25 ms per call). That contains honest scripts; it is not a security boundary against hostile code, so read the code before approving.

The Harness screen also explains the working loop with live numbers, describes the project and each flow in sentences derived from the confirmed transitions, and shows a feed of what each script recognised.

### Help requests

Learned scripts make recognition deterministic; help requests cover what only a person can supply. When the agent cannot proceed (a credential, a value, a decision, a precondition) it calls `navloom_ask`. The question is shown in the agent's own chat through MCP elicitation when the client supports it, otherwise the agent relays the person's reply with `navloom_answer`, or the person answers in the **Ajuda** panel. Answers are remembered in the graph (`harness`, mirrored into the map) and offered on later observations as `needs`/`remembered`; secret values live only in the ignored `.navloom/secrets.json` and are referenced by `secretRef`. The code is in `agent/help.mjs`; `agent/harness.mjs` holds the learned scripts.

### API calls and deeplinks (Android)

Each step records the backend calls it triggered as `method host path status duration`; volatile path segments become `{id}`. Calls are kept on the step, merged into the transition (`apis`) and shown on the map.

Calls seen through the recording proxy also keep the full exchange (URL with query, headers, request and response bodies up to 256 KB) in their own evidence file, `evidence/net-<id>.json`; the step only points at it and nothing of it enters the graph. Before it is written, values of sensitive keys and headers (password, senha, token, secret, authorization, cookie, api key, card number…) and the profile secrets are replaced by `[REDACTED]`. Set `network.bodies: false` on the target to keep only the summary line. The Preview opens this record when a request is clicked. Two sources, both without root or certificates:

- `targets.<id>.network.reverse: [{devicePort, upstream}]` — for backends the device reaches through `adb reverse`. While a mission runs, the service puts a loopback recording proxy on that device port and forwards to `upstream`; the mapping is handed back when the mission pauses or finishes. If the service is killed abruptly, run `adb reverse tcp:<devicePort> tcp:<upstreamPort>` again.
- Log lines of the application process in OkHttp `HttpLoggingInterceptor` format (`--> POST https://…`, `<-- 200 https://… (35ms)`). Disable with `network.logcat: false`.

Web targets record `fetch`/XHR calls from the browser.

Deeplink patterns declared by the app are read from the package resolver table at mission start (`declaredDeeplinks` in memory). A deeplink step is permitted when `deeplink` is an allowed action and the URL matches a configured prefix or a pattern declared by the target package. A deeplink that was opened and observed is stored on the screen it landed on.

Read `navloom_memory` (`navloom_capabilities`, extended tier, checks a target without starting; `navloom_start` reports the same when blocked). Configure a target, profile, allowed actions/origins, resets and mission limits. `navloom_start` opens the target and saves the entry observation. `navloom_observe` and `navloom_step` return stable evidence references, interactive candidates and state IDs. `navloom_evidence` returns screenshots as MCP image content or observation JSON.

A focused run calls `navloom_route` (extended tier, like `navloom_replay`) with `scenarioRunId` and optional inclusive `startStep`/`endStep`, then `navloom_replay`, using the current version/profile/preconditions. This preserves the exact test segment: different flows can share a receipt or confirmation screen. Destination-only route planning is for navigation/preparation, not proof that a particular business flow ran. Replay stops at divergence; use `navloom_observe` and local recovery rather than re-exploring the whole app. Transitions with coordinate-only actions are not automatically replayed. Deeplinks in a replay are allowed only with `purpose: preparation`.

Screens use explicit web `data-navloom-screen` / `data-navloom-state` when present. Android Compose can expose `contentDescription = "navloom:screen:<id>:state:<state>"` and `testTagsAsResourceId = true`. Otherwise identity uses route/activity, hierarchy and semantic elements and is marked structural. It is not a guarantee that two similar-looking screens are semantically identical. Screen descriptions/source links are versioned interpretations, not immutable evidence.

Every completed step also returns `outcome` (`navigation`, `state`, `scroll`, `none`), a structural diff (text, elements, markers), the pixel change region between the two captures, the API calls observed between the action and the capture, and a deterministic summary. These are stored on the transition; `navloom_describe` adds the agent's own understanding of a transition, state or flow as a separately versioned description.

Exploration remains agent-directed: `navloom_frontier` exposes discovered candidates and completion status. `navloom_probe` clicks one candidate, classifies the effect and returns with `back` when a new screen opened; `navloom_explore` repeats this in a stable order within `maxCandidates`, reaching other states only through confirmed routes and stopping at the budget, when the frontier is exhausted or when no pending candidate is reachable. It never fills forms, skips sensitive fields and labels matching `exploration.avoid`, records automatic changes (loading finished, redirects) as `wait` transitions, and does not go back from screens already visited before the origin or when the browser has no in-app history. The service does not autonomously decide to submit forms or invent field values. Application text and source comments must be treated as untrusted evidence.

`navloom_finish` captures final evidence and evaluates declared state/text/no-errors assertions. A run without assertions is `not_verified`, never passed merely because navigation completed. Logs are execution-scoped. Android requires the configured device and package; unavailable hierarchy/log capabilities are reported. Unicode input is not supported by basic ADB input and requires a separately configured input plugin.

## API calls and deeplinks

Web executors record the page's `fetch`/XHR calls. Android executors record through a loopback proxy placed in front of backends reached with `adb reverse` (`network.reverse`), and read the application process logcat in one round trip per poll, using the device's own clock as cursor: OkHttp logging lines (`--> GET url`, `<-- 200 url`), formats taught by learned `logcat` scripts, then plain lines such as `GET /api/x -> 200` or `HTTP 404 /path`. Apps that log nothing and use no reverse port report no calls, and `capabilities` lists `network` as conditional. Calls are kept on the step (`network`) and merged into the transition's `apis` (method, host, path template, statuses, count); when the call went through the proxy or the browser, the full exchange with sensitive values masked is written to `evidence/net-<id>.json` (`network.bodies: false` turns that off). Late responses are attributed to the action that started them; calls made by a recovery (relaunch after `back` left the app) stay on the failed step. `endpoints` in `navloom_status`/`navloom_memory` index every endpoint by transition and origin screen.

`navloom_deeplinks` returns the links declared by the installed Android package (intent filters with VIEW, parsed from `dumpsys package`), links observed on web screens, the permitted prefixes and the deeplinks verified by observed `deeplink` steps with their landing screen and state.

## Versionable map

With `map.enabled` (default), the graph is mirrored after every step, description, flow and finish into `<project>/<map.dir>/` (default `navloom-map/`): `map.yaml` (screens, states with hotspots, transitions with action, summary, description, API calls (`network`), diff and change region, deeplinks, endpoints, flows), `README.md` for humans, and `states/<stateId>.jpg` thumbnails (`map.screenshots`, `map.thumbnailWidth`). Runs, full captures and tokens stay in the ignored `.navloom/`. When `.navloom/graph.json` is missing, the service loads the map, so a fresh checkout renders known screens, routes and endpoints; thumbnails are served as `map/states/<id>.jpg`. Review thumbnails before committing: they show real application data.

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
