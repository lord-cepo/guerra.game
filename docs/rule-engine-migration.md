# Rule-engine migration roadmap

This document is the canonical plan for replacing the legacy card DSL and
client-side rule projections with the normalized rule language described in
`docs/rule-language.md`.

The migration is intentionally staged. The current game must remain playable
until normalized cards reach behavioral parity with the legacy catalogue.

## Goals

- Keep one authoritative rulebook and one semantic evaluator on the server.
- Express active actions, triggers, guards, continuous contributions, stored
  lifetimes, historical conditions, and action updates through the normalized
  language.
- Make event timing explicit and deterministic, including proposal, pending,
  announcement, resolution, cleanup, and resolved notification stages.
- Make the server authoritative for activity, pending actions, legal actions,
  legal targets, derived states, stored states, semantic previews, and results.
- Remove card-specific and rule-specific calculations from the client.
- Keep pointer hover, focus, interpolation, artwork, and animation rendering
  immediate and local.
- Preserve existing cards and saved matches throughout the migration.
- Keep the rules layer deterministic, UI-independent, and exhaustively testable.

## Target architecture

```text
Normalized catalogue source
          │ parse once at startup
          ▼
Shared immutable rule AST and vocabulary
          │
          ▼
Authoritative server evaluator
  ├─ legal units/actions/targets
  ├─ semantic preview on cloned state
  ├─ confirmed transition
  ├─ effective state and presentation tags
  └─ public event/presentation sequence
          │ HTTP + WebSocket
          ▼
Presentation-only client
  ├─ renders authoritative state and tags
  ├─ locally hovers server-approved targets
  ├─ requests semantic previews after selection
  └─ animates server-provided public events
```

The client may calculate geometry and interpolate visuals, but it must not
decide legality, damage, control, modifiers, passives, trigger matching,
continuous effects, or event ordering.

## Non-negotiable invariants

- A preview never mutates or persists the live match.
- A preview and confirmation use the same evaluator and rules version.
- Confirmation sends intent, never client-computed results.
- Every request is tied to a match revision; stale responses are discarded.
- Card rules are parsed once and shared, not copied into every match/preview.
- Confirmed public state comes from the server.
- Hovering an already supplied legal target never requires a round trip.
- Hidden or future private state is removed from preview responses.
- Canceled events emit no resolved notification and do not consume
  `removed-after` state.
- Derived `selector have phrase` contributions are never stored or consumed.
  Each `have` enumerates its selector, rebinds `self` to one selected card, and
  may nest another `have`; `subj` and `obj` are forbidden in that lexical scope.

## Phase 0 — finish the language contract

- [x] Parse explicit `A-resolved` events and movement endpoint variants.
- [x] Parse Boolean observable conditions with grouping and negation.
- [x] Encode multiple consequences as deterministic left-to-right execution.
- [ ] Support grouped consequences that share one lifetime, if required.
- [x] Validate numeric parameter arity for every action.
- [x] Validate which actions may acquire `T`, `P`, and `F`.
- [x] Define phrase-local event bindings: action operands materialize into fixed
      coordinates, while resolved state mutations/contributions attach to the
      selected unit ID. No live `subj`/`obj` binding survives phrase evaluation.
- [x] Resolve Fast Bash in the creating action's combat window.
- [x] Apply starting-life changes before clamping actual life.
- [x] Record explicit target/resolved stages and evaluate turn intervals against them.
- [ ] Resolve or deliberately defer every entry in the reserved-ambiguities
      table in `docs/rule-language.md`.
- [ ] Add parser fixtures for every accepted and rejected grammar form.

Exit criterion: every normalized catalogue rule can be represented without an
undocumented parser or evaluator interpretation.

## Phase 1 — normalized evaluator primitives

- [x] Add a pure query evaluator under `game/`.
- [x] Resolve `self`, `subj`, and `obj` from an explicit evaluation context.
- [x] Evaluate `o:`, `p:`, `r:`, `c:`, `s:`, and `t:` field queries.
- [x] Implement `any`, snapshot `all`, phrase-leading `none`, and effect `all`.
- [x] Implement `this`, `N-from`, `N-away-from`, `N-towards`, and
      `N-parallel-to`.
- [x] Enforce runtime singularity for directed `any` references.
- [x] Evaluate observable intrinsic and pending-action states.
- [x] Evaluate historical conditions against normalized event records.
- [x] Return structured failures rather than silently selecting a different
      meaning when a query is invalid or nonsingular.

Exit criterion: evaluator tests cover every query and observable-condition
form without invoking the server or browser.

## Phase 2 — effective state

- [x] Introduce generic stored contribution instances with source rule, source
      unit, bound subject, property, parameters, creation event, and lifetime.
- [x] Implement `permanent`, `until E`, and `removed-after E` cleanup.
- [x] Implement derived `selector have phrase` evaluation, including nested
      lexical `self` scopes.
- [x] Combine intrinsic, printed, stored, and derived sources into effective
      state.
- [ ] Replace special-case modifier and ability-aura evaluation with the generic
      effective-state evaluator.
- [x] Implement `up-mod`, `up-life`, and `up-ACTION` aggregation.
- [x] Implement effective passives including Titanium, Obsidian, Steady, Fast,
      and First Strike.
- [ ] Add dependency indexes so one state change does not rescan every unrelated
      rule and board hex.

Exit criterion: engine modifier, passive, life, and action-value tests pass
through the generic evaluator with no client involvement.

## Phase 3 — authoritative event lifecycle

- [x] Introduce normalized event records with stable IDs, stage, subject/object
      bindings, origin/destination, controller, parameters, qualifiers, turn,
      and success/cancellation status.
- [ ] Implement the lifecycle:

  ```text
  propose
  -> expose is-A-ing
  -> derive action state
  -> validate
  -> commit action cost
  -> announce A
  -> capture matching A triggers
  -> apply A
  -> remove removed-after A state
  -> resolve captured A triggers
  -> announce A-resolved
  -> capture and resolve A-resolved triggers
  ```

- [ ] Ensure Tireless is known before action-cost commitment.
- [ ] Define normal versus forced triggered-action deactivation.
- [ ] Cancel an announced event when trigger resolution invalidates it.
- [ ] Add history only at the chosen normalized event stages.
- [ ] Preserve LIFO ordering, simultaneous-trigger ordering, and optional-choice
      behavior.
- [ ] Migrate Bash and Bomb resolution into this lifecycle.

Exit criterion: every action and engine consequence passes lifecycle ordering,
cancellation, inactivity, and history tests.

## Phase 4 — generic consequence execution

- [x] Execute normalized one-time event consequences.
- [x] Create stored state from triggered state consequences.
- [x] Apply derived state without creating stored instances.
- [x] Execute effect `all` deterministically.
- [ ] Define automatic, optional, and forced target selection.
- [x] Stop execution at player-choice boundaries and expose resumable pending
      choices.
- [ ] Revalidate targets immediately before applying each consequence.
- [x] Return a public presentation-event sequence alongside the resulting state.

Exit criterion: no catalogue trigger needs a card-ID-specific engine handler.

## Phase 5 — server-owned interaction and previews

- [ ] Make the server return authoritative active/inactive, pending, selected,
      legal-action, and legal-target presentation data.
- [x] Add a semantic preview request containing match revision and action intent.
- [x] Clone only mutable match state; share catalogue AST and static geometry.
- [x] Run previews through the same evaluator as confirmation.
- [x] Disable persistence, broadcast, revision increments, timers, and permanent
      diagnostics while in preview mode.
- [ ] Stop previews at optional-choice boundaries and return legal branches.
- [ ] Sanitize projected state and events before sending them to either player.
- [x] Discard or cancel superseded preview requests.
- [ ] Initially confirm by reevaluating intent; add revision/action/rules-version
      preview caching only after profiling.
- [ ] Return projected deltas when full projected snapshots become materially
      expensive.

Exit criterion: selected actions receive correct server previews and confirmed
results without any semantic client calculation.

## Phase 6 — presentation-only client

- [ ] Remove continuous-effect evaluation from
      `client/board-combat-projection.ts`.
- [x] Remove ability-aura reconstruction from
      `client/match-session-controller.ts`.
- [ ] Remove card-ID-specific preview modifier corrections.
- [x] Render server-provided effective values and modifier breakdowns.
- [ ] Render server-provided active, inactive, pending, and legal-target tags.
- [ ] Keep local hover styling over server-approved targets.
- [x] Render projected server state after a deliberate target selection.
- [ ] Animate the server-provided public event sequence rather than inferring
      semantic events from before/after snapshots where possible.
- [x] Keep reconciliation: confirmed state always replaces a preview.

Exit criterion: searching client sources finds no implementation of a card
condition, combat rule, control rule, action cost, or trigger rule.

## Phase 7 — catalogue migration

- [x] Add normalized rules beside legacy definitions during transition.
- [x] Parse every normalized card at server startup with card-ID diagnostics.
- [x] Build behavioral parity fixtures for normalized outcomes.
- [x] Migrate cards in small behavioral groups: static continuous effects,
      phase triggers, action triggers, optional choices, damage resolution,
      Bash, Bomb, and historical rules.
- [x] Generate catalogue descriptions from normalized rule metadata.
- [x] Update deck-builder action/passive search to use normalized metadata.
- [x] Version persisted matches so pre-migration saves remain loadable or fail
      with an explicit migration message.
- [x] Remove legacy `triggers`, `continuous`, and `continuousEffects` after
      all catalogue and engine parity tests pass.
- [x] Remove legacy event projections from protocol/client types.

Exit criterion: the catalogue has one source language and the legacy parser is
unused and removable.

## Legacy-removal completion

- [x] All catalogue trigger and continuous definitions use normalized `rules`.
- [x] The authoritative lifecycle covers action announcement/resolution,
      phases, death, damage, Bash, Bomb, stored state, and pending choices.
- [x] Choose-one, zero-target, `all` fan-out, and fixed-target behavior are
      implemented by normalized consequence materialization.
- [x] Engine and client reads of legacy trigger/continuous fields are removed.
- [x] The client consumes server effective values and normalized presentation
      events rather than evaluating card rules.
- [x] Older persisted snapshots are upgraded to normalized `rulesVersion: 3`.
- [x] Catalogue, lifecycle, state, protocol, and integration tests pass without
      the legacy parser, dispatcher, fields, or protocol projections.

Current audit: the 70-card catalogue has 37 normalized rules and exposes zero
legacy trigger or continuous-effect definitions.

## Verification matrix

- [x] Snapshot queries and directions.
- [x] Historical conditions and turn boundaries.
- [x] Stored versus derived contributions.
- [x] `until` versus `removed-after` ordering.
- [x] Announced, canceled, and resolved events.
- [x] Tireless calculation before deactivation.
- [x] Triggered reactivation after action-cost commitment.
- [x] Fast Bash and Steady Bash.
- [x] Bomb off/on, throw, defuse, explosion, and chained explosion.
- [x] Optional, forced, skipped, and targetless triggered actions.
- [x] Multiple simultaneous triggers and LIFO resolution.
- [x] Reconnect while a preview or pending choice exists.
- [x] Both player projections and hidden-data sanitization.
- [x] Playground save/load/undo across stored contributions and event history.
- [x] Browser console remains free of runtime errors.
- [x] `npm run check`, `npm run build`, `npm test`, and `git diff --check` pass.

## Performance and capacity goals

These are initial budgets to verify with instrumentation, not guaranteed limits:

- Ordinary semantic preview: target 1–5 ms server CPU.
- Complex trigger-chain preview: target below 20 ms at p95.
- Mutable authoritative match state: target below 1 MB excluding diagnostics.
- Temporary preview allocation: target below 1 MB.
- Preview response: target below 20 KB after delta optimization.
- No unbounded per-match event, preview, or diagnostic growth.

Add metrics for preview duration, evaluator passes, rules inspected, clone size,
response size, cancellation count, and heap retained per match before optimizing.

The existing 100 in-memory diagnostic snapshots can dominate per-game memory.
Before production scaling, replace them with bounded event deltas, external
storage, sampling, or a production-disabled diagnostic mode.

## Rollout and rollback

- Record the rule-engine version in persisted match state and preview responses.
- Upgrade restored older snapshots to the current normalized state version.
- Do not branch semantic behavior in the client.
