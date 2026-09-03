import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAction, parseActions, parseCard } from '../dist/game/card-parser.js';
import { parseObservableCondition, parsePackedRuleAction, parseRule, parseRuleCondition, parseRuleEntity, parseRuleState } from '../dist/game/rule-parser.js';

test('card parser derives names, troop role, regions, and function-form actions', () => {
  const card = parseCard({ id: 'test-card', baseHealth: 2, deploymentRegions: 'starting intermediate', actions: 'fire(2,3)' });
  assert.equal(card.name, 'Test Card');
  assert.equal(card.role, 'troop');
  assert.deepEqual(card.deploymentRegions, ['starting', 'intermediate']);
  assert.deepEqual(card.actions, [{ kind: 'move', range: 1 }, { kind: 'fire', amount: 2, range: 3 }]);
});

test('Fly suppresses implicit Move and qualified attacks compile in order', () => {
  assert.deepEqual(parseActions('fly(2), P.F.T.bow(1,3)'), [
    { kind: 'fly', range: 2 },
    { kind: 'ranged', amount: 1, range: 3, type: ['pierce', 'instant', 'tireless'] }
  ]);
});

test('plus remains part of a magenta upgrade in the action dictionary', () => {
  assert.deepEqual(parseAction('+1 bow +1'), { kind: 'upgrade', amount: [1, 1], range: 0, type: ['permanent', 'attack'] });
  assert.deepEqual(parseAction('+1 life'), { kind: 'life', amount: 1, range: 0 });
  assert.deepEqual(parseAction('-1 maxlife'), { kind: 'maxlife', amount: -1, range: 0 });
});

test('enemy deployment regions and normalized rules compile explicitly', () => {
  const card = parseCard({ id: 'test-temple', role: 'temple', baseHealth: 3, deploymentRegions: 'intermediate enemy', rules: ['end : o:you adj self have up-mod(1,0) removed-after _ hit self'] });
  assert.equal(card.deploymentRule, 'enemy-region');
  assert.equal(card.rules[0].kind, 'trigger');
  assert.equal(card.rules[0].consequences[0].kind, 'distributed-state');
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
  const snapshot = parseRule('self up-mod(1,0) while self wounded');
  assert.equal(snapshot.kind, 'continuous');
  assert.deepEqual(snapshot.contribution.property, { name: 'up-mod', parameters: [1, 0] });
  assert.equal(snapshot.condition.property.name, 'wounded');

  const historical = parseRule('self titanium while none bash any during-this-turn');
  assert.equal(historical.kind, 'continuous');
  assert.equal(historical.condition.kind, 'history');
  assert.equal(historical.condition.event.subject.selector, 'none');
  assert.equal(historical.condition.interval, 'during-this-turn');
});

test('normalized have rules distribute over selectors and rebind self', () => {
  const rule = parseRule('o:you bashing o:opp have self up-mod(1,0)');
  assert.equal(rule.kind, 'have');
  assert.equal(rule.selector.kind, 'state');
  assert.equal(rule.selector.property.name, 'bashing');
  assert.deepEqual(rule.attachment.property, { name: 'up-mod', parameters: [1, 0] });
  const implicitRecipient = parseRule('o:you have up-move(1)');
  assert.equal(implicitRecipient.attachment.subject.reference, 'self');

  const nested = parseRule('self deployed have o:you adj self have self up-bow(1,0)');
  assert.equal(nested.kind, 'have');
  assert.equal(nested.attachment.kind, 'have');
  assert.equal(nested.attachment.selector.kind, 'directed');
  assert.equal(nested.attachment.selector.filter.owner, 'you');
  assert.throws(() => parseRule('o:you have subj up-mod(1,0)'), /subj and obj are forbidden/);
  assert.throws(() => parseRule('_ have self up-mod(1,0)'), /not a standalone or have selector/);
});

test('normalized rules parse function and legacy packed action notation', () => {
  const rule = parseRule('fireXX p:bomb-off : P.F.light(_) p:bomb-off & defuse1 p:bomb-on');
  assert.equal(rule.kind, 'trigger');
  assert.deepEqual(rule.anchor.action.parameters, [undefined, undefined]);
  assert.deepEqual(rule.consequences[0].event.action, { name: 'light', parameters: [undefined], qualifiers: ['pierce', 'fast'] });
  assert.deepEqual(parsePackedRuleAction('mod10'), { name: 'mod', parameters: [1, 0], qualifiers: [] });
  assert.equal(parseRuleCondition('firesXX p:bomb-off').action.name, 'fire');
  assert.deepEqual(parseRuleState('self up-bow(1,0,F)').property, { name: 'up-bow', parameters: [1, 0, 'fast'], action: 'bow' });
  assert.deepEqual(parseRuleState('self up-life(1,2)').property, { name: 'up-life', parameters: [1, 2] });
  assert.deepEqual(parseRuleState('self fast').property, { name: 'fast', parameters: [] });
  assert.deepEqual(parseRuleState('any-bomboff bomb-off').property, { name: 'bomb-off', parameters: [] });
  assert.deepEqual(parseRuleState('any-bombon bomb-on').property, { name: 'bomb-on', parameters: [] });
  assert.equal(parseRuleCondition('self defuse1 p:bomb-on').action.name, 'bomb-defuse');
  for (const pending of ['is-shielding', 'is-mshielding', 'is-moving', 'is-flying', 'is-gore-moving', 'is-pushing', 'is-pulling', 'is-mending', 'is-stunning', 'is-bomb-throwing', 'is-upgrading', 'is-bomb-defusing', 'is-lighting']) {
    assert.equal(parseRuleState(`self ${pending} any`).property.name, pending);
  }
  assert.equal(parseObservableCondition('none bash any since-beginning').kind, 'history');
});

test('normalized events expose explicit resolved stages and validate action shapes', () => {
  const resolved = parseRuleCondition('self bow-resolved(1,_) o:opp');
  assert.equal(resolved.kind, 'relation');
  assert.equal(resolved.action.name, 'bow');
  assert.equal(resolved.stage, 'resolved');
  assert.deepEqual(resolved.action.parameters, [1, undefined]);
  assert.doesNotThrow(() => parseRuleCondition('self bow o:opp'));
  assert.throws(() => parseRuleCondition('self bow(1) o:opp'), /exactly 2 parameters/);
  assert.throws(() => parseRuleCondition('self bow any o:opp'), /cannot start with Boolean/);
  assert.throws(() => parseRuleCondition('P.move(1) self'), /cannot acquire Pierce/);
  assert.throws(() => parseRuleCondition('T.bash self'), /cannot acquire Tireless/);
});

test('normalized observable conditions support grouping, negation, and precedence', () => {
  const condition = parseObservableCondition('self wounded | (self active & !self shielded)');
  assert.equal(condition.kind, 'boolean');
  assert.equal(condition.operator, 'or');
  assert.equal(condition.conditions[1].operator, 'and');
  assert.equal(condition.conditions[1].conditions[1].operator, 'not');
  assert.throws(() => parseObservableCondition('(self wounded'), /unmatched opening/);
  assert.throws(() => parseObservableCondition('self wounded & '), /needs conditions/);
});

test('normalized field queries and directions preserve ordered, scoped selection', () => {
  const event = parseRuleCondition('o:you r:str c:you s:opp t:hero bow adj self');
  assert.deepEqual(event.subject, {
    kind: 'query', selector: 'any', owner: 'you', region: 'str', control: 'you', side: 'opp', entityType: 'hero'
  });
  assert.deepEqual(event.object, {
    kind: 'directed', direction: 'range-from', distance: 1,
    reference: { kind: 'reference', reference: 'self' }
  });
  assert.deepEqual(parseRuleState('all o:both p:bomb r:int bomb-on').subject, {
    kind: 'query', selector: 'all', owner: 'both', bomb: 'bomb', region: 'int'
  });
  assert.deepEqual(parseRuleCondition('self bow !o:you 3-from self').object.filter, {
    kind: 'query', selector: 'any', excludedOwner: 'you'
  });
  assert.throws(() => parseRuleCondition('self bomb-defuse range2-from p:bomb-on'), /singular self, subj, or obj/);
  assert.deepEqual(parseRuleCondition('self move 2-away-from self').object, {
    kind: 'directed', direction: 'away-from', distance: 2,
    reference: { kind: 'reference', reference: 'self' }
  });
  assert.equal(parseRuleCondition('self move 1-parallel-to self').object.direction, 'parallel-to');
  assert.deepEqual(parseRuleCondition('self move 1-from self').object, parseRuleCondition('self move adj self').object);
  assert.throws(() => parseRuleCondition('self bow none o:opp'), /none is valid only/);
  assert.throws(() => parseRuleCondition('self bow towards o:opp'), /singular self, subj, or obj/);
  assert.deepEqual(parseRuleCondition('self bow o:opp adj self').object, {
    kind: 'directed', direction: 'range-from', distance: 1,
    reference: { kind: 'reference', reference: 'self' },
    filter: { kind: 'query', selector: 'any', owner: 'opp' }
  });
  assert.deepEqual(parseRuleCondition('t:hero o:you bow self').subject, {
    kind: 'query', selector: 'any', owner: 'you', entityType: 'hero'
  });
  assert.throws(() => parseRuleCondition('o:you o:opp bow self'), /duplicate o:/);
  assert.throws(() => parseRule('all o:opp bow self : self fast permanent'), /cannot start with Boolean/);
  assert.throws(() => parseObservableCondition('all o:you bow any during-this-turn'), /invalid in a historical/);
});

test('event wildcards and consequence target policies are distinct from Boolean any', () => {
  const wildcard = parseRuleCondition('self bash _');
  assert.deepEqual(wildcard.object, { kind: 'wildcard' });
  const choose = parseRule('self fire _ : self fire(2,_) _');
  assert.equal(choose.consequences[0].event.targetPolicy, undefined);
  assert.deepEqual(choose.consequences[0].event.object, { kind: 'wildcard' });
  const fanout = parseRule('self fire _ : self fire(2,_) all o:opp');
  assert.equal(fanout.consequences[0].event.targetPolicy, 'all');
  assert.throws(() => parseRuleCondition('self fire all o:opp'), /target policy/);
});

test('trigger consequences default subjects, targets, lifetime, and modality', () => {
  const shorthand = parseRule('end : bow(2,3)');
  assert.equal(shorthand.consequences[0].event.object, undefined);
  assert.deepEqual(shorthand.consequences[0].event.action.parameters, [2, 3]);

  const explicit = parseRule('end : bow(2) !o:you 3-from self');
  assert.equal(explicit.consequences[0].event.subject.reference, 'self');
  assert.equal(explicit.consequences[0].event.object.direction, 'range-from');
  assert.deepEqual(explicit.consequences[0].event.action.parameters, [2]);

  const permanent = parseRule('end : up-mod(1,0)');
  assert.deepEqual(permanent.consequences[0].lifetime, { kind: 'permanent' });

  const required = parseRule('end : must move(1)');
  assert.equal(required.consequences[0].event.mandatory, true);
  assert.throws(() => parseRule('must move(1) self : up-mod(1,0)'), /must is valid only/);
});

test('normalized rule parser rejects malformed group ordering and binary verbs without objects', () => {
  assert.throws(() => parseRuleEntity('hero-friend'), /unit-region-type/);
  assert.throws(() => parseRuleEntity('enemy&front'), /mixes attribute groups/);
  assert.throws(() => parseRule('self hit : mod10 self'), /needs an object/);
  assert.throws(() => parseRule('self die _ : mod10 self'), /cannot have an object/);
  assert.throws(() => parseRule('self teleports _ : mod10 self'), /unknown verb/);
  assert.throws(() => parseRule('self lightXX p:bomb-off : mod10'), /only its range parameter/);
  assert.throws(() => parseRule('self mend(1,_) self while self wounded'), /unknown property/);
  assert.throws(() => parseRule('self wounded while self titanium'), /not contributable/);
  assert.equal(parseRule('_ fire self : self titanium').consequences[0].lifetime.kind, 'permanent');
  assert.equal(parseRule('_ fire self : self up-mod(1,0)').consequences[0].lifetime.kind, 'permanent');
  assert.throws(() => parseRuleState('self up-fire(1,P)'), /needs 2 numeric parameters/);
  assert.throws(() => parseRuleState('self up-bash(T)'), /does not name a known action/);
  assert.throws(() => parseRuleState('self up-bomb-explode'), /does not name a known action/);
  assert.throws(() => parseRuleState('self up-life(1)'), /exactly two/);
  assert.throws(() => parseRule('none bash _ : self titanium permanent'), /cannot start with Boolean/);
  assert.throws(() => parseObservableCondition('self up-mod(1,0)'), /not observable/);
  assert.throws(() => parseRule('end : up-mod(1,0) removed-after _ hit obj'), /obj is not bound/);
});
