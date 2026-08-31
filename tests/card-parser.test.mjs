import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousDescription, parseAction, parseActions, parseCard, parseTriggers, triggerDescription } from '../dist/game/card-parser.js';
import { parseObservableCondition, parsePackedRuleAction, parseRule, parseRuleCondition, parseRuleEffect, parseRuleEntity, parseRuleState } from '../dist/game/rule-parser.js';

test('card parser derives names, troop role, regions, and implicit movement', () => {
  const card = parseCard({ id: 'test-card', baseHealth: 2, deploymentRegions: 'starting intermediate', actions: '2 fire 3' });
  assert.equal(card.name, 'Test Card');
  assert.equal(card.role, 'troop');
  assert.deepEqual(card.deploymentRegions, ['starting', 'intermediate']);
  assert.deepEqual(card.actions, [{ kind: 'move', range: 1 }, { kind: 'fire', amount: 2, range: 3 }]);
});

test('Fly suppresses implicit Move and qualified attacks compile in order', () => {
  assert.deepEqual(parseActions('fly 2, 1 P.F.T.bow 3'), [
    { kind: 'fly', range: 2 },
    { kind: 'ranged', amount: 1, range: 3, type: ['pierce', 'instant', 'tireless'] }
  ]);
});

test('plus remains part of a magenta upgrade while ampersand separates trigger effects', () => {
  assert.deepEqual(parseAction('+1 bow +1'), { kind: 'upgrade', amount: [1, 1], range: 0, type: ['permanent', 'attack'] });
  assert.deepEqual(parseAction('+1 life'), { kind: 'life', amount: 1, range: 0 });
  assert.deepEqual(parseAction('-1 maxlife'), { kind: 'maxlife', amount: -1, range: 0 });
  const triggers = parseTriggers('bash : +1 bow +1 & 1 mod 0', 'test-card');
  assert.equal(triggers.length, 2);
  assert.deepEqual(triggers.map(trigger => trigger.condition), [
    { signal: 'bashAttack', subject: 'self' },
    { signal: 'bashAttack', subject: 'self' }
  ]);
});

test('enemy deployment regions and all-adjacent friend effects compile explicitly', () => {
  const card = parseCard({ id: 'test-temple', role: 'temple', baseHealth: 3, deploymentRegions: 'intermediate enemy', triggers: 'end : 1 shield 1 all-adj-friend' });
  assert.equal(card.deploymentRule, 'enemy-region');
  assert.deepEqual(card.triggers[0].action, { kind: 'defense', amount: 1, range: 1, type: ['adjacent'] });
});

test('trigger and continuous summaries are generated from parser text', () => {
  assert.equal(triggerDescription('is-bash-by : 0 mod 1'), 'is ⚔️: ~+1~');
  assert.equal(triggerDescription('dies : 3 F.bow 3 & 3 F.bow 3'), '💀: 3F🏹3 & 3F🏹3');
  assert.equal(triggerDescription('end : 1 T.bow 2'), 'End: 1T🏹2');
  assert.equal(continuousDescription('deployed :: +1 fire +0 all-friend'), '+1🔥+0 [[friend:all]]');
  assert.equal(continuousDescription('adjacent-enemy :: +2'), '[[enemy:adj]]: +2');
  assert.equal(triggerDescription('bash any-enemy : 1 mod 0'), '⚔️ [[enemy:any]]: +1');
  assert.equal(triggerDescription('deploy any-hex-enemy : 1 mod 0'), 'Deploy [[enemy-dark:⬢]]: +1');
});

test('normalized rule entities classify hex filters and default to any', () => {
  assert.deepEqual(parseRuleEntity('friend'), {
    kind: 'descriptor', selector: 'any',
    units: [{ attribute: 'friend', negated: false }], regions: [], types: []
  });
  assert.deepEqual(parseRuleEntity('none-enemy&!wounded-int&empty&eside-hero'), {
    kind: 'descriptor', selector: 'none',
    units: [{ attribute: 'enemy', negated: false }, { attribute: 'wounded', negated: true }],
    regions: [
      { attribute: 'int', negated: false },
      { attribute: 'empty', negated: false },
      { attribute: 'eside', negated: false }
    ],
    types: [{ attribute: 'hero', negated: false }]
  });
  assert.deepEqual(parseRuleEntity('friend&firststrike-troop').units[1], { attribute: 'first-strike', negated: false });
  assert.deepEqual(parseRuleEntity('empty').regions, [{ attribute: 'empty', negated: false }]);
  assert.deepEqual(parseRuleEntity('any-bomboff').types, [{ attribute: 'bomboff', negated: false }]);
  assert.deepEqual(parseRuleEntity('any-bombon').types, [{ attribute: 'bombon', negated: false }]);
  assert.deepEqual(parseRuleEntity('awayfrom-subj'), {
    kind: 'descriptor', selector: 'any',
    position: { relation: 'awayfrom', reference: 'subj' },
    units: [], regions: [], types: []
  });
  assert.deepEqual(parseRuleEntity('any-towards-self-enemy'), {
    kind: 'descriptor', selector: 'any',
    position: { relation: 'towards', reference: 'self' },
    units: [{ attribute: 'enemy', negated: false }], regions: [], types: []
  });
  assert.deepEqual(parseRuleEntity('parallel-obj-empty'), {
    kind: 'descriptor', selector: 'any',
    position: { relation: 'parallel', reference: 'obj' },
    units: [], regions: [{ attribute: 'empty', negated: false }], types: []
  });
  assert.deepEqual(parseRuleEntity('subj'), { kind: 'reference', reference: 'subj' });
  assert.throws(() => parseRuleEntity('unit'), /unknown attribute/);
  assert.throws(() => parseRuleEntity('bomb'), /unknown attribute/);
  assert.throws(() => parseRuleEntity('awayfrom'), /needs self, subj, or obj/);
  assert.throws(() => parseRuleEntity('towards-ally'), /needs self, subj, or obj/);
});

test('normalized rules distinguish anchors, guards, events, and stored state', () => {
  const rule = parseRule('end if self wounded : self mend(1,_) self & self titanium until opponent-end');
  assert.equal(rule.kind, 'trigger');
  assert.deepEqual(rule.anchor, { kind: 'phase', phase: 'end' });
  assert.equal(rule.guard.kind, 'state');
  assert.equal(rule.guard.property.name, 'wounded');
  assert.equal(rule.consequences[0].kind, 'event');
  assert.deepEqual(rule.consequences[0].event.action.parameters, [1, undefined]);
  assert.equal(rule.consequences[1].kind, 'stored-state');
  assert.equal(rule.consequences[1].state.property.name, 'titanium');
  assert.deepEqual(rule.consequences[1].lifetime, { kind: 'until', event: { kind: 'phase', phase: 'opponent-end' } });
});

test('normalized continuous rules derive contributable state from observable snapshot or history', () => {
  const snapshot = parseRule('self mod(1,0) while self wounded');
  assert.equal(snapshot.kind, 'continuous');
  assert.deepEqual(snapshot.contribution.property, { name: 'mod', parameters: [1, 0] });
  assert.equal(snapshot.condition.property.name, 'wounded');

  const historical = parseRule('self titanium while none bash any during-this-turn');
  assert.equal(historical.kind, 'continuous');
  assert.equal(historical.condition.kind, 'history');
  assert.equal(historical.condition.event.subject.selector, 'none');
  assert.equal(historical.condition.interval, 'during-this-turn');
});

test('normalized rules parse function and legacy packed action notation', () => {
  const rule = parseRule('fireXX any-bomboff : P.F.light(_) any-bomboff & defuse1 any-bombon');
  assert.equal(rule.kind, 'trigger');
  assert.deepEqual(rule.anchor.action.parameters, [undefined, undefined]);
  assert.deepEqual(rule.consequences[0].event.action, { name: 'light', parameters: [undefined], qualifiers: ['pierce', 'fast'] });
  assert.deepEqual(parseRuleEffect('mod10'), {
    kind: 'relation', subject: { kind: 'reference', reference: 'self' },
    action: { name: 'mod', parameters: [1, 0], qualifiers: [] },
    object: { kind: 'reference', reference: 'self' }
  });
  assert.deepEqual(parsePackedRuleAction('mod10'), { name: 'mod', parameters: [1, 0], qualifiers: [] });
  assert.deepEqual(parseRuleEffect('mod10 adj').object, {
    kind: 'descriptor', selector: 'any', units: [],
    regions: [{ attribute: 'adj', negated: false }], types: []
  });
  assert.equal(parseRuleCondition('firesXX any-bomboff').action.name, 'fire');
  assert.deepEqual(parseRuleState('self up.bow(1,0)').property, { name: 'up', parameters: [1, 0], action: 'bow' });
  assert.equal(parseObservableCondition('none bash any since-beginning').kind, 'history');
});

test('normalized rule parser rejects malformed group ordering and binary verbs without objects', () => {
  assert.throws(() => parseRuleEntity('hero-friend'), /unit-region-type/);
  assert.throws(() => parseRuleEntity('enemy&front'), /mixes attribute groups/);
  assert.throws(() => parseRule('self hit : mod10 self'), /needs an object/);
  assert.throws(() => parseRule('self die any : mod10 self'), /cannot have an object/);
  assert.throws(() => parseRule('self teleports any : mod10 self'), /unknown verb/);
  assert.throws(() => parseRule('self lightXX any-bomboff : mod10'), /only its range parameter/);
  assert.throws(() => parseRule('self mend(1,_) self while self wounded'), /unknown property/);
  assert.throws(() => parseRule('self wounded while self titanium'), /not contributable/);
  assert.throws(() => parseRule('any fire self : self titanium'), /needs permanent/);
  assert.throws(() => parseRule('any fire self : self mod(1,0)'), /needs permanent/);
  assert.throws(() => parseRule('none bash any : self titanium permanent'), /historical, not an anchor/);
  assert.throws(() => parseObservableCondition('self mod(1,0)'), /not observable/);
});
