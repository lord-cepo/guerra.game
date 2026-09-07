import type { CardAction } from '../game/cards.js';
import { radiusSelector } from '../game/action-selector.js';
import { ruleWord } from '../game/rule-vocabulary.js';
import type { ParsedHaveRule, ParsedRule, RuleLifetime, RuleObservableCondition, RulePhrase, RuleState, RuleTriggeredConsequence } from '../game/rule-parser.js';
import { selectorText } from './rule-selector-text.js';
import { consequenceIsMandatory } from '../game/consequence-policy.js';

const glyphs: Readonly<Record<string, string>> = {
  move: '🥾', fly: '🪽', bow: '🏹', fire: '🔥', cannon: '🧨', gore: '🐏',
  shield: '🛡️', mshield: '🛡️', push: '🫸', pull: '🫷', stun: '🚫', mend: '❤️',
  upgrade: '🔮', bash: '⚔️', wound: 'wound', hit: 'hit', die: '💀', deploy: 'deploy',
  revive: 'revive', 'gore-move': '🐏', 'gore-attack': '🐏', 'bomb-throw': '💣',
  'bomb-light': 'light 💣', 'bomb-explode': 'explode 💣', 'bomb-defuse': 'defuse 💣', light: 'light'
};
const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value}`;
const self = { kind: 'reference' as const, reference: 'self' as const };
const isSelf = (entity: RulePhrase['subject'] | undefined): boolean => entity?.kind === 'reference' && entity.reference === 'self';

function actionText(phrase: RulePhrase, hover: boolean, anchor = false): string {
  const action = phrase.action;
  let target = selectorText(phrase.object, hover);
  if (glyphs[action.name] && phrase.object?.kind === 'directed' && phrase.object.direction === 'range-from' && isSelf(phrase.object.reference) && !phrase.object.filter) target = String(phrase.object.distance ?? 'X');
  if (phrase.targetPolicy === 'all') target = /\bany\b/.test(target) ? target.replace(/\bany\b/g, 'all') : `all ${target}`;
  const prefix = action.qualifiers.map(value => ({ pierce: 'P', fast: 'F', tireless: 'T', 'action-free': 'A' })[value]).join('');
  if (action.named) return `${action.named.name} ${typeof action.named.value === 'boolean' ? action.named.value ? 'on' : 'off' : signed(action.named.value)}${target ? ` ${target}` : ''}`;
  if (action.name === 'up-actions') return `${signed(Number(action.parameters[0]))} actions ${target}`;
  if (action.name === 'deactivate' || action.name === 'activate') return `${action.name} ${target}`;
  const values = [...action.parameters];
  if (!phrase.object && values.length === ruleWord(action.name)?.userParameters && values.length) target = String(values.pop() ?? 'X');
  else if (phrase.object && values.length === ruleWord(action.name)?.userParameters && values.length) values.pop();
  const body = `${values.map(value => value ?? 'X').join(',')}${prefix}${glyphs[action.name] ?? action.name}${phrase.endpoint === 'origin' ? ' from' : ''}`;
  const showTarget = !(anchor && (target === 'any' || isSelf(phrase.object) && isSelf(phrase.subject)));
  const separator = /^(\d+|X)$/.test(target) && glyphs[action.name] ? '' : hover && phrase.object && !anchor && !isSelf(phrase.object) ? ' to ' : ' ';
  const result = `${body}${showTarget && target ? `${separator}${target}` : ''}`;
  return action.name === 'mshield' ? `~${result}~` : result;
}

export function propertyText(state: Pick<RuleState, 'property'>): string {
  const property = state.property;
  const values = property.parameters.map(value => Number(value ?? 0));
  if (property.named) return `${property.named.name}=${property.named.value}`;
  if (property.name === 'up-mod') return [values[0] ? signed(values[0]) : '', values[1] ? `~${signed(values[1])}~` : ''].filter(Boolean).join(' ');
  if (property.name === 'up-life') return [values[0] ? `${signed(values[0])}❤️` : '', values[1] ? `${signed(values[1])} max❤️` : ''].filter(Boolean).join(' ');
  if (property.action) return values.length === 1 ? `${glyphs[property.action] ?? property.action}${signed(values[0])}` : `${signed(values[0])}${glyphs[property.action] ?? property.action}${signed(values[1])}`;
  return property.name;
}

function conditionText(condition: RuleObservableCondition, hover: boolean): string {
  if (condition.kind === 'selector-condition') {
    const text = condition.selector.kind === 'state' ? conditionText(condition.selector, hover) : selectorText(condition.selector, hover);
    return `${condition.quantifier} ${text}`;
  }
  if (condition.kind === 'boolean') {
    if (condition.operator === 'not' && condition.conditions[0]?.kind === 'state' && condition.conditions[0].property.name === 'active') return 'unactive';
    const text = condition.conditions.map(part => conditionText(part, hover)).join(condition.operator === 'or' ? ' or ' : ' and ');
    return condition.operator === 'not' ? `not (${text})` : text;
  }
  if (condition.kind === 'history') return `${actionText(condition.event, hover, true)} ${condition.interval.replaceAll('-', ' ')}`;
  return [isSelf(condition.subject) ? '' : selectorText(condition.subject, hover), condition.property.name === 'bashing' ? '⚔️' : propertyText(condition), selectorText(condition.object, hover)].filter(Boolean).join(' ');
}

function lifetimeText(lifetime: RuleLifetime, hover: boolean): string {
  if (lifetime.kind === 'permanent') return '';
  const event = lifetime.event.kind === 'phase' ? `${lifetime.event.next ? 'next-' : ''}${lifetime.event.phase}` : actionText(lifetime.event, hover, true);
  return ` ${lifetime.kind === 'until' ? 'until' : 'through'} ${event}`;
}

function haveText(rule: ParsedHaveRule, hover: boolean): string {
  const attachment = rule.attachment.kind === 'have' ? haveText(rule.attachment, hover) : propertyText(rule.attachment);
  if (rule.selector.kind === 'state') return `${hover ? 'while' : 'w'} ${conditionText(rule.selector, hover)}: ${attachment}`;
  return `${attachment} ${hover ? 'to ' : ''}${selectorText(rule.selector, hover)}`;
}

function consequenceText(effect: RuleTriggeredConsequence, hover: boolean, explicitCosts = false): string {
  let text: string;
  if (effect.kind === 'event') {
    const mandatory = consequenceIsMandatory(effect.event.action, effect.event.mandatory, explicitCosts);
    text = `${hover ? mandatory ? 'you must ' : 'you may ' : effect.event.mandatory ? 'must ' : ''}${actionText(effect.event, hover)}`;
  }
  else {
    const target = effect.kind === 'distributed-state' ? effect.selector : isSelf(effect.state.subject) ? undefined : effect.state.subject;
    text = `${propertyText(effect.state)}${target ? ` ${hover ? 'to ' : ''}${target.kind === 'state' ? conditionText(target, hover) : selectorText(target, hover)}` : ''}${lifetimeText(effect.lifetime, hover)}`;
  }
  return `${text}${effect.at ? ` at ${effect.at}` : ''}`;
}

function ruleText(rule: ParsedRule, hover: boolean): string {
  if (rule.kind === 'have') return haveText(rule, hover);
  if (rule.kind === 'continuous') {
    const content = rule.distribution ? haveText(rule.distribution, hover) : propertyText(rule.contribution);
    if (!hover && rule.condition.kind === 'state' && rule.condition.property.name === 'deployed' && isSelf(rule.condition.subject)) return content;
    return `${hover ? 'while' : 'w'} ${conditionText(rule.condition, hover)}: ${content}`;
  }
  const anchor = rule.anchor.kind === 'phase' ? hover ? `at the ${rule.anchor.phase}` : rule.anchor.phase : [isSelf(rule.anchor.subject) ? '' : selectorText(rule.anchor.subject, hover), actionText(rule.anchor, hover, true)].filter(Boolean).join(' ');
  const guard = rule.guard ? `${hover ? ',' : ''} if ${conditionText(rule.guard, hover)}` : '';
  const cost = rule.costs ? `${rule.costs.map(cost => actionText(cost, hover)).join(' and ')} :: ` : '';
  return `${anchor}${guard}: ${cost}${rule.consequences.map(effect => consequenceText(effect, hover, Boolean(rule.costs?.length))).join(' and ')}`;
}

export const compactRuleDescriptions = (rules: readonly ParsedRule[] | undefined): string[] => (rules ?? []).map(rule => ruleText(rule, false));
export const detailedRuleDescriptions = (rules: readonly ParsedRule[] | undefined): string[] => (rules ?? []).map(rule => ruleText(rule, true));

export function cardActionText(action: CardAction, hover = false): string {
  const name = ({ ranged: 'bow', defense: action.type?.includes('magic') ? 'mshield' : 'shield', bomb: 'bomb-throw', mending: 'mend' } as Record<string, string>)[action.kind] ?? action.kind;
  const parameters = action.kind === 'move' || action.kind === 'fly' ? [] : Array.isArray(action.amount) ? [...action.amount] : action.amount === undefined ? [] : [Number(action.amount)];
  const phrase: RulePhrase = { kind: 'relation', subject: self, action: { name, parameters, qualifiers: (action.type ?? []).flatMap(value => value === 'instant' ? ['fast' as const] : value === 'tireless' || value === 'pierce' || value === 'action-free' ? [value] : []) }, object: action.selector ?? radiusSelector(action.range ?? 0) };
  const expand = hover && !(phrase.object?.kind === 'directed' && phrase.object.within);
  return `${actionText(phrase, expand)}${action.followups?.length ? ` and ${action.followups.map(effect => consequenceText(effect, hover)).join(' and ')}` : ''}`;
}
