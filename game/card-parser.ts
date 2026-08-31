import type { ActionQualifier, CardAction, ContinuousEffect, PassiveKind, RegionType, TriggerCondition, TriggerDefinition, TroopRole, TroopSeed } from './cards.js';

export interface CardSource {
  id: string;
  name?: string;
  role?: TroopRole;
  baseHealth: number;
  deploymentRegions: string;
  actions?: string;
  passives?: string;
  triggers?: string;
  continuous?: string;
  continuousEffects?: string;
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
  const explicit = (text ?? '').split(',').map(value => value.trim()).filter(Boolean).map(value => parseAction(value, context));
  if (implicitMove && !explicit.some(action => action.kind === 'move' || action.kind === 'fly')) explicit.unshift({ kind: 'move', range: 1 });
  return explicit.filter(action => action.kind !== 'move' || action.range > 0);
}

export function parseCondition(text: string): TriggerCondition {
  const words = text.trim().split(/\s+/);
  const verb = words.find(word => ['start', 'end', 'deploy', 'bash', 'is-bash-by', 'fire', 'shield', 'stun', 'hit', 'wound', 'wounds', 'move', 'die', 'dies'].includes(word));
  switch (verb) {
    case 'start': case 'end': return { kind: 'phase', type: [verb], subject: 'self' };
    case 'deploy': return { signal: 'deploy', subject: 'self' };
    case 'bash': return { signal: 'bashAttack', subject: 'self' };
    case 'is-bash-by': return { signal: 'bashDefense', subject: 'self' };
    case 'fire': return { signal: 'magicUsed', subject: 'self' };
    case 'shield': return { kind: 'defense', subject: 'self' };
    case 'stun': return { signal: 'stunUsed', subject: 'self' };
    case 'hit': return { signal: 'attackResolved', subject: 'self' };
    case 'wound': case 'wounds': return { signal: 'successfulAttack', subject: 'self' };
    case 'move': return { signal: 'movementUsed', subject: 'self' };
    case 'die': case 'dies': return { signal: 'death', subject: 'self' };
    default: throw new Error(`unknown trigger condition "${text}"`);
  }
}

export function parseTriggers(text: string | undefined, cardId: string): readonly TriggerDefinition[] | undefined {
  if (!text) return undefined;
  const result: TriggerDefinition[] = [];
  for (const [ruleIndex, rule] of text.split(',').map(value => value.trim()).filter(Boolean).entries()) {
    const separator = rule.indexOf(':');
    if (separator < 0) throw new Error(`${cardId}: trigger "${rule}" needs ':'`);
    const condition = parseCondition(rule.slice(0, separator));
    const effects = rule.slice(separator + 1).split('&').map(value => value.trim()).filter(Boolean);
    const knownIds: Record<string, readonly string[]> = {
      'squirrel-king': ['kindle'], 'wandering-monarch': ['end-stride'], 'stag-guardian': ['renewal'],
      'raven-prince': ['dusk-stun'], 'boar-warlord': ['start-stride', 'battle-hardened'],
      'tortoise-emperor': ['imperial-shelter'], 'thunder-toad': ['thunder-charge'],
      'bellwing-crane': ['bellwing-stun'], 'frosthorn-yak': ['frosthorn-call'],
      'duelist-scorpion': ['duelist-deploy'], 'needle-peacock': ['needle-sting'],
      'iron-bell-golem': ['iron-bell-deploy'], 'prism-moth': ['prismatic-bash'],
      'warding-bat': ['dawn-fire'], 'arcane-viper': ['arcane-resonance'],
      'ironhide-boar-pup': ['gore-hardened'], 'deep-ocean-octopus': ['tentacle-grip'],
      'spellshield-beetle': ['carapace'], 'battle-magpie': ['magpie-strike'],
      'reed-archer': ['sharpen'], 'marching-giant': ['attrition'],
      'phoenix-moth': ['death-burst'], 'pine-processionary': ['revive'],
      'sahel-porcupine': ['momentum'], 'temple-last-bell': ['last-bell']
    };
    for (const [effectIndex, effect] of effects.entries()) {
      const baseId = knownIds[cardId]?.[ruleIndex] ?? `rule-${ruleIndex + 1}`;
      result.push({ id: effects.length === 1 ? baseId : `${baseId}-${effectIndex + 1}`, condition, action: parseAction(effect, `${cardId} trigger`) });
    }
  }
  return result;
}

const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value}`;

function compactAction(action: CardAction): string {
  const values = Array.isArray(action.amount) ? action.amount : [action.amount ?? 0];
  const left = values[0] ?? 0; const right = values[1] ?? 0;
  const qualifier = `${action.type?.includes('pierce') ? 'P' : ''}${action.type?.includes('instant') ? 'F' : ''}${action.type?.includes('tireless') ? 'T' : ''}`;
  const tireless = action.type?.includes('tireless') ? 'T' : '';
  if (action.kind === 'move') return `${tireless}🥾${action.range}`;
  if (action.kind === 'fly') return `${tireless}🪽${action.range}`;
  if (action.kind === 'ranged') return `${left}${qualifier}🏹${action.range}`;
  if (action.kind === 'fire') return `${left}${qualifier}🔥${action.range}`;
  if (action.kind === 'cannon') return `${left}${tireless}🧨${action.range}`;
  if (action.kind === 'gore') return `${left}${tireless}🐏${action.range}`;
  if (action.kind === 'bomb') return `${left}${tireless}💣${action.range}`;
  if (action.kind === 'push') return `${left}${tireless}🫸${action.range}`;
  if (action.kind === 'pull') return `${left}${tireless}🫷${action.range}`;
  if (action.kind === 'stun') return `${left}${tireless}🚫${action.range}`;
  if (action.kind === 'mending' || action.kind === 'heal') return `${signed(left)}${tireless}❤️${action.range || ''}`;
  if (action.kind === 'damage') return `${signed(-Math.abs(left))}❤️${action.range || ''}`;
  if (action.kind === 'life') return `${signed(left)}❤️`;
  if (action.kind === 'maxlife') return `${signed(left)} max❤️`;
  if (action.kind === 'defense') {
    const shield = `${signed(left)}${tireless}🛡️${action.range || ''}`;
    const result = action.type?.includes('magic') ? `~${shield}~` : shield;
    return `${result}${action.type?.includes('adjacent') ? ' [[friend:all adj]]' : ''}`;
  }
  if (action.kind === 'modifier') return `${[left ? signed(left) : '', right ? `~${signed(right)}~` : ''].filter(Boolean).join(' ') || '+0'}${action.type?.includes('adjacent') ? ' [[friend:all adj]]' : ''}`;
  if (action.kind === 'upgrade' && action.type?.includes('attack')) return `${signed(left)}🏹${signed(right)}`;
  if (action.kind === 'upgrade') return `${left}🔮${right} ${action.range}`;
  if (action.kind === 'revive') return '👼';
  return action.kind;
}

function compactCondition(text: string): string {
  const words: Record<string, string> = {
    start: 'Start', end: 'End', deploy: 'Deploy', bash: '⚔️', 'is-bash-by': 'is ⚔️',
    fire: '🔥', shield: '🛡️', stun: '🚫', hit: 'hits', wound: 'wounds', wounds: 'wounds',
    move: '🥾', die: '💀', dies: '💀', self: 'self', 'any-friend': '[[friend:any]]',
    'any-enemy': '[[enemy:any]]', 'all-friend': '[[friend:all]]', 'all-enemy': '[[enemy:all]]',
    'adjacent-friend': '[[friend:adj]]', 'adjacent-enemy': '[[enemy:adj]]',
    'hero-friend': '[[friend:hero]]', 'hero-enemy': '[[enemy:hero]]',
    'all-adj-friend': '[[friend:all adj]]', 'all-adj-enemy': '[[enemy:all adj]]',
    'any-hex-friend': '[[friend-dark:⬢]]', 'any-hex-enemy': '[[enemy-dark:⬢]]',
    'enemy-hex': 'enemy hex', wounded: 'Wounded', shielded: 'is 🛡️', deployed: 'Deployed', hero: 'hero', subject: ''
  };
  return text.trim().split(/\s+/).map(word => words[word] ?? word.replaceAll('-', ' ')).filter(Boolean).join(' ');
}

export function triggerDescription(text: string, cardId = 'trigger'): string {
  return text.split(',').map(rule => {
    const separator = rule.indexOf(':');
    if (separator < 0) throw new Error(`${cardId}: trigger "${rule.trim()}" needs ':'`);
    const condition = compactCondition(rule.slice(0, separator));
    const actions = rule.slice(separator + 1).split('&').map(value => compactAction(parseAction(value.trim(), `${cardId} trigger`)));
    return `${condition}: ${actions.join(' & ')}`;
  }).join('\n');
}

export function continuousDescription(text: string, cardId = 'continuous'): string {
  const delimiter = text.includes('::') ? '::' : ':';
  const separator = text.indexOf(delimiter);
  if (separator < 0) throw new Error(`${cardId}: continuous rule needs '::'`);
  const rawCondition = text.slice(0, separator).trim();
  const condition = compactCondition(rawCondition);
  const effectText = text.slice(separator + delimiter.length).trim();
  let effect: string;
  const abilityBonus = effectText.match(/^([+-]\d+)\s+(bow|fire)\s+([+-]\d+)/);
  const moveBonus = effectText.match(/^move\s+([+-]\d+)/);
  if (/^[+-]?\d+$/.test(effectText)) effect = signed(Number(effectText));
  else if (abilityBonus) effect = `${abilityBonus[1]}${abilityBonus[2] === 'bow' ? '🏹' : '🔥'}${abilityBonus[3]}`;
  else if (moveBonus) effect = `🥾${moveBonus[1]}`;
  else effect = compactAction(parseAction(effectText, `${cardId} continuous`));
  const audience = effectText.includes('all-friend') ? ' [[friend:all]]' : effectText.includes('all-enemy') ? ' [[enemy:all]]' : '';
  return rawCondition === 'deployed' ? `${effect}${audience}` : `${condition}: ${effect}${audience}`;
}

function parseContinuous(text: string | undefined, cardId: string): readonly ContinuousEffect[] | undefined {
  if (!text) return undefined;
  const delimiter = text.includes('::') ? '::' : ':';
  const [conditionText, effectText] = text.split(delimiter).map(value => value.trim());
  if (!effectText) throw new Error(`${cardId}: continuous rule needs '::'`);
  const label = cardId.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  if (/\b(bow|fire)\b/.test(effectText) || effectText.startsWith('move ')) {
    const match = effectText.match(/^(?:([+-]\d+)\s+)?(bow|fire|move)(?:\s+([+-]\d+))?/);
    if (!match) throw new Error(`${cardId}: invalid continuous ability "${effectText}"`);
    return [{ condition: 'deployed', kind: 'ability-bonus', ability: match[2] === 'bow' ? 'attack' : match[2] === 'fire' ? 'magic' : 'move', left: number(match[1] ?? '0', cardId), right: number(match[3] ?? '0', cardId), label }];
  }
  const value = number(effectText.match(/[+-]?\d+/)?.[0] ?? '', cardId);
  const condition: ContinuousEffect['condition'] = conditionText === 'wounded' ? 'injured'
    : conditionText === 'bash hero' ? 'bash-attacker-vs-hero'
    : conditionText === 'bash' ? 'bash-attacker'
    : conditionText.includes('bash') ? 'in-bash'
    : conditionText === 'deployed' ? 'deployed'
    : conditionText.includes('shield') ? 'shielded'
    : 'deployed';
  return [{ condition, kind: 'combat-modifier', value, label, ...(effectText.includes('subject') ? { scope: 'allies' as const } : {}) }];
}

export function parseCard(source: CardSource): TroopSeed {
  const title = source.name ?? source.id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  const regions = source.deploymentRegions.split(/\s+/).filter(region => region !== 'enemy') as RegionType[];
  const triggers = parseTriggers(source.triggers, source.id);
  const continuousEffects = parseContinuous(source.continuous ?? source.continuousEffects, source.id);
  const parsedActions = parseActions(source.actions, `${source.id} actions`, (source.role ?? 'troop') !== 'temple');
  const selfDefense = parsedActions.find(action => action.kind === 'defense' && action.range === 0 && !action.type?.includes('magic'));
  const selfMagicDefense = parsedActions.find(action => action.kind === 'defense' && action.range === 0 && action.type?.includes('magic'));
  const actions = parsedActions.filter(action => action !== selfDefense && action !== selfMagicDefense);
  return {
    id: source.id, name: title, role: source.role ?? 'troop', baseHealth: source.baseHealth,
    deploymentRegions: regions, actions,
    ...(source.deploymentRegions.split(/\s+/).includes('enemy') ? { deploymentRule: 'enemy-region' as const } : {}),
    ...(source.passives ? { passives: source.passives.split(/\s+/) as PassiveKind[] } : {}),
    ...(source.triggers || source.continuous || source.continuousEffects
      ? { passiveDescription: [source.triggers ? triggerDescription(source.triggers, source.id) : '', source.continuous || source.continuousEffects ? continuousDescription(source.continuous ?? source.continuousEffects ?? '', source.id) : ''].filter(Boolean).join('\n') }
      : {}),
    ...(selfDefense ? { selfDefense: Number(selfDefense.amount ?? 0) } : {}),
    ...(selfMagicDefense ? { selfMagicDefense: Number(selfMagicDefense.amount ?? 0) } : {}),
    ...(triggers ? { triggers } : {}),
    ...(continuousEffects ? { continuousEffects } : {})
  };
}
