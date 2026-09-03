import type { ActionQualifier, CardAction, PassiveKind, RegionType, TroopRole, TroopSeed } from './cards.js';
import { parseRule } from './rule-parser.js';

export interface CardSource {
  id: string;
  name?: string;
  role?: TroopRole;
  baseHealth: number;
  deploymentRegions: string;
  actions?: string;
  passives?: string;
  /** Canonical normalized rules, parsed exactly once with the catalogue. */
  rules?: readonly string[];
  /** Stable identities used by stack rows and persisted rule contributions. */
  ruleIds?: readonly string[];
}

const number = (token: string, context: string): number => {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error(`${context}: expected a number, received "${token}"`);
  return value;
};

function actionName(token: string): { kind: CardAction['kind']; type?: CardAction['type'] } {
  const parts = token.split('.');
  const name = parts.pop() ?? '';
  const type: ActionQualifier[] = parts.map(part => part === 'P' ? 'pierce' : part === 'F' ? 'instant' : part === 'T' ? 'tireless' : (() => { throw new Error(`unknown action qualifier "${part}"`); })());
  const kind = ({ bow: 'ranged', fire: 'fire', cannon: 'cannon', gore: 'gore', bomb: 'bomb', push: 'push', pull: 'pull', stun: 'stun', mend: 'mending', shield: 'defense', mshield: 'defense' } as const)[name as 'bow'];
  if (!kind) throw new Error(`unknown action "${name}"`);
  if (name === 'mshield') type.push('magic');
  return { kind, ...(type.length ? { type } : {}) };
}

export function parseAction(text: string, context = 'action'): CardAction {
  const functionMatch = text.trim().match(/^((?:[PFT]\.)*)([a-z][a-z-]*)\(([^)]*)\)$/);
  if (functionMatch) {
    const qualifierPrefix = functionMatch[1];
    const name = functionMatch[2];
    const parameters = functionMatch[3].trim()
      ? functionMatch[3].split(',').map(token => number(token.trim(), context))
      : [];
    const type: ActionQualifier[] = qualifierPrefix.split('.').filter(Boolean).map(part =>
      part === 'P' ? 'pierce' : part === 'F' ? 'instant' : 'tireless');
    if (name === 'move' || name === 'fly') {
      if (parameters.length !== 1) throw new Error(`${context}: ${name} needs exactly one parameter`);
      return { kind: name, range: parameters[0], ...(type.length ? { type } : {}) };
    }
    if (name === 'revive') {
      if (parameters.length) throw new Error(`${context}: revive takes no parameters`);
      return { kind: 'revive', range: 0, ...(type.length ? { type } : {}) };
    }
    if (name === 'upgrade') {
      if (parameters.length !== 3) throw new Error(`${context}: upgrade needs exactly three parameters`);
      return { kind: 'upgrade', amount: [parameters[0], parameters[1]], range: parameters[2], ...(type.length ? { type } : {}) };
    }
    const parsed = actionName(name);
    if (parameters.length !== 2) throw new Error(`${context}: ${name} needs exactly two parameters`);
    if (parsed.kind === 'mending' && parameters[1] === 0) return parameters[0] < 0
      ? { kind: 'damage', amount: Math.abs(parameters[0]), range: 0, type: ['permanent', ...type] }
      : { kind: 'heal', amount: parameters[0], range: 0, ...(type.length ? { type } : {}) };
    return { kind: parsed.kind, amount: parameters[0], range: parameters[1], ...((parsed.type?.length || type.length) ? { type: [...(parsed.type ?? []), ...type] } : {}) };
  }
  const tokens = text.trim().split(/\s+/);
  if (tokens[0] === 'move' || tokens[0] === 'fly') return { kind: tokens[0], range: number(tokens[1], context) };
  if (tokens[0] === 'revive') return { kind: 'revive', range: 0 };
  if (/^[+-]\d+$/.test(tokens[0] ?? '') && tokens[1] === 'bow' && /^[+-]\d+$/.test(tokens[2] ?? '')) {
    return { kind: 'upgrade', amount: [number(tokens[0], context), number(tokens[2], context)], range: 0, type: ['permanent', 'attack'] };
  }
  if (tokens[1] === 'upgrade') return { kind: 'upgrade', amount: [number(tokens[0], context), number(tokens[2], context)], range: number(tokens[3], context) };
  if (tokens[1] === 'mod') return { kind: 'modifier', amount: [number(tokens[0], context), number(tokens[2], context)], range: 0, ...(tokens.includes('all-adj-friend') ? { type: ['adjacent'] } : {}) };
  if (tokens[1] === 'life' || tokens[1] === 'maxlife') return { kind: tokens[1], amount: number(tokens[0], context), range: 0 };
  if (tokens[1] === 'damage') return { kind: 'damage', amount: Math.abs(number(tokens[0], context)), range: number(tokens[2], context), type: ['permanent'] };
  const parsed = actionName(tokens[1] ?? '');
  const amount = number(tokens[0], context);
  const range = number(tokens[2], context);
  if (parsed.kind === 'mending' && range === 0) return amount < 0
    ? { kind: 'damage', amount: Math.abs(amount), range: 0, type: ['permanent'] }
    : { kind: 'heal', amount, range: 0 };
  const type = [...(parsed.type ?? []), ...(tokens.includes('all-adj-friend') ? ['adjacent' as const] : [])];
  return { kind: parsed.kind, amount, range, ...(type.length ? { type } : {}) };
}

export function parseActions(text: string | undefined, context = 'actions', implicitMove = true): readonly CardAction[] {
  const phrases: string[] = [];
  let depth = 0;
  let start = 0;
  const source = text ?? '';
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') depth -= 1;
    else if (source[index] === ',' && depth === 0) {
      phrases.push(source.slice(start, index));
      start = index + 1;
    }
    if (depth < 0) throw new Error(`${context}: unmatched closing parenthesis`);
  }
  if (depth !== 0) throw new Error(`${context}: unmatched opening parenthesis`);
  phrases.push(source.slice(start));
  const explicit = phrases.map(value => value.trim()).filter(Boolean).map(value => parseAction(value, context));
  if (implicitMove && !explicit.some(action => action.kind === 'move' || action.kind === 'fly')) explicit.unshift({ kind: 'move', range: 1 });
  return explicit.filter(action => action.kind !== 'move' || action.range > 0);
}

export function parseCard(source: CardSource): TroopSeed {
  const title = source.name ?? source.id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  const regions = source.deploymentRegions.split(/\s+/).filter(region => region !== 'enemy') as RegionType[];
  const parsedActions = parseActions(source.actions, `${source.id} actions`, (source.role ?? 'troop') !== 'temple');
  const rules = source.rules?.map((rule, index) => parseRule(rule, `${source.id} rule ${index + 1}`));
  const selfDefense = parsedActions.find(action => action.kind === 'defense' && action.range === 0 && !action.type?.includes('magic'));
  const selfMagicDefense = parsedActions.find(action => action.kind === 'defense' && action.range === 0 && action.type?.includes('magic'));
  const actions = parsedActions.filter(action => action !== selfDefense && action !== selfMagicDefense);
  return {
    id: source.id, name: title, role: source.role ?? 'troop', baseHealth: source.baseHealth,
    deploymentRegions: regions, actions,
    ...(source.deploymentRegions.split(/\s+/).includes('enemy') ? { deploymentRule: 'enemy-region' as const } : {}),
    ...(source.passives ? { passives: source.passives.split(/\s+/) as PassiveKind[] } : {}),
    ...(selfDefense ? { selfDefense: Number(selfDefense.amount ?? 0) } : {}),
    ...(selfMagicDefense ? { selfMagicDefense: Number(selfMagicDefense.amount ?? 0) } : {}),
    ...(rules ? { rules, ruleSources: [...(source.rules ?? [])], ruleIds: [...(source.ruleIds ?? [])] } : {})
  };
}
