import type {
  ParsedHaveRule, ParsedRule, RuleEntity, RuleFieldQuery, RuleLifetime,
  RuleObservableCondition, RulePhrase, RuleState, RuleTriggeredConsequence
} from '../game/rule-parser.js';

const glyphs: Readonly<Record<string, string>> = {
  move: '🥾', fly: '🪽', bow: '🏹', fire: '🔥', cannon: '🧨',
  shield: '🛡️', mshield: '🛡️', push: '🫸', pull: '🫷', stun: '🚫',
  mend: '❤️', upgrade: '🔮', bash: '⚔️', wound: 'Wound', hit: 'Hit',
  die: '💀', deploy: 'Deploy', revive: '👼', 'gore-move': '🐏', 'gore-attack': '🐏'
};

const labels: Readonly<Record<string, string>> = {
  move: 'move', fly: 'fly', bow: 'use Bow', fire: 'use Fire', cannon: 'fire Cannon',
  shield: 'grant a physical shield', mshield: 'grant a magic shield', push: 'push',
  pull: 'pull', stun: 'stun', mend: 'mend', upgrade: 'upgrade', bash: 'bash',
  wound: 'wound', hit: 'hit', die: 'die', deploy: 'deploy', revive: 'revive',
  'gore-move': 'move with Gore', 'gore-attack': 'deal Gore damage'
};

function signed(value: number): string { return `${value >= 0 ? '+' : ''}${value}`; }

function qualifierPrefix(phrase: RulePhrase): string {
  return phrase.action.qualifiers.map(value => value === 'pierce' ? 'P' : value === 'fast' ? 'F' : 'T').join('');
}

function compactAction(phrase: RulePhrase): string {
  const values = phrase.action.parameters;
  const glyph = glyphs[phrase.action.name] ?? phrase.action.name;
  const prefix = qualifierPrefix(phrase);
  const rendered = !values.length ? `${prefix}${glyph}`
    : values.length === 1 ? phrase.action.name === 'move' || phrase.action.name === 'fly'
    ? `${prefix}${glyph}${values[0] ?? '_'}`
    : `${values[0] ?? '_'}${prefix}${glyph}`
    : `${values[0] ?? '_'}${prefix}${glyph}${values[1] ?? '_'}`;
  return phrase.action.name === 'mshield' ? `~${rendered}~` : rendered;
}

function relationMarker(query: RuleFieldQuery, content: string): string {
  const relation = query.owner === 'you' ? 'friend' : query.owner === 'opp' ? 'enemy' : undefined;
  return relation ? `[[${relation}:${content}]]` : content;
}

function compactQuery(query: RuleFieldQuery, distributive = false): string {
  if (query.side === 'opp' && !query.owner && !query.entityType) return '[[enemy-dark:⬢]]';
  if (query.side === 'you' && !query.owner && !query.entityType) return '[[friend-dark:⬢]]';
  const content = query.entityType === 'hero' ? 'hero'
    : query.entityType === 'temple' ? 'temple'
    : distributive ? 'all' : 'any';
  if (query.excludedOwner === 'you') return `not ally ${content}`;
  if (query.excludedOwner === 'opp') return `not enemy ${content}`;
  return relationMarker(query, content);
}

function compactEntity(entity: RuleEntity | undefined, distributive = false): string {
  if (!entity) return '';
  if (entity.kind === 'reference') return entity.reference === 'self' ? '' : entity.reference;
  if (entity.kind === 'wildcard') return 'any';
  if (entity.kind === 'query') return compactQuery(entity, distributive);
  if (entity.kind === 'directed') {
    const distance = entity.distance === 1 ? 'adj' : entity.distance === undefined ? entity.direction : String(entity.distance);
    return entity.filter ? relationMarker(entity.filter, distance) : distance;
  }
  return entity.types[0]?.attribute ?? entity.units[0]?.attribute ?? entity.regions[0]?.attribute ?? 'any';
}

function compactSelector(selector: ParsedHaveRule['selector'], distributive = false): string {
  return selector.kind === 'state' ? compactCondition(selector) : compactEntity(selector, distributive);
}

function compactProperty(state: RuleState): string {
  const values = state.property.parameters.map(value => Number(value ?? 0));
  if (state.property.name === 'up-mod') {
    const physical = values[0] ? signed(values[0]) : '';
    const magic = values[1] ? `~${signed(values[1])}~` : '';
    return [physical, magic].filter(Boolean).join(' ');
  }
  if (state.property.name === 'up-life') {
    const current = values[0] ? `${signed(values[0])}❤️` : '';
    const maximum = values[1] ? `${signed(values[1])} max❤️` : '';
    return [current, maximum].filter(Boolean).join(' ');
  }
  if (state.property.action) {
    const icon = glyphs[state.property.action] ?? state.property.action;
    if (values.length === 1) return `${icon}${signed(values[0])}`;
    return `${values[0] ? signed(values[0]) : '+0'}${icon}${values[1] ? signed(values[1]) : '+0'}`;
  }
  return state.property.name.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function compactCondition(condition: RuleObservableCondition): string {
  if (condition.kind === 'boolean') {
    const separator = condition.operator === 'and' ? ' & ' : ' | ';
    const value = condition.conditions.map(compactCondition).join(separator);
    return condition.operator === 'not' ? `not ${value}` : value;
  }
  if (condition.kind === 'history') return `${compactAction(condition.event)} ${condition.interval.replaceAll('-', ' ')}`;
  const property = condition.property.name;
  if (property === 'bashing') {
    const subject = compactEntity(condition.subject);
    return `${subject ? `${subject} ` : ''}⚔️${condition.object ? ` ${compactEntity(condition.object)}` : ''}`;
  }
  if (property === 'shielded' || property === 'shielded-by-ally') return '🛡️';
  if (property === 'mshielded') return '~🛡️~';
  if (property === 'wounded') return 'Wounded';
  if (property.startsWith('is-')) return compactAction({ kind: 'relation', subject: condition.subject, action: { name: property.slice(3).replace(/ing$/, ''), parameters: [], qualifiers: [] }, object: condition.object });
  return property.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function compactAnchor(phrase: RulePhrase): string {
  if (phrase.action.name === 'bash' && phrase.object?.kind === 'reference' && phrase.object.reference === 'self') return 'is ⚔️';
  if (phrase.action.name === 'deploy') return `Deploy${phrase.object ? ` ${compactEntity(phrase.object)}` : ''}`;
  const subject = compactEntity(phrase.subject);
  return [subject, compactAction(phrase)].filter(Boolean).join(' ');
}

function compactConsequence(consequence: RuleTriggeredConsequence): string {
  if (consequence.kind === 'event') return compactAction(consequence.event);
  if (consequence.kind === 'distributed-state') return `${compactProperty(consequence.state)} ${compactSelector(consequence.selector, true)}`.trim();
  return compactProperty(consequence.state);
}

function compactHave(rule: ParsedHaveRule): string {
  const attachment = rule.attachment.kind === 'have' ? compactHave(rule.attachment) : compactProperty(rule.attachment);
  if (rule.selector.kind === 'state') return `${compactCondition(rule.selector)}: ${attachment}`;
  return `${attachment} ${compactEntity(rule.selector, true)}`.trim();
}

export function compactRuleDescriptions(rules: readonly ParsedRule[] | undefined): string[] {
  return (rules ?? []).map(rule => {
    if (rule.kind === 'continuous') return `${compactCondition(rule.condition)}: ${compactProperty(rule.contribution)}`;
    if (rule.kind === 'have') return compactHave(rule);
    const anchor = rule.anchor.kind === 'phase'
      ? rule.anchor.phase.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
      : compactAnchor(rule.anchor);
    return `${anchor}: ${rule.consequences.map(compactConsequence).join(' & ')}`;
  });
}

function entityWords(entity: RuleEntity | undefined, plural = false): string {
  if (!entity) return '';
  if (entity.kind === 'reference') return entity.reference === 'self' ? 'this unit' : `the triggering ${entity.reference === 'subj' ? 'subject' : 'target'}`;
  if (entity.kind === 'wildcard') return plural ? 'any units or hexes' : 'any legal target';
  if (entity.kind === 'directed') {
    const distance = entity.distance === 1 ? 'adjacent to' : entity.distance !== undefined ? `exactly ${entity.distance} hexes from` : entity.direction.replaceAll('-', ' ');
    const kind = entity.filter ? queryWords(entity.filter, plural) : plural ? 'eligible units or hexes' : 'an eligible unit or hex';
    return `${kind} ${distance} ${entityWords(entity.reference)}`;
  }
  if (entity.kind === 'query') return queryWords(entity, plural);
  return plural ? 'matching units' : 'a matching unit';
}

function selectorWords(selector: ParsedHaveRule['selector'], plural = false): string {
  return selector.kind === 'state' ? `units for which ${conditionWords(selector)}` : entityWords(selector, plural);
}

function queryWords(query: RuleFieldQuery, plural: boolean): string {
  if (query.side === 'opp' && !query.owner && !query.entityType) return plural ? 'hexes on the enemy side' : 'a hex on the enemy side';
  if (query.side === 'you' && !query.owner && !query.entityType) return plural ? 'hexes on your side' : 'a hex on your side';
  const owner = query.owner === 'you' ? 'friendly ' : query.owner === 'opp' ? 'enemy '
    : query.excludedOwner === 'you' ? 'non-friendly ' : query.excludedOwner === 'opp' ? 'non-enemy ' : '';
  const type = query.entityType ?? 'unit';
  const noun = `${owner}${type}${plural ? 's' : ''}`;
  return plural ? noun : `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

function actionWords(phrase: RulePhrase): string {
  const values = phrase.action.parameters.filter(value => value !== undefined).map(Number);
  const target = phrase.object ? ` targeting ${entityWords(phrase.object)}` : '';
  if ((phrase.action.name === 'move' || phrase.action.name === 'fly') && values.length) {
    return `${labels[phrase.action.name]} up to ${values[0]} hex${values[0] === 1 ? '' : 'es'}${target}`;
  }
  if (values.length >= 2) return `${labels[phrase.action.name] ?? phrase.action.name} with value ${values[0]} at range ${values[1]}${target}`;
  if (values.length === 1) return `${labels[phrase.action.name] ?? phrase.action.name} with value ${values[0]}${target}`;
  return `${labels[phrase.action.name] ?? phrase.action.name}${target}`;
}

function conditionWords(condition: RuleObservableCondition): string {
  if (condition.kind === 'boolean') {
    const joined = condition.conditions.map(conditionWords).join(condition.operator === 'and' ? ' and ' : ' or ');
    return condition.operator === 'not' ? `not (${joined})` : joined;
  }
  if (condition.kind === 'history') return `${entityWords(condition.event.subject)} did not ${actionWords(condition.event)} ${condition.interval.replaceAll('-', ' ')}`;
  if (condition.property.name === 'bashing') return `${entityWords(condition.subject)} is bashing ${entityWords(condition.object)}`;
  if (condition.property.name.startsWith('is-')) return `${entityWords(condition.subject)} is performing ${condition.property.name.slice(3).replaceAll('-', ' ')}`;
  return `${entityWords(condition.subject)} is ${condition.property.name.replaceAll('-', ' ')}`;
}

function propertyWords(state: RuleState, subject = entityWords(state.subject)): string {
  const values = state.property.parameters.map(value => Number(value ?? 0));
  if (state.property.name === 'up-mod') {
    const parts = [values[0] ? `${signed(values[0])} physical modifier` : '', values[1] ? `${signed(values[1])} magic modifier` : ''].filter(Boolean);
    return `${subject} gains ${parts.join(' and ')}`;
  }
  if (state.property.name === 'up-life') {
    const parts = [values[0] ? `${signed(values[0])} current life` : '', values[1] ? `${signed(values[1])} maximum life` : ''].filter(Boolean);
    return `${subject} gains ${parts.join(' and ')}`;
  }
  if (state.property.action) {
    const owner = subject === 'it' ? 'its' : `${subject}'s`;
    return `${owner} ${state.property.action} values change by ${values.map(signed).join(', ')}`;
  }
  return `${subject} gains ${state.property.name.replaceAll('-', ' ')}`;
}

function lifetimeWords(lifetime: RuleLifetime): string {
  if (lifetime.kind === 'permanent') return ' permanently';
  const event = lifetime.event.kind === 'phase' ? lifetime.event.phase.replaceAll('-', ' ')
    : lifetime.event.action.name === 'hit' && lifetime.event.object?.kind === 'reference' && lifetime.event.object.reference === 'self' ? 'this unit is hit'
    : lifetime.event.action.name === 'bash' && lifetime.event.stage === 'resolved' ? 'this bash resolves'
    : actionWords(lifetime.event);
  return lifetime.kind === 'until' ? ` until ${event}` : ` until after ${event}`;
}

function consequenceWords(consequence: RuleTriggeredConsequence): string {
  if (consequence.kind === 'event') return `you ${consequence.event.mandatory ? 'must' : 'may'} ${actionWords(consequence.event)}`;
  if (consequence.kind === 'distributed-state') {
    return `${propertyWords(consequence.state, `each ${selectorWords(consequence.selector).replace(/^a /, '')}`)}${lifetimeWords(consequence.lifetime)}`;
  }
  return `${propertyWords(consequence.state)}${lifetimeWords(consequence.lifetime)}`;
}

function anchorWords(rule: Extract<ParsedRule, { kind: 'trigger' }>): string {
  if (rule.anchor.kind === 'phase') {
    const phase = rule.anchor.phase;
    if (phase === 'start') return 'At the start of your turn';
    if (phase === 'end') return 'At the end of your turn';
    if (phase === 'opponent-start') return "At the start of the opponent's turn";
    if (phase === 'opponent-end') return "At the end of the opponent's turn";
    return `At ${phase.replaceAll('-', ' ')}`;
  }
  const phrase = rule.anchor;
  if (phrase.action.name === 'die') return 'When this unit dies';
  if (phrase.action.name === 'deploy') return `When this unit deploys${phrase.object ? ` to ${entityWords(phrase.object)}` : ''}`;
  if (phrase.action.name === 'bash' && phrase.object?.kind === 'reference' && phrase.object.reference === 'self') return 'When this unit is bashed';
  const subject = entityWords(phrase.subject);
  const target = phrase.object ? ` ${entityWords(phrase.object)}` : '';
  const verb = phrase.action.name === 'fire' ? 'uses Fire'
    : phrase.action.name === 'bow' ? 'uses Bow'
    : phrase.action.name === 'wound' ? 'wounds'
    : phrase.action.name === 'hit' ? 'hits'
    : phrase.action.name === 'move' ? 'moves'
    : phrase.action.name === 'stun' ? 'stuns'
    : phrase.action.name === 'bash' ? 'bashes'
    : `${labels[phrase.action.name] ?? phrase.action.name}s`;
  return `When ${subject} ${verb}${target}`;
}

function detailedHave(rule: ParsedHaveRule): string {
  if (rule.selector.kind === 'state' && rule.attachment.kind === 'state') {
    const subject = rule.selector.subject.kind === 'reference' && rule.selector.subject.reference === 'self' ? 'this unit' : 'that unit';
    return `While ${conditionWords(rule.selector)}, ${propertyWords(rule.attachment, subject)}`;
  }
  const selected = `Each ${selectorWords(rule.selector).replace(/^an? /, '')}`;
  if (rule.attachment.kind === 'state') return propertyWords(rule.attachment, selected);
  return `${selected} has this rule: ${detailedHave(rule.attachment)}`;
}

export function detailedRuleDescriptions(rules: readonly ParsedRule[] | undefined): string[] {
  return (rules ?? []).map(rule => {
    if (rule.kind === 'continuous') return `While ${conditionWords(rule.condition)}, ${propertyWords(rule.contribution)}.`;
    if (rule.kind === 'have') return `${detailedHave(rule)}.`;
    const guard = rule.guard ? `, if ${conditionWords(rule.guard)}` : '';
    return `${anchorWords(rule)}${guard}: ${rule.consequences.map(consequenceWords).join('; then ')}.`;
  });
}
