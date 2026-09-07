import type { RuleEntity, RuleFieldQuery } from '../game/rule-parser.js';

function color(query: RuleFieldQuery, text: string): string {
  return query.owner === 'you' ? `[[friend:${text}]]` : query.owner === 'opp' ? `[[enemy:${text}]]` : text;
}
function relation(owner: 'you' | 'opp' | 'none', text: string): string {
  return `[[${owner === 'you' ? 'friend' : owner === 'opp' ? 'enemy' : 'neutral'}:${text}]]`;
}
function simpleOwner(query: RuleFieldQuery): boolean {
  return !query.bomb && !query.region && !query.control && !query.side && !query.entityType && !query.excludedOwner;
}

/** Compact targets must be unambiguous; complex selections are expanded only in hover. */
export function selectorText(entity: RuleEntity | undefined, hover = false): string {
  if (!entity) return '';
  if (entity.kind === 'player') return entity.player === 'you' ? 'you' : 'opp';
  if (entity.kind === 'reference') return entity.reference === 'self' ? 'here' : entity.reference;
  if (entity.kind === 'wildcard') return 'any';
  if (entity.kind === 'query') {
    if (simpleOwner(entity)) return color(entity, entity.owner === 'none' ? 'empty' : entity.owner === 'both' ? 'both' : 'any');
    if (!entity.bomb && !entity.region && !entity.excludedOwner) {
      const labels = [entity.entityType ? color(entity, entity.entityType) : '', entity.side ? relation(entity.side, 'side') : '', entity.control ? relation(entity.control, 'ctrl') : ''].filter(Boolean);
      if (labels.length === 1 && (!entity.owner || entity.entityType)) return labels[0];
    }
    if (!hover) return 'X';
    return [entity.owner ? color(entity, entity.owner === 'none' ? 'empty' : 'any') : '', entity.excludedOwner ? `not ${entity.excludedOwner}` : '',
      entity.bomb === 'bomb' ? '💣' : entity.bomb === 'bomb-off' ? 'unlit 💣' : entity.bomb === 'bomb-on' ? 'lit 💣' : entity.bomb === 'none' ? 'no 💣' : '',
      entity.region ?? '', entity.control ? relation(entity.control, 'ctrl') : '', entity.side ? relation(entity.side, 'side') : '', entity.entityType ?? ''].filter(Boolean).join(' ');
  }
  if (entity.kind === 'directed') {
    const here = entity.reference.reference === 'self';
    const radial = entity.direction === 'range-from';
    if (here && radial && entity.distance === 1 && entity.filter && simpleOwner(entity.filter)) return color(entity.filter, 'adj');
    if (!hover) {
      if (here && radial && !entity.filter) return String(entity.distance ?? 'X');
      if (here && radial && entity.filter && simpleOwner(entity.filter)) return `${selectorText(entity.filter)} ${entity.distance ?? 'X'}`;
      if (here && radial && entity.distance === 1 && entity.filter && simpleOwner(entity.filter)) return color(entity.filter, 'adj');
      return 'X';
    }
    const distance = radial ? `${entity.within ? 'within ' : ''}${entity.distance ?? ''} from` : `${entity.distance ?? ''} ${entity.direction.replaceAll('-', ' ')}`;
    return [entity.filter ? selectorText(entity.filter, true) : '', distance.trim(), selectorText(entity.reference, true)].filter(Boolean).join(' ');
  }
  if (!hover) return 'X';
  if (entity.kind === 'complement') return `not (${selectorText(entity.operand, true)})`;
  if (entity.kind === 'intersection') return entity.operands.map(part => selectorText(part, true)).join(' ');
  if (entity.kind === 'named') return `${entity.scope} ${entity.named.name} ${typeof entity.named.value === 'boolean' ? entity.named.value ? 'on' : 'off' : entity.named.value}`;
  return [...entity.units, ...entity.regions, ...entity.types].map(item => `${item.negated ? 'not ' : ''}${item.attribute}`).join(' ') || 'any';
}
