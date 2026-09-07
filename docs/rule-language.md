# Normalized card-rule language

The normalized parser lives in `game/rule-parser.ts`; its canonical word
metadata lives in `game/rule-vocabulary.ts`. The grammar in this document is
the canonical contract. During migration, some parser and catalogue paths may
still accept the preceding `state while condition` form until they are moved to
the selector/`have` form below.

The implementation and catalogue rollout plan is tracked in
`docs/rule-engine-migration.md`.

## Semantic model

### Unified entries and selectors

Cards author actions, triggers, and continuous rules together in `rules`.
An entry without a trigger separator or `have`/`while` is a standalone action
or comma-separated action list. Legacy `actions` input remains accepted.
Compiled actions and triggers are separate execution indexes. Actions compile
to selectors: `bow(2,3)` selects within three hexes; `bow(2) o:opp 3-from self`
selects enemy-occupied hexes exactly three away. Occupancy, paths, and normal
action legality still apply. Geometry/presentation adapters derive numeric
bounds from selectors; legacy persisted rows can still contain `range`.

`A` omits the implicit standalone token cost; `T` omits deactivation. They
combine independently. `A.move o:opp 3-from self` deactivates its source and
must enter an enemy-occupied hex, starting Bash.

### Named values and complements

```text
start : up-player-counter(cherry, -2) you
start : up-unit-counter(cherry, 1) self
gore-to !hex-flag(gored,on) : up-actions(1) you & up-hex-flag(gored,on) self
end : up-hex-flag(gored,off) all _
```

`up-{hex|unit|player}-counter(name, delta)` adds a signed integer (default zero).
`up-{hex|unit|player}-flag(name, on|off)` assigns a Boolean (default off).
Names are lowercase identifiers with optional digits/hyphens. Counters and
flags have separate namespaces. Hex attachments have no ownership; unit
attachments follow stable unit IDs. Player attachments target exactly `you`
or `opp`, never positional hex queries. Assignment events retain the source
troop and typed recipient. Values persist through match and Playground saves.

Inspect values with selectors such as `hex-flag(gored,on)` or
`unit-counter(cherry,2)`, or guards such as `you player-counter(cherry,2)`.
`!` complements a selector against every playable board hex, including empty
hexes. Parenthesize compounds: `!(o:you adj self)`. Consecutive filters
intersect: `o:opp !hex-flag(gored,on)`. `all` applies to every selected target;
otherwise a multi-target action asks for one authoritative choice.

### Timing and continuous contributions

```text
move-from c:opp : up-actions(1) you at next-start
end : up-mod(1,1) at next-start until next-end
while wounded : up-mod(1,1)
while !active : o:you adj self have up-bow(1,1)
```

`at next-start`, `at next-end`, `at next-opponent-start`, and
`at next-opponent-end` schedule one application at the next matching phase.
Schedules stack, capture concrete recipients, survive source removal/reload,
and are removed before execution to prevent replay. Scheduled actions pay
their activity cost when executed. State contributions may also have a
lifetime: `until next-end` expires at the owner's first End after application.
Instant counter mutations have timing but no duration.

`while condition : contribution` maintains a state contribution, optionally
distributed through `have`. Enabling/recalculating it emits no grant event.
Triggered `up-mod` and other `up-*` state grants emit events with granting
troop as subject and recipient as object. Their reactions respect bundle
ordering. `up-actions` and named counter/flag mutations are events, not
maintained contributions; a continuous rule cannot mint spendable tokens.

### Attack families

`atk` matches `fire`, `cannon`, `gore-attack`, `bash`, and `bow`; `patk` matches
`gore-attack`, `bash`, and `bow`; `ratk` matches `fire` and `cannon`. These are
event patterns, not executable attacks, and retain the concrete event's
bindings. Bomb events match none. `gore-from`/`gore-to` inspect Gore movement.

A rule is either triggered or derived:

```text
trigger-rule = anchor [" if " boolean-condition] " : " triggered-effects
derived-rule = selector " have " attached-phrase
attached-phrase = state-contribution | derived-rule
```

The spaces around ` : ` are significant. Query fields may themselves contain
colons, such as `o:opp`, without becoming the rule separator.

An **anchor** is one concrete event pattern or phase. Event operands are already
singular; their selectors only test whether the concrete operands match. A
matching anchor binds its exact `subj` and `obj`. A guard after `if` does not
wake the rule; it is merely tested when the anchor matches. Quantifiers are not
legal in event anchors.

```text
end if self wounded : self mend(1,_) self
o:opp bow self if self wounded : self shield(1,_) self
```

A derived rule has no anchor and does not fire. Its selector returns zero or
more cards and `have` evaluates the attached phrase once for every result.
Inside the attached phrase, `self` is rebound to that selected card; `subj` and
`obj` are forbidden. When a card stops matching the selector, its derived
attachment disappears.

```text
o:you wounded have up-mod(1,0)
o:you bashing o:opp have up-mod(1,0)
```

`have` may be nested. Each nested `have` creates a new scope and rebinds `self`:

```text
o:you bashing o:opp have o:you adj self have up-mod(1,0)
```

This grants `+1` to every friendly unit adjacent to each friendly unit that is
bashing an opponent. If ownership is irrelevant, the inner selector may be
written `adj self`. An event is one-time and cannot be attached with `have`;
engine-owned observations such as `wounded` cannot be contributed.

## Costs, action tokens, and ordered bundles

```text
effect = [cost (" & " cost)* " :: "] consequence (" & " consequence)*
cost   = singular-reference " deactivate " singular-reference
       | [singular-reference] " up-actions(" negative-integer ") " player
player = you | opp
```

An explicit `::` payment replaces implicit costs. Printed active actions accept
a cost clause before their action; triggered rules accept a cost clause before
their consequence bundle. Costs have no lifetime, target choice, or `must`.

Bow, Fire, Cannon, Gore movement, Move, Fly, Shield, Mshield, Bomb Throw, Push,
Pull, Upgrade, and Deploy implicitly pay `self deactivate self`. Mend, Stun,
and Light also retain their activity cost. Tireless removes this implicit
deactivation. A standalone action additionally pays `self up-actions(-1) you`;
a triggered action does not spend its player's token unless explicitly required.
Repeated implicit deactivation of the same source within one bundle is paid once.

```text
bow(3,2)
// standalone expansion:
self deactivate self & self up-actions(-1) you :: self bow(3) !o:you 2-from self
```

`up-actions(N)` is a binary **verb**, not an `up-*` state contribution. Its
subject records the troop responsible; its object is exclusively `you` or
`opp`, relative to the rule owner. It accepts one signed integer and changes
that player's stored token balance once, never below zero. Players are distinct
event bindings with no board coordinate; player targets cannot be replaced by
hex queries, `_`, or `all`. Token changes can anchor ordinary/resolved triggers.

Every hero has the engine-supplied rule `start : self up-actions(1) you`.
It also applies before that hero deploys. Match creation dispatches the first
Start; older snapshots without balances receive the legacy one-token action
window when restored. Unused or additionally granted tokens remain stored.
After an action chain finishes, the action phase continues while its player has
tokens and advances to combat/End only at zero. Pass spends one token.

Undeployed units are active. Deploy deactivates its source while off board,
then puts the inactive unit on its destination. Reactivation during payment
is preserved; execution never reapplies the cost afterward.

The player chooses a legal target before payment. The engine validates the
complete payment and commits it without allowing triggers between its members.
An unpayable action cannot be confirmed. Preview/cancellation spends nothing.
If cost triggers invalidate an already-paid action, it fizzles without refund.

`&` groups ordered events: apply every member, then execute their captured
triggers in member order. Nested trigger consequences finish before the next
trigger. The cost bundle is a boundary before the action bundle:

```text
A & B :: C & D
A B -> A1 B1 -> C D -> C1 D1
```

Each trigger's bindings and guard are captured at its own event occurrence;
its execution waits for the bundle. Dashboard rows retain the ordered bundle
members. Pending choices preserve remaining consequences and deferred triggers
in serializable runtime work so save/load and reconnection retain the order.
Delayed attacks still create pending attacks; damage resolves in its later window.

## States and conditions

```text
selector             = reference | positional-selector | query-selector
boolean-condition    = "any " selector | "none " selector
                     | "all " query property [query | reference]
                     | snapshot-state | historical-condition
snapshot-state       = reference property [selector]
historical-condition = selector verb [selector] interval
state-contribution   = reference contributable-property
```

`observable` and `contributable` are word capabilities, not exclusive kinds:

- observable: a rule may ask whether the property is currently true;
- contributable: a rule may add the property/value to effective game state.

`wounded`, `deployed`, `bashing`, and pending-action properties are observable
but not contributable. Passives such as `titanium` are both. Numeric `up-*`
phrases are contributable; their exact values are intentionally not Boolean
queries.

Current effective state combines three sources:

```text
effective state = intrinsic engine state + stored grants + derived contributions
```

- intrinsic state is owned by the engine (`wounded`, `deployed`, `bashing`);
- stored state is created by an event and has a permanent-by-default lifetime;
- derived state is recalculated from a selector/`have` rule and cannot be consumed.

A historical condition is an observable query over recorded events, not a
contributed property:

```text
none o:both bash o:both during-this-turn
none o:opp fire self since-beginning
```

`none` means `not any`, not an empty entity set. Thus the first example is
`not exists subject, object: bash(subject, object)` in the current turn. It is
valid after `if`, but it cannot anchor a trigger or bind `subj`/`obj`.
The exact inclusive/exclusive boundaries of turn-history intervals remain an
evaluator decision and must be fixed before authoritative matching.

## Triggered consequences and lifetimes

```text
triggered-effects = triggered-effect (" & " triggered-effect)*
triggered-effect   = ["must "] action-consequence
                   | state-contribution [lifetime]
                   | selector " have " state-contribution [lifetime]
action-consequence = [reference] action [[target-policy] target-selector]
target-selector    = selector | "_"
target-policy      = "all "                     // default: choose one
lifetime          = " permanent"
                   | " until " event
                   | " removed-after " event
```

A trigger may cause a one-time event. Its subject defaults to `self`, and an
omitted target uses the action's own target rule:

```text
end : move(1)
end : bow(2,3)
```

The final printed action parameter is shorthand for the action's normal target
range. An explicit selector replaces that shorthand, so these are equivalent:

```text
bow(2,3)
self bow(2) !o:you 3-from self
```

Likewise, `move(1)` uses Move's default target selector and expands to
`self move !o:opp 1-from self`. Active card actions use the same function form,
for example `move(2), bow(3,4), shield(2,1)`.

Triggered bow, gore, bomb-throw, fire, cannon, fly, move, shield, mshield, pull,
push, and stun consequences are optional by default because they cost activity.
Tireless versions and all other free consequences (including revive and
bomb-defuse) are mandatory by default. Explicit rule costs make action
consequences optional even when tireless. Normal turn-action costs are unchanged.
The runtime and hover share `game/consequence-policy.ts`. Prefixing a
consequence with `must` removes the player's decline choice when at least one
legal target exists:

```text
end : move(1)       // may
end : must move(1)  // compulsory when possible
```

An action consequence may select several legal targets. Without a target
policy, it executes once: a single match is used directly and multiple matches
create a pending player choice. `all` expands the consequence into one action
occurrence per legal target:

```text
self fire(2,_) _             // choose one legal tile
self fire(2,_) o:opp         // choose one legal enemy target
self fire(2,_) all _         // fire once at every legal tile
self fire(2,_) all o:opp     // fire once at every legal enemy target
```

Here `_` means every otherwise legal target is eligible; unlike an event
pattern, the consequence must materialize a real coordinate before announcing
the action. `any` is not a target policy: the default already means choose one,
and `any` remains reserved for Boolean conditions. A pending choice pauses rule
execution before later `&` consequences.

`all` first enumerates and freezes the complete target-coordinate set, then
emits one singular action occurrence per target in deterministic order. It
never creates an event whose `obj` is a collection. A target that moves before
a delayed occurrence resolves therefore leaves that occurrence aimed at its
original coordinate. An empty choose-one selector skips the consequence; an
empty `all` selector is a valid no-op.

A trigger may instead create stored state. Its omitted lifetime defaults to
`permanent`:

```text
o:opp fire self : titanium until opponent-end
self deploy _ : up-mod(1,0) removed-after _ hit self
self deploy _ : steady
```

`until E` removes the state before `E` resolves, so it does not participate in
that event. `removed-after E` lets the state participate in `E` and removes it
afterward. For a `+1` physical modifier and a three-damage physical hit:

```text
until hit          -> modifier removed, 3 damage
removed-after hit  -> modifier applies, 2 damage, then it is removed
```

A selector may distribute triggered stored state with `have`. It applies to
every selected unit and rebinds `self` for both the state and its lifetime:

```text
end : o:you adj self have up-mod(1,0) removed-after _ hit self
```

No leading `all` is needed: `have` already distributes over the complete
selector result. Phase anchors bind neither `subj` nor `obj`, so using `obj` in
the preceding lifetime would be rejected.

Each `&`-separated consequence owns its lifetime. Shared lifetimes are not
accepted; bundle mutation/trigger ordering is defined above.

## Selectors, queries, and bindings

```text
selector            = reference | positional-selector | query-selector
event-selector      = selector | "_"
reference           = self | subj | obj
positional-selector = position reference
query-selector      = query [property [query | reference]]
                    | query position reference
position            = adj | N "-from"
                    | [N "-"] away-from | [N "-"] towards
                    | [N "-"] parallel-to
query                = [owner] [bomb] [region] [control] [side] [type]
owner     = o:you | o:opp | !o:you | !o:opp | o:none | o:both
bomb      = p:bomb-off | p:bomb-on | p:none | p:bomb
region    = r:str | r:int | r:front
control   = c:you | c:opp | c:none
side      = s:you | s:opp
type      = t:hero | t:troop | t:temple
```

Selectors denote sets of cards or hexes. A query selector chooses candidates
and may refine them with a property and its object:

```text
o:you
o:opp wounded
o:you bashing o:opp
```

A positional selector requires one statically singular reference on its right:

```text
adj self
2-from obj
o:you adj self
```

`adj o:you` and `o:you adj o:opp` are invalid because a positional reference
cannot be a query that might return multiple entities. The query-first spelling
`o:you adj self` means “friendly units adjacent to self”; Boolean `and` is not
used for selector intersection. Adjacent selector terms intersect implicitly,
so `!o:you 3-from self` needs neither `&` nor parentheses.

`_` is an unconstrained selector only when matching an already concrete event
operand:

```text
self bash _
_ bash self
```

The event still has one subject and object, and a match still binds their exact
values as `subj` and `obj`. `_` is forbidden as a `have` selector, Boolean
selector, or positional reference. In an action consequence it is instead a
real target selector, as described below.

At the outer rule level, `self` is the rule owner. Each `selector have phrase`
evaluates `phrase` once per selected card and lexically rebinds `self` to that
card. A terminal contributable property has that selected `self` as its implicit
recipient, so `o:you have up-move(1)` is canonical and the longer
`o:you have self up-move(1)` is equivalent. Printed derived rules are evaluated
only while their source card is deployed, making an outer `self deployed have`
scope redundant. `subj` and `obj` are forbidden inside a `have` phrase. Outside `have`,
they are ephemeral singular event bindings and are never stored as live
variables. Creating an action materializes its operands into immutable
origin/target coordinates. Resolving state materializes its recipient into a
stable unit ID.

This is the same boundary used by damage: a delayed attack keeps its target
hex, then applies damage to the unit occupying that hex when it resolves. Any
resulting wound is unit-owned and follows that unit afterward. Consequently a
unit may dodge a delayed action by leaving its fixed target, while an already
applied `up-mod` contribution follows the unit rather than its former hex.

Query fields are recognized by their prefixes and may appear in any order;
duplicates are rejected. Prefixes keep overloaded values distinct: Boolean
`none` tests an empty selector result, while `o:none`, `p:none`, and `c:none`
are ordinary query values. Aliases expand as follows:

```text
o:none = !o:you & !o:opp
o:both = o:you & o:opp       // currently a contested Bash hex
p:none = !p:bomb-off & !p:bomb-on
p:bomb = p:bomb-off | p:bomb-on
```

`any`, `none`, and `all` are Boolean operators, not parts of selectors. `any S`
tests whether selector `S` is non-empty; `none S` tests whether it is empty.
`all Q P` requires a non-empty base query `Q` and tests whether every candidate
satisfies `P`. Quantifiers are legal only where a Boolean condition is required.
Prefixed `:none` values remain ordinary query fields and do not negate anything.

Selector conditions are implemented in `if` guards and `while` conditions.
For example, `end if any p:bomb-off adj self : T.push(1) all p:bomb-off adj self`
checks for adjacent inert bombs when End fires. Conditions do not trigger rules
by themselves. `none p:bomb-off adj self` checks their absence; `all o:you active`
requires at least one friendly troop and every friendly troop to be active.
With a selector alone and no further property, `all S` means `S` is non-empty.
An empty base makes `any` and `all` false and `none` true. Conditions compose
with `!`, `&`, and `|`; a selector may be parenthesized after its quantifier.

Consequently, `any o:you bashing o:opp` is a Boolean condition, while
`o:you bashing o:opp` is a selector. `any o:you bash o:opp` is not an event
anchor: the valid singular event pattern is `o:you bash o:opp`.

Every position operates relative to its explicit singular reference. `self`,
`subj`, and `obj` are statically singular. `adj` aliases `1-from` and means
exact distance one. The older `rangeN-from` spelling remains accepted during
migration; the implicit `this` direction is no longer part of the canonical
selector grammar.

Position comparisons use the phrase subject at `S`, candidate `H`, and selected
reference `R`. A numeric prefix on a directional comparison additionally
requires `distance(H,S) = N`:

- `N-away-from R`: `distance(H,R) > distance(S,R)`;
- `N-towards R`: `distance(H,R) < distance(S,R)`;
- `N-parallel-to R`: `distance(H,R) = distance(S,R)`;
- `N-from R`: `distance(H,R) = N`.

Unnumbered `away-from`, `towards`, and `parallel-to` remain accepted and impose
no distance-from-subject constraint.

The older single-token compact descriptors remain accepted during migration,
but the prefixed field-query form is canonical.

## Events and action notation

```text
event      = [event-selector] verb [event-selector] | phase
action     = [qualifier "."]* name [parameters]
parameters = "(" parameter ("," parameter)* ")"
parameter  = signed integer | "_"
qualifier  = P | F | T
```

Appending `-resolved` to a concrete verb selects its successful post-mutation
notification (for example, `self bow-resolved o:opp`). The AST retains the
canonical verb and records `resolved` as an explicit event stage; a canceled
event never matches it.

An event occurrence has one concrete subject and at most one concrete object.
Its operand selectors are membership tests over those concrete operands; they
do not enumerate the board. A match binds singular `subj` and `obj`. In this
matching context, `_` accepts any concrete operand. `self` is the implicit
subject. `_` is also the canonical numeric-parameter wildcard; its grammatical
position distinguishes the two uses. The legacy
packed form remains accepted during migration:

```text
bow(1,_)    == bow1x
T.bomb(2,_) == T.bomb2x
```

Entity operands and user parameters are separate. A binary action has an
origin/subject and destination/object even when it has no numeric parameters.
`deploy`, `die`, and `activate` are binary location events: their subject is a
unit and their object is respectively its destination, last occupied, or
current hex. The subject and object therefore share a coordinate at the event
boundary but retain different entity types. `revive` remains unary: its subject
is the selected defeated unit and it has no location object.
An event pattern may omit the complete numeric vector to match any printed
values. If it supplies any numeric parameter, it must supply the action's full
vector, using `_` for an unconstrained position.

Movement endpoint suffixes select data from the same event:

```text
self move-from c:opp
self move-to c:you
```

The final event lifecycle will expose at least target and resolution boundaries.
`target` means authoritative target confirmation, `hit` means damage resolution
reached the target even for zero damage, and `wound` requires positive life
loss. Pending properties such as `is-firing` mean the interval after target and
before resolution. Instant actions expose the same logical pending interval even
when target and resolution occur in one authoritative transition:

```text
is-shielding       is-mshielding      is-moving
is-flying          is-gore-moving     is-pushing
is-pulling         is-mending         is-stunning
is-bomb-throwing   is-upgrading       is-bomb-defusing
is-lighting
```

All are observable, non-contributable binary states relating the acting subject
to its selected object. They exist while validating/announcing that pending
action, so a rule can derive an action update before its cost and mutation.

The general timing rule is “an event resolves before a trigger named by its
anchor fires.” Matching triggers are captured when `A` occurs, so a source that
leaves play during `A` can still trigger, but their consequences execute only
after `A` has been applied. `A-resolved` is a second, explicit notification
emitted after ordinary `A` triggers finish. Its own triggers follow the same
post-notification rule. Cleanup is ordered as follows:

```text
announce A -> capture A triggers -> apply A -> remove removed-after A state
           -> finish remaining bundle members -> resolve captured A triggers
           -> announce A-resolved -> resolve captured A-resolved triggers
```

Consequently, `removed-after A` state participates in `A` but is already absent
while `A` trigger consequences execute and from conditions checked by
`A-resolved` triggers. Canceled events emit no
`A-resolved` notification and do not consume `removed-after A` state.

### Unified update properties

Except for the player-resource verb `up-actions`, updates are state contributions. They occur
inside a derived `have` attachment, or after ` : ` with an explicit stored
lifetime:

```text
o:you wounded have up-mod(1,0)
end : self up-life(1,0) permanent
end : self up-fire(1,0,P) removed-after self fire o:opp
```

The canonical family is `up-mod(M,N)` for physical/magic modifiers,
`up-life(M,N)` for actual/starting life, and `up-ACTION` for action updates. If
action `A` has `N` numeric user parameters, `up-A` requires those `N` numeric
deltas and accepts one optional final `T`, `P`, or `F` entry:

```text
up-fire(1,0)
up-fire(1,0,P)
```

`up-fire(1,P)` is invalid because the qualifier cannot replace a numeric
parameter. An update changes effective state; it does not emit an `up` event,
make its source inactive, or bind `subj`/`obj`. Whether a particular action may
acquire each qualifier is evaluator validation rather than grammar ambiguity.

`bash` and `bomb-explode` are excluded from the `up-ACTION` family. They are
engine consequences, not turn-consuming actions. Bash does not itself
deactivate a troop and has no `T.bash`, `P.bash`, or `F.bash` form. Exceptional
Bash behavior is expressed through passives instead:

```text
steady   Bash uses piercing semantics
fast     Bash resolves immediately if either participant has Fast
```

Both are observable and contributable states, so they may be printed, stored
with a lifetime, or derived with `have`.

Bombs have an explicit authoritative lifecycle:

```text
bomb-off       inert bomb state
bomb-on        lit bomb state
bomb-throw     proper bomb-icon turn action
bomb-light     light an inert bomb and schedule its explosion
bomb-explode   detonation (legacy alias: bomb-explode-resolve)
bomb-defuse    instant action
```

`bomb-throw` is the normal action that consumes the troop's turn and makes it
inactive. Fire or another Bomb explosion may light a bomb; a trigger
may produce `bomb-light` or `bomb-defuse` after ` : `. In that triggered
context they are forced actions and do not deactivate the source. This is an
execution-context rule, not a `T` qualifier. A chosen `bomb-defuse` remains a
normal turn action.

The older descriptor types `bomboff` and `bombon` still select inert/lit bomb
hexes during migration. `bomb-off` and `bomb-on` are their state-predicate
counterparts; the evaluator will eventually provide one canonical query form.

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
| `bow` | 2 | physical |
| `fire` | 2 | red magic |
| `cannon` | 2 | black magic |
| `gore-attack` | 2 | physical |

### Instant action events

```text
shield mshield move fly gore-move push pull mend stun bomb-throw
upgrade bomb-defuse light
```

All currently have subject and object operands. “Instant” still has ordered
target and resolve boundaries; they may occur in the same authoritative turn
transition.

### Result and state-change events

| Verb | Meaning |
|---|---|
| `bash` | delayed physical combat consequence created by another action |
| `bomb-explode` | delayed black-magic consequence caused by Fire, another explosion, or a trigger |
| `target` | authoritative legal target confirmed |
| `hit` | damage resolution reached the target |
| `wound` | target lost positive life |
| `die` | unit transitions to defeated; object is its last occupied hex |
| `deploy` | unit transitions to deployed; object is its destination hex |
| `revive` | unary transition of the selected defeated unit |
| `activate` | unit transitions to active; object is its current hex |
| `deactivate` | unit transitions to inactive; costs use the unit itself as object, including off-board units |
| `up-actions(N)` | source troop changes player `you` or `opp` action tokens by N |

### Snapshot properties

| Property | Observable | Contributable | Arity/notes |
|---|:---:|:---:|---|
| `wounded`, `deployed`, `defeated`, `undeployed`, `active` | yes | no | unary engine state |
| `bomb-off`, `bomb-on` | yes | no | inert/lit authoritative bomb state |
| `bashing`, `bashed-by` | yes | no | binary relationship |
| `is-firing`, `is-bowing`, `is-gore-attacking`, `is-cannoning`, `is-bomb-exploding` | yes | no | delayed pending relationship |
| `is-shielding`, `is-mshielding`, `is-moving`, `is-flying`, `is-gore-moving`, `is-pushing`, `is-pulling`, `is-mending`, `is-stunning`, `is-bomb-throwing`, `is-upgrading`, `is-bomb-defusing`, `is-lighting` | yes | no | instant pending relationship |
| `first-strike`, `steady`, `fast`, `titanium`, `obsidian` | yes | yes | unary passive |
| `up-mod(M,N)` | no | yes | physical/magic modifier contribution |
| `up-life(M,N)` | no | yes | actual/starting-life contribution |
| `up-ACTION(...[,T/P/F])` | no | yes | action-sized numeric update plus optional qualifier |
| `action-reachable` | yes | no | unary legal-target existence |
| `action-reaches` | yes | no | binary legal-target relation |

## Reserved ambiguities

These words are deliberately not given a guessed meaning:

| Word | Required ruling |
|---|---|
| `attack` | Which of Bash, Bow, Gore, Fire, Cannon, and Bomb count? |
| `patk`, `matk`, `ratk` | Are these action, hit, damage, or tag queries, and what are their exact memberships? |
| `bomb` | Board object, state, throw, defuse, or explosion? Use `bomb-off`/`bomb-on`, `bomb-throw`, `bomb-defuse`, or `bomb-explode`. |
| `action` | Capability, declared turn action, or phase? |
| `action-resolves` | Contextual references break with multiple effects; name `bow-resolves`, etc. |
| `now` | Snapshot properties already mean now; event boundaries need explicit stages. |
| bare `this-turn`, `last-turn` | Use `during-this-turn`/`during-last-turn`; define player-relative boundaries. |
| `unless` | Possible sugar for a negated selector/guard; its exact scope is not settled. |
| owner/control `none`, `both` | Do not confuse neutral ownership/control with the `none` quantifier. |
| `subj`/`obj` after movement | Resolved: bindings are phrase-local; actions store coordinates and state stores concrete unit IDs. |
| `all` over an empty domain | Decide classical vacuous truth versus “at least one and all.” |
| multiple effects | Resolved: ordered bundle mutations precede all captured member triggers; `::` separates payment and effect bundles. |
| history recording stage | Decide whether target, resolve, or after-resolve enters each interval. |

Until these rulings are made, authors should use explicit canonical events and
properties rather than aliases.
