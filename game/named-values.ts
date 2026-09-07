import type { RuleBinding } from './rule-evaluator.js';

export type NamedValue = { name: string; value: number | boolean };
export interface NamedValueState {
  namedValues?: Record<string, Record<string, number | boolean>>;
}

export const namedValueVerb = /^(up-)?(hex|unit|player)-(counter|flag)$/;

export function parseNamedValue(name: string, parameters: string): NamedValue | undefined {
  const match = name.match(namedValueVerb);
  if (!match) return undefined;
  const parts = parameters.split(',').map(part => part.trim());
  if (parts.length !== 2 || !/^[a-z][a-z0-9-]*$/.test(parts[0])) throw new Error(`${name}: expected a name and value`);
  if (match[3] === 'flag') {
    if (!['on', 'off'].includes(parts[1])) throw new Error(`${name}: flags require on or off`);
    return { name: parts[0], value: parts[1] === 'on' };
  }
  if (!/^-?\d+$/.test(parts[1]) || !Number.isSafeInteger(Number(parts[1]))) throw new Error(`${name}: counters require a safe integer`);
  return { name: parts[0], value: Number(parts[1]) };
}

function attachmentKey(binding: RuleBinding): string {
  return binding.kind === 'hex' ? `hex:${binding.coordinate}` : binding.kind === 'unit' ? `unit:${binding.unitId}` : `player:${binding.player}`;
}

export function readNamedValue(state: NamedValueState, binding: RuleBinding, name: string, flag: boolean): number | boolean {
  return state.namedValues?.[attachmentKey(binding)]?.[`${flag ? 'flag' : 'counter'}:${name}`] ?? (flag ? false : 0);
}

export function applyNamedValue(state: NamedValueState, verb: string, object: RuleBinding | undefined, named: NamedValue | undefined): boolean | undefined {
  const match = verb.match(namedValueVerb);
  if (!match?.[1]) return undefined;
  if (!object || object.kind !== match[2] || !named) return false;
  const flag = match[3] === 'flag';
  const value = flag ? named.value : Number(readNamedValue(state, object, named.name, false)) + Number(named.value);
  if (flag ? typeof value !== 'boolean' : !Number.isSafeInteger(value)) return false;
  const key = attachmentKey(object);
  ((state.namedValues ??= {})[key] ??= {})[`${flag ? 'flag' : 'counter'}:${named.name}`] = value;
  return true;
}
