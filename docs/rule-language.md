# Normalized card-rule language

The normalized parser lives in `game/rule-parser.ts`; its canonical word
metadata lives in `game/rule-vocabulary.ts`. It produces a typed AST but is not
yet connected to authoritative event matching. Catalogue cards still use the
legacy parser in `game/card-parser.ts`.

## Semantic model

A rule is either triggered or continuous:

```text
trigger-rule    = anchor [" if " observable-condition] " : " triggered-effects
continuous-rule = state-contribution " while " observable-condition
```

The spaces around ` : ` are significant. Query fields may themselves contain
colons, such as `o:opp`, without becoming the rule separator.

An **anchor** is one concrete event pattern or phase. It decides when a trigger
is inspected and binds its exact `subj` and `obj`. A guard after `if` does not
wake the rule; it is merely tested when the anchor matches. A negative
historical condition cannot be an anchor and creates no bindings.

```text
end if self wounded : self mend(1,_) self
any-enemy bow self if self wounded : self shield(1,_) self
```

A continuous rule has no anchor and does not fire. It contributes state exactly
while its observable condition is true:

```text
self mod(1,0) while self wounded
self titanium while none bash any during-this-turn
```

An event is one-time and therefore cannot be placed before `while`. These are
invalid:

```text
self mend(1,_) self while self wounded
self wounded while self titanium
```

The first tries to assert an event continuously; the second tries to contribute
the engine-owned `wounded` state.

## States and conditions

```text
snapshot-state       = [subset] property [subset]
historical-condition = subset verb [subset] interval
observable-condition = snapshot-state | historical-condition
state-contribution   = snapshot-state whose property is contributable
```

`observable` and `contributable` are word capabilities, not exclusive kinds:

- observable: a rule may ask whether the property is currently true;
- contributable: a rule may add the property/value to effective game state.

`wounded`, `deployed`, `bashing`, and pending-action properties are observable
but not contributable. Passives such as `titanium` are both. Numeric `mod` and
`up` phrases are contributable; their exact numeric values are intentionally
not Boolean queries.

Current effective state combines three sources:

```text
effective state = intrinsic engine state + stored grants + derived contributions
```

- intrinsic state is owned by the engine (`wounded`, `deployed`, `bashing`);
- stored state is created by an event and has an explicit lifetime;
- derived state is recalculated from a `while` rule and cannot be consumed.

A historical condition is an observable query over recorded events, not a
contributed property:

```text
none bash any during-this-turn
none-enemy fire self since-beginning
```

`none` means `not any`, not an empty entity set. Thus the first example is
`not exists subject, object: bash(subject, object)` in the current turn. It is
valid after `if` or `while`, but it cannot anchor a trigger or bind `subj`/`obj`.
The exact inclusive/exclusive boundaries of turn-history intervals remain an
evaluator decision and must be fixed before authoritative matching.

## Triggered consequences and lifetimes

```text
triggered-effects = triggered-effect (" & " triggered-effect)*
triggered-effect  = event
                  | state-contribution lifetime
lifetime          = " permanent"
                  | " until " event
                  | " removed-after " event
```

A trigger may cause a one-time event:

```text
end : self mend(1,_) self
```

A trigger may instead create stored state, but its lifetime is mandatory:

```text
any-enemy fire self : self titanium until opponent-end
self deploy : self mod(1,0) removed-after any hit self
self deploy : self steady permanent
```

`until E` removes the state before `E` resolves, so it does not participate in
that event. `removed-after E` lets the state participate in `E` and removes it
afterward. For a `+1` physical modifier and a three-damage physical hit:

```text
until hit          -> modifier removed, 3 damage
removed-after hit  -> modifier applies, 2 damage, then it is removed
```

A bare triggered state is rejected because storage cannot be inferred:

```text
any fire self : self titanium       // invalid: missing lifetime
```

Each `&`-separated consequence owns its lifetime. Grouped shared lifetimes and
explicit simultaneous-versus-ordered effect syntax are not accepted yet.

## Entities, queries, and bindings

```text
subset     = self | subj | obj | descriptor
descriptor = [selector "-"] [position "-"] attributes
selector   = any | all | none               // default any
position   = awayfrom-reference | towards-reference | parallel-reference
reference  = self | subj | obj
```

Descriptors denote board hexes. `self` is the rule owner; `subj` and `obj` are
exact identities/hexes bound by the anchor rather than queries reevaluated at
effect time. The evaluator still needs a final ruling on whether a moved bound
unit is followed by identity or whether `obj` preserves the original hex; this
is listed as an ambiguity below.

The existing compact descriptor groups remain supported:

```text
none-enemy&!wounded-int&empty&eside-hero
any-towards-self-enemy
parallel-obj-empty
```

The proposed prefixed query form from `my_rules.md`, such as
`o:opp&p:bomb&c:you`, is reserved but not parsed yet. In particular, the owner
and control uses of `you`/`opp` must not be collapsed into one attribute merely
because their spelling matches.

Position comparisons use the phrase subject at `S` and reference `R`:

- `awayfrom-R`: candidate `H` has `distance(H,R) > distance(S,R)`;
- `towards-R`: candidate `H` has `distance(H,R) < distance(S,R)`;
- `parallel-R`: the distances are equal.

## Events and action notation

```text
event      = [subject] verb [object] | phase
action     = [qualifier "."]* name [parameters]
parameters = "(" parameter ("," parameter)* ")"
parameter  = signed integer | "_"
qualifier  = P | F | T
```

`self` is the implicit subject. `_` is the canonical wildcard. The legacy
packed form remains accepted during migration:

```text
bow(1,_)    == bow1x
T.bomb(2,_) == T.bomb2x
```

Entity operands and user parameters are separate. A binary action has an
origin/subject and destination/object even when it has no numeric parameters.
Unary verbs (`die`, `deploy`, `revive`, `activate`) omit the object.

Movement endpoint suffixes select data from the same event:

```text
self move-from any-econtrol
self move-to any-fcontrol
```

The final event lifecycle will expose at least target and resolution boundaries.
`target` means authoritative target confirmation, `hit` means damage resolution
reached the target even for zero damage, and `wound` requires positive life
loss. Pending properties such as `is-firing` mean the interval after target and
before resolution.

## Canonical dictionary

The machine-readable dictionary is `game/rule-vocabulary.ts`. The following is
the human-readable summary.

### Phases

```text
start end opponent-start opponent-end action-resolve combat-resolve
```

### Delayed action events

| Verb | Arity | Damage class |
|---|---:|---|
| `bash` | 2 | physical |
| `bow` | 2 | physical |
| `fire` | 2 | red magic |
| `cannon` | 2 | black magic |
| `gore-attack` | 2 | physical |
| `bomb-explode` | 2 | black magic |

### Instant action events

```text
shield mshield move fly gore-move push pull mend stun bomb-throw
upgrade defuse light
```

All currently have subject and object operands. “Instant” still has ordered
target and resolve boundaries; they may occur in the same authoritative turn
transition.

### Result and state-change events

| Verb | Meaning |
|---|---|
| `target` | authoritative legal target confirmed |
| `hit` | damage resolution reached the target |
| `wound` | target lost positive life |
| `die` | unary transition to defeated |
| `deploy` | unary transition to deployed |
| `revive` | unary transition out of defeated |
| `activate` | unary transition to active |

### Snapshot properties

| Property | Observable | Contributable | Arity/notes |
|---|:---:|:---:|---|
| `wounded`, `deployed`, `defeated`, `undeployed`, `active` | yes | no | unary engine state |
| `bashing`, `bashed-by` | yes | no | binary relationship |
| `is-firing`, `is-bowing`, `is-gore-attacking`, `is-cannoning`, `is-bomb-exploding` | yes | no | binary pending relationship |
| `first-strike`, `steady`, `titanium`, `obsidian` | yes | yes | unary passive |
| `mod(M,N)` | no | yes | numeric physical/magic contribution |
| `up.action(M,N)` | no | yes | numeric action upgrade contribution |
| `action-reachable` | yes | no | unary legal-target existence |
| `action-reaches` | yes | no | binary legal-target relation |

## Reserved ambiguities

These words are deliberately not given a guessed meaning:

| Word | Required ruling |
|---|---|
| `attack` | Which of Bash, Bow, Gore, Fire, Cannon, and Bomb count? |
| `patk`, `matk`, `ratk` | Are these action, hit, damage, or tag queries, and what are their exact memberships? |
| `bomb` | Board object, placement, throw, or explosion? Use `bomboff`/`bombon`, `bomb-throw`, or `bomb-explode`. |
| `action` | Capability, declared turn action, or phase? |
| `action-resolves` | Contextual references break with multiple effects; name `bow-resolves`, etc. |
| `now` | Snapshot properties already mean now; event boundaries need explicit stages. |
| bare `this-turn`, `last-turn` | Use `during-this-turn`/`during-last-turn`; define player-relative boundaries. |
| `unless` | Likely sugar for `while !condition`, but Boolean precedence is not settled. |
| owner/control `none`, `both` | Do not confuse neutral ownership/control with the `none` quantifier. |
| `subj`/`obj` after movement | Decide bound unit identity versus original bound hex. |
| `all` over an empty domain | Decide classical vacuous truth versus “at least one and all.” |
| multiple effects | Decide left-to-right sequencing versus simultaneous stack entries. |
| history recording stage | Decide whether target, resolve, or after-resolve enters each interval. |

Until these rulings are made, authors should use explicit canonical events and
properties rather than aliases.
