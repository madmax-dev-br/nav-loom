import test from 'node:test';
import assert from 'node:assert/strict';
import {Help} from '../../agent/help.mjs';
import {normalizeCall} from '../../agent/network.mjs';
import {Runtime} from '../../agent/runtime.mjs';

// Found live on the Rota Viva app: the profile already had its password secret, yet the agent was told to ask a person.
test('a sensitive field offers the secret the profile already provides', () => {
  const help = new Help(null), graph = {harness: []};
  const observation = {screenId: 's1', elements: [{id: 'e1', identity: 'f:senha', name: 'Senha', sensitive: true}]};
  assert.equal(help.help(graph, observation).needs[0].secretRef, null);
  assert.equal(help.help(graph, observation, ['password']).needs[0].secretRef, 'password');
  assert.equal(help.help(graph, observation, ['login', 'senha_app']).needs[0].secretRef, 'senha_app');
  // A remembered answer for this very field still wins.
  graph.harness.push({id: 'h1', kind: 'credential', screenId: 's1', elementIdentity: 'f:senha', answer: {type: 'secretRef', secretRef: 'help_x'}});
  assert.equal(help.help(graph, observation, ['password']).needs[0].secretRef, 'help_x');
});

test('a relative request url drops its query like an absolute one', () => {
  assert.equal(normalizeCall({url: '/v2/flights?from=GRU&to=SSA'}).path, '/v2/flights?…');
  assert.equal(normalizeCall({url: 'https://x.test/v2/flights?from=GRU'}).path, '/v2/flights?…');
  assert.equal(normalizeCall({url: '/v2/hotels'}).path, '/v2/hotels');
});

test('no call recognised but request-like app log lines: the agent is told once to teach the format', async () => {
  const saved = [];
  const fake = {store: {saveRun: async run => saved.push(run)}, executor: {logLines: async () => [
    'D/RotaViva(1): [rv-net] id=1 begin',
    'I/RotaViva(1): [rv-net] id=1 verb=POST route=/v2/auth/login status=200 took=266ms',
    'I/Choreographer(1): Skipped 3 frames!',
  ]}};
  const hint = Runtime.prototype.networkHint;
  const run = {steps: [{}, {}, {}, {}]};
  const first = await hint.call(fake, run);
  assert.equal(first.requestLikeLines, 1);
  assert.match(first.samples[0], /route=\/v2\/auth\/login/);
  assert.match(first.next, /navloom_harness_propose/);
  assert.equal(await hint.call(fake, run), null, 'only once per mission');
  assert.equal(saved.length, 1);
  // Calls already recognised, or too early in the mission: nothing to say.
  assert.equal(await hint.call(fake, {steps: [{network: [{}]}, {}, {}, {}]}), null);
  assert.equal(await hint.call(fake, {steps: [{}]}), null);
});

// Found live: probes and failed attempts clicked "Entrar" with empty fields more often than a real sign-in, so the rejected outcome had more
// evidence, the sign-in edge was dropped and every goto past the login got stuck on the first screen.
test('a submit that left the screen beats the same submit that stayed on it, whatever the evidence count', async () => {
  const {dependableEdges} = await import('../../agent/graph.mjs');
  const base = {confirmed: true, target: 'a', profile: 'default', preconditions: {}, action: {type: 'click', elementIdentity: 'entrar'}, from: 'login'};
  const graph = {states: [{id: 'login', screenId: 'Login'}, {id: 'login-err', screenId: 'Login'}, {id: 'home', screenId: 'Home'}], transitions: [
    {...base, id: 'stay', to: 'login-err', cost: 1, evidence: [{}, {}, {}, {}, {}]},
    {...base, id: 'go', to: 'home', cost: 1, evidence: [{}]},
  ]};
  const {edges} = dependableEdges(graph, {target: 'a', profile: 'default', allowUnverifiedVersion: true});
  assert.deepEqual(edges.map(e => e.id), ['go']);
  // A toggle that only ever stays on its screen is still a usable edge.
  graph.transitions = [graph.transitions[0]];
  assert.deepEqual(dependableEdges(graph, {target: 'a', profile: 'default', allowUnverifiedVersion: true}).edges.map(e => e.id), ['stay']);
});
