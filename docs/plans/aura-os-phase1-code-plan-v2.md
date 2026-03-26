# Aura OS — Phase 1 Code Plan
**Contract Runtime Core**
version: 2.5 | language: JavaScript (JSDoc + handwritten .d.ts) | status: implementation-ready
date: March 26, 2026

---

## Stack Decisions

| Concern | Choice | Reason |
|---|---|---|
| Language | JavaScript with JSDoc annotations | No compile step in dev loop. Editor intelligence via JSDoc. |
| Types | Handwritten `.d.ts` files + JSDoc `@import` | Type shapes live in `.d.ts` files. `.js` files reference them via JSDoc `@import`. No `@typedef` in `.js` files. |
| Module format | ESM (`import`/`export`) | `"type": "module"` in package.json. Node 24+ native. No CJS shims. |
| SQLite driver | `node:sqlite` (Node.js 24 built-in) | Native synchronous SQLite. Zero external dependency. The `ContractStorage` interface remains async (`Promise`) — the implementation resolves immediately. Postgres swap requires only a new implementation, not an interface change. |
| Test runner | Vitest | Native ESM support. Fast. `node:test` lacks the assertion richness needed for the contract lifecycle tests. |
| Linter | ESLint 9 (flat config) | 4-space indent, 180-char max line, single quotes. Enforced in CI alongside typecheck. No Prettier — ESLint owns all style rules. |
| Type checking | `tsc --noEmit --checkJs` | Full type checking of JS files via JSDoc without emitting. Runs in CI alongside tests. |

---

## What Phase 1 Delivers

A pure contract runtime. No UI. No agent integration. No OpenClaw imports anywhere.

By the end of Phase 1, the following is true and proven by tests:

- Any caller can create, transition, and complete a contract.
- Invalid transitions throw typed errors.
- Deferred surfacing (`surface_after`) holds contracts until the right moment.
- Clarification round-trips (question → answer → surface update) work end to end.
- Resume tokens are single-use and replay-resistant.
- TTL expiry moves contracts to `failed` automatically.
- Resolver timeout returns contracts from `resolver_active` to `waiting_approval`.
- Concurrent writes are serialized by SQLite WAL — verified by test.
- `.signal` fires after every commit, never before — verified by test.
- Parent/child contract linking works: `spawnSubtask()` links child to parent and transitions parent `executing → active`.
- ConnectorState CRUD round-trips correctly through `contracts.db`.
- Both use-case contracts (artist reseller `offer-received`, non-profit `grant-report-draft`) traverse all states in dedicated end-to-end tests.

Phase 2 (OpenClaw plugin) starts only when every test in this suite is green.

---

## Repository Layout

```
aura-pulse/
  packages/
    contract-runtime/               ← Phase 1 lives entirely here
      src/
        types/
          contract-status.js        ← ContractStatus values + VALID_TRANSITIONS map (runtime)
          contract-status.d.ts      ← ContractStatusValue type + module declarations
          base-contract.d.ts        ← BaseContract interface + all sub-types
          participant.js            ← ParticipantRole values (runtime)
          participant.d.ts          ← ParticipantRef interface + ParticipantRoleValue type
          surface-action.d.ts       ← SurfaceAction interface
          clarification.d.ts        ← ClarificationEntry interface
          autonomous-log.d.ts       ← AutonomousLogEntry interface
          connector-state.d.ts      ← ConnectorState interface
          errors.js                 ← Typed error classes (runtime)
        storage/
          interface.js              ← ContractStorage abstract class
          interface.d.ts            ← ContractFilter, LogFilter, ContractLogEntry types
          sqlite-storage.js         ← SQLiteContractStorage implementation
          migrations/
            001-initial-schema.sql  ← All four tables + indexes
        runtime/
          contract-runtime.js       ← ContractRuntime class — the main entry point
          contract-runtime.d.ts     ← ContractRuntimeConfig type
          state-machine.js          ← Transition enforcement, pure functions
          resume-token.js           ← Token generation and single-use validation
          resume-token.d.ts         ← ResumeToken type
          ttl-manager.js            ← TTL + resolver timeout background checker
          ttl-manager.d.ts          ← TtlManagerConfig type
          type-registry.js          ← TypeRegistry: register + validate domain types
          type-registry.d.ts        ← ContractTypeDefinition type
          completion-notifier.js    ← NoOpCompletionNotifier class
          completion-notifier.d.ts  ← CompletionNotifier interface
        domain-types/
          offer-received.js         ← Artist reseller use case type definition
          offer-received.d.ts       ← OfferReceivedContext type
          grant-report-draft.js     ← Non-profit use case type definition
          grant-report-draft.d.ts   ← GrantReportDraftContext type
        index.js                    ← Public API re-exports (runtime values)
        index.d.ts                  ← Public API type re-exports (for Phase 2 consumers)
      tests/
        unit/
          state-machine.test.js
          resume-token.test.js
          type-registry.test.js
        integration/
          transitions.test.js
          deferred-surfacing.test.js
          clarification.test.js
          ttl-expiry.test.js
          resolver-timeout.test.js
          concurrent-writes.test.js
          signal-timing.test.js
          connector-state.test.js     ← ConnectorState CRUD round-trip
          hierarchy.test.js           ← Parent/child linking + spawnSubtask
          offer-received.test.js      ← Artist reseller end-to-end
          grant-report-draft.test.js  ← Non-profit end-to-end
        helpers/
          fixtures.js                 ← Contract factory helpers shared across tests
          temp-db.js                  ← Temp SQLite setup/teardown for integration tests
      package.json
      jsconfig.json                   ← JS type checking config (points tsc at JS files)
      eslint.config.js                ← ESLint flat config (indent 4, max-len 180, single quotes)
```

Phase 2 adds `packages/openclaw-plugin/` alongside this. The runtime package has
zero knowledge of it. Zero changes to `packages/contract-runtime/` are required
when Phase 2 begins — the plugin imports it as a workspace dependency.

---

## TypeScript + JSDoc Setup

### `jsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "checkJs": true,
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "allowJs": true,
    "maxNodeModuleJsDepth": 1
  },
  "include": ["src/**"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are
intentionally strict. They catch the class of bug where an optional
field is accessed as if always present — exactly the failure mode
that produces subtle state machine errors at runtime.

`include` is `src/**` (not `src/**/*.js`) so tsc picks up both the
`.js` files it checks and the `.d.ts` files it uses for type resolution.

### Type checking in CI

```json
// package.json scripts
"typecheck": "tsc -p jsconfig.json --noEmit"
```

`typecheck` runs in CI alongside tests. There is no `types:emit` step
because `.d.ts` files are handwritten, not generated.

---

### `eslint.config.js`

ESLint 9 flat config. Covers `src/` and `tests/`. No Prettier — ESLint
owns all style rules directly.

```js
// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'indent':      ['error', 4],
            'max-len':     ['error', { code: 180, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
            'quotes':      ['error', 'single', { avoidEscape: true }],
            'semi':        ['error', 'never'],
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        },
    },
    {
        ignores: ['node_modules/**', 'dist/**'],
    },
];
```

**Rule rationale:**
- `indent: 4` — 4 spaces, no tabs.
- `max-len: 180` — generous limit; SQL strings, JSDoc lines, and long method chains
  fit without forced wrapping. `ignoreStrings` and `ignoreTemplateLiterals` prevent
  false positives on SQL migration literals.
- `quotes: 'single'` — `avoidEscape: true` allows double quotes inside string
  literals that themselves contain a single quote (e.g. SQL `WHERE name = \'Levi\'`).
- `semi: never` — no semicolons. ASI is reliable for this codebase's patterns.
- `no-unused-vars` — underscore-prefixed params (e.g. `_contract` in `NoOpCompletionNotifier`)
  are intentionally ignored.

### JSDoc annotation pattern

Every function, class, and module export in this codebase is annotated.
The pattern to follow throughout:

```js
// src/runtime/example.js

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ContractStatusValue } from '../types/contract-status.js'
 */

/**
 * @param {string} contractId
 * @param {ContractStatusValue} from
 * @param {ContractStatusValue} to
 * @returns {void}
 * @throws {InvalidTransitionError}
 */
export function assertValidTransition(contractId, from, to) { ... }
```

Use `@import` (TypeScript 5.5+, supported in JSDoc via tsc) for
type-only imports. This keeps the runtime import graph clean — type
references don't create JS module dependencies.

The `@import` path always uses the `.js` extension even when the backing
file is a `.d.ts`. `moduleResolution: NodeNext` resolves this correctly:
it looks for `foo.js` first, then falls back to `foo.d.ts`.

### Type definition files (`.d.ts`)

Types are defined in handwritten `.d.ts` files using TypeScript `interface`
and `type` syntax. No `@typedef` appears in any `.js` file.

- **Pure-type files** have no corresponding `.js` — e.g. `base-contract.d.ts`.
- **Mixed files** keep runtime values in `.js` and declare the module's types
  in a companion `.d.ts` — e.g. `contract-status.js` + `contract-status.d.ts`.

```ts
// src/types/base-contract.d.ts

import type { ContractStatusValue } from './contract-status.js';
import type { ParticipantRef } from './participant.js';
import type { SurfaceAction } from './surface-action.js';
import type { ClarificationEntry } from './clarification.js';

export interface SurfaceRecommendation {
  action: string;
  value?: unknown;
  reasoning: string;
}

export interface ContractSurface {
  voice_line: string;
  summary: string;
  recommendation: SurfaceRecommendation;
  actions: SurfaceAction[];
  components?: ComponentRef[];
  version: number;
}

// ... rest of BaseContract interface
```

---

## Module-by-Module Specification

---

### `src/types/contract-status.js`

The canonical state list and the valid transition table.
Pure data — no I/O, no async.

```js
// src/types/contract-status.js

/**
 * All valid contract statuses.
 * @readonly
 * @enum {string}
 */
export const ContractStatus = /** @type {const} */ ({
  CREATED:          'created',
  ACTIVE:           'active',
  WAITING_APPROVAL: 'waiting_approval',
  RESOLVER_ACTIVE:  'resolver_active',
  CLARIFYING:       'clarifying',
  EXECUTING:        'executing',
  COMPLETE:         'complete',
  FAILED:           'failed',
});

/**
 * Valid transitions. Key = from, value = array of allowed to-states.
 * The state machine checks this table and nothing else.
 *
 * @type {Record<import('./contract-status.js').ContractStatusValue, import('./contract-status.js').ContractStatusValue[]>}
 */
export const VALID_TRANSITIONS = {
  created:          ['active'],
  active:           ['waiting_approval', 'complete', 'failed'],
  waiting_approval: ['resolver_active', 'failed'],
  resolver_active:  ['clarifying', 'executing', 'waiting_approval'],
  clarifying:       ['resolver_active'],
  executing:        ['active', 'complete', 'failed'],
  complete:         [],          // terminal
  failed:           ['active'],  // retry: human instructs retry
};

/**
 * Terminal statuses — no further transitions permitted after these.
 * Only `complete` is truly terminal. `failed` is recoverable: a human
 * can instruct retry, transitioning failed → active. The audit trail
 * and clarification history are preserved across the retry.
 * @type {import('./contract-status.js').ContractStatusValue[]}
 */
export const TERMINAL_STATUSES = ['complete'];
```

The `ContractStatusValue` derived type lives in the companion `.d.ts`:

```ts
// src/types/contract-status.d.ts

export declare const ContractStatus: {
  readonly CREATED:          'created';
  readonly ACTIVE:           'active';
  readonly WAITING_APPROVAL: 'waiting_approval';
  readonly RESOLVER_ACTIVE:  'resolver_active';
  readonly CLARIFYING:       'clarifying';
  readonly EXECUTING:        'executing';
  readonly COMPLETE:         'complete';
  readonly FAILED:           'failed';
};

export type ContractStatusValue = typeof ContractStatus[keyof typeof ContractStatus];

export declare const VALID_TRANSITIONS: Record<ContractStatusValue, ContractStatusValue[]>;
export declare const TERMINAL_STATUSES: ContractStatusValue[];
```

---

### `src/types/base-contract.d.ts`

Pure type declaration file. No runtime code. Defines the full contract shape
and all sub-types. Matches plan v0.5 schema exactly.

```ts
// src/types/base-contract.d.ts

import type { ContractStatusValue } from './contract-status.js';
import type { ParticipantRef } from './participant.js';
import type { SurfaceAction } from './surface-action.js';
import type { ClarificationEntry } from './clarification.js';

export interface ComponentRef {
  tool: string;
  data: Record<string, unknown>;
  returns: 'a2ui';
}

export interface SurfaceRecommendation {
  action: string;
  value?: unknown;
  reasoning: string;
}

export interface ContractSurface {
  voice_line: string;        // Spoken reasoning (human contracts only)
  summary: string;
  recommendation: SurfaceRecommendation;
  actions: SurfaceAction[];
  components?: ComponentRef[];
  version: number;           // Incremented on each surface update
}

export interface ContractResume {
  action: string;
  value?: unknown;
  timestamp: string;         // ISO-8601
  resolver_id: string;
  artifacts?: Record<string, unknown>;
}

export interface ContractCompletionSurface {
  voice_line: string;
  summary: string;
}

export interface ContractResult {
  success: boolean;
  summary: string;
  artifacts?: Record<string, unknown>;
}

export interface ContractIntent {
  goal: string;
  trigger: string;
  context: Record<string, unknown>;
}

export interface ContractParticipants {
  writer: ParticipantRef;
  executor?: ParticipantRef;
  resolver: ParticipantRef;
}

/** The base contract. All domain types extend this via intent.context. */
export interface BaseContract {
  id: string;                            // Unique deterministic slug
  version: string;                       // Schema version, always "1.0"
  type: string;                          // Registered domain type
  status: ContractStatusValue;
  created_at: string;                    // ISO-8601
  updated_at: string;                    // ISO-8601
  expires_at?: string;                   // TTL — begins at waiting_approval
  surface_after?: string;               // Defer presentation until this time
  participants: ContractParticipants;
  intent: ContractIntent;
  surface?: ContractSurface;
  clarifications?: ClarificationEntry[];
  resume?: ContractResume;
  completion_surface?: ContractCompletionSurface;
  result?: ContractResult;
  parent_id?: string;
  child_ids?: string[];
  recovery_of?: string;                  // ID of the contract this recovers
}
```

---

### `src/types/errors.js`

Typed error classes. Tests `instanceof`-check these — no string matching.

```js
// src/types/errors.js

export class AuraRuntimeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AuraRuntimeError';
  }
}

export class InvalidTransitionError extends AuraRuntimeError {
  /**
   * @param {string} contractId
   * @param {string} from
   * @param {string} to
   */
  constructor(contractId, from, to) {
    super(`Invalid transition: ${from} → ${to} on contract ${contractId}`);
    this.name = 'InvalidTransitionError';
    /** @type {string} */ this.contractId = contractId;
    /** @type {string} */ this.from = from;
    /** @type {string} */ this.to = to;
  }
}

export class TerminalStateError extends AuraRuntimeError {
  /**
   * @param {string} contractId
   * @param {string} status
   */
  constructor(contractId, status) {
    super(`Contract ${contractId} is terminal (${status}) — no further transitions`);
    this.name = 'TerminalStateError';
    /** @type {string} */ this.contractId = contractId;
    /** @type {string} */ this.status = status;
  }
}

export class UnauthorizedRoleError extends AuraRuntimeError {
  /**
   * @param {string} participantId
   * @param {string} role
   * @param {string} operation
   */
  constructor(participantId, role, operation) {
    super(`${participantId} (role: ${role}) is not authorized to: ${operation}`);
    this.name = 'UnauthorizedRoleError';
    /** @type {string} */ this.participantId = participantId;
    /** @type {string} */ this.role = role;
    /** @type {string} */ this.operation = operation;
  }
}

export class InvalidResumeTokenError extends AuraRuntimeError {
  /** @param {string} contractId */
  constructor(contractId) {
    super(`Invalid or already-used resume token for contract ${contractId}`);
    this.name = 'InvalidResumeTokenError';
    /** @type {string} */ this.contractId = contractId;
  }
}

export class UnknownContractTypeError extends AuraRuntimeError {
  /** @param {string} type */
  constructor(type) {
    super(`Unknown contract type: "${type}". Register it with TypeRegistry first.`);
    this.name = 'UnknownContractTypeError';
    /** @type {string} */ this.type = type;
  }
}

export class ContractValidationError extends AuraRuntimeError {
  /**
   * @param {string} type
   * @param {string[]} details
   */
  constructor(type, details) {
    super(`Validation failed for type "${type}": ${details.join('; ')}`);
    this.name = 'ContractValidationError';
    /** @type {string} */ this.type = type;
    /** @type {string[]} */ this.details = details;
  }
}

export class ContractNotFoundError extends AuraRuntimeError {
  /** @param {string} contractId */
  constructor(contractId) {
    super(`Contract not found: ${contractId}`);
    this.name = 'ContractNotFoundError';
    /** @type {string} */ this.contractId = contractId;
  }
}
```

---

### `src/types/participant.js` + `participant.d.ts`

Runtime values stay in `.js`. Types live in the companion `.d.ts`.

```js
// src/types/participant.js

/**
 * @readonly
 * @enum {string}
 */
export const ParticipantRole = /** @type {const} */ ({
  WRITER:   'writer',
  EXECUTOR: 'executor',
  RESOLVER: 'resolver',
  OBSERVER: 'observer',
});
```

```ts
// src/types/participant.d.ts

export declare const ParticipantRole: {
  readonly WRITER:   'writer';
  readonly EXECUTOR: 'executor';
  readonly RESOLVER: 'resolver';
  readonly OBSERVER: 'observer';
};

export type ParticipantRoleValue = typeof ParticipantRole[keyof typeof ParticipantRole];

export interface ParticipantRef {
  id: string;
  type: 'agent' | 'human' | 'system';
  package?: string;
}
```

---

### `src/types/surface-action.d.ts`

```ts
// src/types/surface-action.d.ts

export interface SurfaceAction {
  id: string;
  label: string;
  action: string;
  style: 'primary' | 'secondary' | 'destructive';
  value?: unknown;
  opens_artifact?: string;
}
```

---

### `src/types/clarification.d.ts`

```ts
// src/types/clarification.d.ts

export interface ClarificationEntry {
  id: string;                                               // UUID
  timestamp: string;                                        // ISO-8601
  participant: string;
  role: 'question' | 'answer' | 'surface_update';
  content: string;
  surface_version?: number;                                 // Set when role is 'surface_update'
}
```

---

### `src/types/autonomous-log.d.ts`

```ts
// src/types/autonomous-log.d.ts

export interface AutonomousLogEntry {
  id: string;
  timestamp: string;                    // ISO-8601
  agent_id: string;
  package: string;
  action: string;
  summary: string;
  detail?: Record<string, unknown>;
  contract_id?: string;
  connector_used: string;
}
```

---

### `src/types/connector-state.d.ts`

```ts
// src/types/connector-state.d.ts

export interface ConnectorState {
  id: string;
  source: 'openclaw-channel' | 'aura-connector';
  status: 'active' | 'pending' | 'declined' | 'error' | 'not-offered';
  offered_at?: string;
  connected_at?: string;
  declined_at?: string;
  declined_reason?: string;
  never_resurface?: boolean;
  resurface_trigger?: string;
  capability_without: string;
  capability_with: string;
  oauth_token_enc?: string;             // Encrypted
  refresh_token_enc?: string;           // Encrypted
  expires_at?: string;
  updated_at: string;
}
```

---

### `src/storage/interface.d.ts`

Type declarations for the storage layer — filter shapes and log entry type.

```ts
// src/storage/interface.d.ts

export interface ContractFilter {
  status?: string | string[];
  resolver_type?: 'human' | 'agent';
  parent_id?: string;
  type?: string;
  updated_after?: string;        // ISO-8601. Used by SignalWatcher.
  surface_after_before?: string; // ISO-8601. Find deferred contracts ready to surface.
  expires_before?: string;       // ISO-8601. Find contracts past their TTL.
  updated_before?: string;       // ISO-8601. Find resolver_active contracts idling too long.
}

export interface LogFilter {
  agent_id?: string;
  package?: string;
  after?: string;                // ISO-8601
}

export interface ContractLogEntry {
  id?: number;                   // Auto-increment, set by storage
  contract_id: string;
  timestamp: string;             // ISO-8601
  participant: string;
  event: string;
  detail?: Record<string, unknown>;
}
```

---

### `src/storage/interface.js`

The abstract storage interface. `SQLiteContractStorage` implements it.
`PostgresContractStorage` will implement it later without any runtime changes.

The class uses the abstract-class-via-prototype pattern: every method
throws `new Error('not implemented')` in the base. tsc enforces the
contract via JSDoc `@implements`.

```js
// src/storage/interface.js

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { AutonomousLogEntry } from '../types/autonomous-log.js'
 * @import { ConnectorState } from '../types/connector-state.js'
 * @import { ContractFilter, LogFilter, ContractLogEntry } from './interface.js'
 */

/**
 * Abstract storage interface. Implementations must provide all methods.
 * All methods return Promises even when the underlying implementation is
 * synchronous (node:sqlite), keeping the interface Postgres-compatible.
 */
export class ContractStorage {
  /** @returns {Promise<void>} */
  async initialize() { throw new Error('not implemented'); }

  /** @returns {Promise<void>} */
  async close() { throw new Error('not implemented'); }

  // ─── Contracts ────────────────────────────────────────────────────

  /**
   * Upsert a contract. Called on create and every subsequent state change.
   * Must call touchSignal() after writing.
   * @param {BaseContract} contract
   * @returns {Promise<void>}
   */
  async write(contract) { throw new Error('not implemented'); }

  /**
   * Write a contract only if its current status in the DB matches fromStatus.
   * Returns true if updated, false if the status had already changed (lost CAS race).
   * Used by transition() to enforce exactly-once state changes under concurrency.
   * @param {BaseContract} contract
   * @param {string} fromStatus
   * @returns {Promise<boolean>}
   */
  async conditionalWrite(contract, fromStatus) { throw new Error('not implemented'); }

  /**
   * @param {string} id
   * @returns {Promise<BaseContract | null>}
   */
  async read(id) { throw new Error('not implemented'); }

  /**
   * @param {ContractFilter} [filter]
   * @returns {Promise<BaseContract[]>}
   */
  async query(filter) { throw new Error('not implemented'); }

  // ─── Audit log ────────────────────────────────────────────────────

  /**
   * @param {ContractLogEntry} entry
   * @returns {Promise<void>}
   */
  async appendLog(entry) { throw new Error('not implemented'); }

  /**
   * @param {string} contractId
   * @returns {Promise<ContractLogEntry[]>}
   */
  async queryLog(contractId) { throw new Error('not implemented'); }

  // ─── Autonomous log ───────────────────────────────────────────────

  /**
   * @param {AutonomousLogEntry} entry
   * @returns {Promise<void>}
   */
  async writeAutonomousLog(entry) { throw new Error('not implemented'); }

  /**
   * @param {LogFilter} [filter]
   * @returns {Promise<AutonomousLogEntry[]>}
   */
  async queryAutonomousLog(filter) { throw new Error('not implemented'); }

  // ─── Connectors ───────────────────────────────────────────────────

  /**
   * @param {ConnectorState} state
   * @returns {Promise<void>}
   */
  async writeConnector(state) { throw new Error('not implemented'); }

  /** @returns {Promise<ConnectorState[]>} */
  async readConnectors() { throw new Error('not implemented'); }

  /**
   * @param {string} id
   * @returns {Promise<ConnectorState | null>}
   */
  async readConnector(id) { throw new Error('not implemented'); }

  // ─── Resume tokens ────────────────────────────────────────────────

  /**
   * @param {string} contractId
   * @param {string} token
   * @param {string} expiresAt  - ISO-8601
   * @returns {Promise<void>}
   */
  async storeResumeToken(contractId, token, expiresAt) { throw new Error('not implemented'); }

  /**
   * Consume a resume token. Atomically deletes it if valid and unexpired.
   * Returns true if the token existed and was consumed. False otherwise.
   * This is the single-use enforcement mechanism.
   * @param {string} contractId
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async consumeResumeToken(contractId, token) { throw new Error('not implemented'); }

  // ─── Signal ───────────────────────────────────────────────────────

  /**
   * Touch the .signal file. Called after every successful write.
   * SQLite commit must complete before this fires.
   * @returns {Promise<void>}
   */
  async touchSignal() { throw new Error('not implemented'); }

  // ─── File locks (table created in Phase 1, used in Phase 4) ──────

  /**
   * @param {string} path
   * @param {string} agentId
   * @param {string} operation
   * @returns {Promise<boolean>}  - true if lock acquired
   */
  async acquireFileLock(path, agentId, operation) { throw new Error('not implemented'); }

  /**
   * @param {string} path
   * @returns {Promise<void>}
   */
  async releaseFileLock(path) { throw new Error('not implemented'); }
}
```

---

### `src/storage/migrations/001-initial-schema.sql`

```sql
-- Core contract state
CREATE TABLE IF NOT EXISTS contracts (
  id             TEXT PRIMARY KEY,
  version        TEXT NOT NULL,
  type           TEXT NOT NULL,
  status         TEXT NOT NULL,
  resolver_type  TEXT NOT NULL CHECK (resolver_type IN ('human', 'agent')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  expires_at     TEXT,
  surface_after  TEXT,
  parent_id      TEXT,
  recovery_of    TEXT,
  payload        JSON NOT NULL
);

-- Append-only audit log (separate table — don't bloat contracts rows)
CREATE TABLE IF NOT EXISTS contract_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id  TEXT NOT NULL,
  timestamp    TEXT NOT NULL,
  participant  TEXT NOT NULL,
  event        TEXT NOT NULL,
  detail       JSON,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

-- Autonomous action log (pre-authorized actions below approval threshold)
CREATE TABLE IF NOT EXISTS autonomous_log (
  id             TEXT PRIMARY KEY,
  timestamp      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  package        TEXT NOT NULL,
  action         TEXT NOT NULL,
  summary        TEXT NOT NULL,
  detail         JSON,
  contract_id    TEXT,
  connector_used TEXT NOT NULL
);

-- Connector credential state
CREATE TABLE IF NOT EXISTS connectors (
  id                  TEXT PRIMARY KEY,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL,
  offered_at          TEXT,
  connected_at        TEXT,
  declined_at         TEXT,
  declined_reason     TEXT,
  never_resurface     INTEGER NOT NULL DEFAULT 0,
  resurface_trigger   TEXT,
  capability_without  TEXT,
  capability_with     TEXT,
  oauth_token_enc     TEXT,
  refresh_token_enc   TEXT,
  expires_at          TEXT,
  updated_at          TEXT NOT NULL
);

-- Single-use resume tokens
CREATE TABLE IF NOT EXISTS resume_tokens (
  contract_id  TEXT NOT NULL,
  token        TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  PRIMARY KEY (contract_id, token)
);

-- Ephemeral file locks (table declared now, used Phase 4)
CREATE TABLE IF NOT EXISTS file_locks (
  path             TEXT PRIMARY KEY,
  locked_by_agent  TEXT NOT NULL,
  locked_at        TEXT NOT NULL,
  lock_expires_at  TEXT NOT NULL,
  operation        TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contracts_status         ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_resolver_type  ON contracts(resolver_type);
CREATE INDEX IF NOT EXISTS idx_contracts_parent_id      ON contracts(parent_id);
CREATE INDEX IF NOT EXISTS idx_contracts_surface_after  ON contracts(surface_after);
CREATE INDEX IF NOT EXISTS idx_contracts_updated_at     ON contracts(updated_at);
CREATE INDEX IF NOT EXISTS idx_contracts_expires_at     ON contracts(expires_at);
CREATE INDEX IF NOT EXISTS idx_contract_log_cid         ON contract_log(contract_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_log_agent     ON autonomous_log(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_resume_tokens_expires    ON resume_tokens(expires_at);
```

---

### `src/storage/sqlite-storage.js`

```js
// src/storage/sqlite-storage.js

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, utimesSync, closeSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractStorage } from './interface.js';

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { AutonomousLogEntry } from '../types/autonomous-log.js'
 * @import { ConnectorState } from '../types/connector-state.js'
 * @import { ContractFilter, LogFilter, ContractLogEntry } from './interface.js'
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, 'migrations', '001-initial-schema.sql');

/**
 * SQLite implementation of ContractStorage.
 * Uses better-sqlite3 (synchronous) internally.
 * All public methods return Promises to satisfy the ContractStorage interface.
 *
 * @implements {ContractStorage}
 */
export class SQLiteContractStorage extends ContractStorage {
  /**
   * @param {string} dbPath    - Path to contracts.db. Use ':memory:' in tests.
   * @param {string} signalPath - Path to the .signal file.
   */
  constructor(dbPath, signalPath) {
    super();
    /** @type {string} */ this.dbPath = dbPath;
    /** @type {string} */ this.signalPath = signalPath;
    /** @type {import('node:sqlite').DatabaseSync | null} */ this.db = null;
  }

  async initialize() {
    this.db = new DatabaseSync(this.dbPath);

    // Enable WAL mode — survives gateway restarts mid-execution
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    // Run migrations
    const sql = readFileSync(MIGRATION_PATH, 'utf-8');
    this.db.exec(sql);

    // Ensure .signal exists (touch)
    this._touchSignalSync();
  }

  async close() {
    this.db?.close();
    this.db = null;
  }

  // ─── Contracts ────────────────────────────────────────────────────

  /** @param {import('../types/base-contract.js').BaseContract} contract */
  async write(contract) {
    const db = this._db();
    const resolverType = contract.participants.resolver.type === 'human' ? 'human' : 'agent';

    db.prepare(`
      INSERT INTO contracts (id, version, type, status, resolver_type, created_at, updated_at,
        expires_at, surface_after, parent_id, recovery_of, payload)
      VALUES (@id, @version, @type, @status, @resolver_type, @created_at, @updated_at,
        @expires_at, @surface_after, @parent_id, @recovery_of, @payload)
      ON CONFLICT(id) DO UPDATE SET
        status        = excluded.status,
        updated_at    = excluded.updated_at,
        expires_at    = excluded.expires_at,
        surface_after = excluded.surface_after,
        payload       = excluded.payload
    `).run({
      id:            contract.id,
      version:       contract.version,
      type:          contract.type,
      status:        contract.status,
      resolver_type: resolverType,
      created_at:    contract.created_at,
      updated_at:    contract.updated_at,
      expires_at:    contract.expires_at ?? null,
      surface_after: contract.surface_after ?? null,
      parent_id:     contract.parent_id ?? null,
      recovery_of:   contract.recovery_of ?? null,
      payload:       JSON.stringify(contract),
    });

    this._touchSignalSync();
  }

  /**
   * @param {import('../types/base-contract.js').BaseContract} contract
   * @param {string} fromStatus
   */
  async conditionalWrite(contract, fromStatus) {
    const result = this._db().prepare(`
      UPDATE contracts SET
        status        = @status,
        updated_at    = @updated_at,
        expires_at    = @expires_at,
        surface_after = @surface_after,
        payload       = @payload
      WHERE id = @id AND status = @fromStatus
    `).run({
      id:            contract.id,
      status:        contract.status,
      updated_at:    contract.updated_at,
      expires_at:    contract.expires_at ?? null,
      surface_after: contract.surface_after ?? null,
      payload:       JSON.stringify(contract),
      fromStatus,
    });
    if (result.changes > 0) {
      this._touchSignalSync();
      return true;
    }
    return false;
  }

  /** @param {string} id */
  async read(id) {
    const row = this._db().prepare(
      'SELECT payload FROM contracts WHERE id = ?'
    ).get(id);
    return row ? JSON.parse(/** @type {any} */ (row).payload) : null;
  }

  /**
   * @param {import('./interface.js').ContractFilter} [filter]
   */
  async query(filter = {}) {
    const conditions = [];
    const params = /** @type {Record<string, unknown>} */ ({});

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        const placeholders = filter.status.map((_, i) => `@status${i}`).join(', ');
        conditions.push(`status IN (${placeholders})`);
        filter.status.forEach((s, i) => { params[`status${i}`] = s; });
      } else {
        conditions.push('status = @status');
        params.status = filter.status;
      }
    }
    if (filter.resolver_type) {
      conditions.push('resolver_type = @resolver_type');
      params.resolver_type = filter.resolver_type;
    }
    if (filter.parent_id) {
      conditions.push('parent_id = @parent_id');
      params.parent_id = filter.parent_id;
    }
    if (filter.type) {
      conditions.push('type = @type');
      params.type = filter.type;
    }
    if (filter.updated_after) {
      conditions.push('updated_at > @updated_after');
      params.updated_after = filter.updated_after;
    }
    if (filter.surface_after_before) {
      // Deferred contracts ready to surface: surface_after IS NULL OR surface_after <= now
      conditions.push('(surface_after IS NULL OR surface_after <= @surface_after_before)');
      params.surface_after_before = filter.surface_after_before;
    }
    if (filter.expires_before) {
      conditions.push('expires_at IS NOT NULL AND expires_at < @expires_before');
      params.expires_before = filter.expires_before;
    }
    if (filter.updated_before) {
      conditions.push('updated_at < @updated_before');
      params.updated_before = filter.updated_before;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this._db().prepare(`SELECT payload FROM contracts ${where}`).all(params);
    return rows.map((row) => JSON.parse(/** @type {any} */ (row).payload));
  }

  // ─── Audit log ────────────────────────────────────────────────────

  /** @param {import('./interface.js').ContractLogEntry} entry */
  async appendLog(entry) {
    this._db().prepare(`
      INSERT INTO contract_log (contract_id, timestamp, participant, event, detail)
      VALUES (@contract_id, @timestamp, @participant, @event, @detail)
    `).run({
      contract_id: entry.contract_id,
      timestamp:   entry.timestamp,
      participant: entry.participant,
      event:       entry.event,
      detail:      entry.detail ? JSON.stringify(entry.detail) : null,
    });
    // Note: appendLog does NOT touch .signal — only contract writes trigger surface updates
  }

  /** @param {string} contractId */
  async queryLog(contractId) {
    const rows = this._db().prepare(
      'SELECT * FROM contract_log WHERE contract_id = ? ORDER BY id ASC'
    ).all(contractId);
    return rows.map((row) => ({
      .../** @type {any} */ (row),
      detail: /** @type {any} */ (row).detail
        ? JSON.parse(/** @type {any} */ (row).detail)
        : undefined,
    }));
  }

  // ─── Autonomous log ───────────────────────────────────────────────

  /** @param {import('../types/autonomous-log.js').AutonomousLogEntry} entry */
  async writeAutonomousLog(entry) {
    this._db().prepare(`
      INSERT INTO autonomous_log (id, timestamp, agent_id, package, action, summary, detail, contract_id, connector_used)
      VALUES (@id, @timestamp, @agent_id, @package, @action, @summary, @detail, @contract_id, @connector_used)
    `).run({
      id:            entry.id,
      timestamp:     entry.timestamp,
      agent_id:      entry.agent_id,
      package:       entry.package,
      action:        entry.action,
      summary:       entry.summary,
      detail:        entry.detail ? JSON.stringify(entry.detail) : null,
      contract_id:   entry.contract_id ?? null,
      connector_used: entry.connector_used,
    });
  }

  /** @param {import('./interface.js').LogFilter} [filter] */
  async queryAutonomousLog(filter = {}) {
    const conditions = [];
    const params = /** @type {Record<string, unknown>} */ ({});

    if (filter.agent_id) { conditions.push('agent_id = @agent_id'); params.agent_id = filter.agent_id; }
    if (filter.package)  { conditions.push('package = @package');   params.package = filter.package; }
    if (filter.after)    { conditions.push('timestamp > @after');   params.after = filter.after; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this._db().prepare(`SELECT * FROM autonomous_log ${where} ORDER BY timestamp DESC`).all(params);
    return rows.map((row) => ({
      .../** @type {any} */ (row),
      detail: /** @type {any} */ (row).detail ? JSON.parse(/** @type {any} */ (row).detail) : undefined,
    }));
  }

  // ─── Connectors ───────────────────────────────────────────────────

  /** @param {import('../types/connector-state.js').ConnectorState} state */
  async writeConnector(state) {
    this._db().prepare(`
      INSERT INTO connectors (id, source, status, offered_at, connected_at, declined_at,
        declined_reason, never_resurface, resurface_trigger, capability_without, capability_with,
        oauth_token_enc, refresh_token_enc, expires_at, updated_at)
      VALUES (@id, @source, @status, @offered_at, @connected_at, @declined_at, @declined_reason,
        @never_resurface, @resurface_trigger, @capability_without, @capability_with,
        @oauth_token_enc, @refresh_token_enc, @expires_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        status             = excluded.status,
        offered_at         = excluded.offered_at,
        connected_at       = excluded.connected_at,
        declined_at        = excluded.declined_at,
        declined_reason    = excluded.declined_reason,
        never_resurface    = excluded.never_resurface,
        resurface_trigger  = excluded.resurface_trigger,
        capability_without = excluded.capability_without,
        capability_with    = excluded.capability_with,
        oauth_token_enc    = excluded.oauth_token_enc,
        refresh_token_enc  = excluded.refresh_token_enc,
        expires_at         = excluded.expires_at,
        updated_at         = excluded.updated_at
    `).run({
      id:                  state.id,
      source:              state.source,
      status:              state.status,
      offered_at:          state.offered_at ?? null,
      connected_at:        state.connected_at ?? null,
      declined_at:         state.declined_at ?? null,
      declined_reason:     state.declined_reason ?? null,
      never_resurface:     state.never_resurface ? 1 : 0,
      resurface_trigger:   state.resurface_trigger ?? null,
      capability_without:  state.capability_without,
      capability_with:     state.capability_with,
      oauth_token_enc:     state.oauth_token_enc ?? null,
      refresh_token_enc:   state.refresh_token_enc ?? null,
      expires_at:          state.expires_at ?? null,
      updated_at:          state.updated_at,
    });
  }

  async readConnectors() {
    return this._db().prepare('SELECT * FROM connectors').all().map(this._rowToConnector);
  }

  /** @param {string} id */
  async readConnector(id) {
    const row = this._db().prepare('SELECT * FROM connectors WHERE id = ?').get(id);
    return row ? this._rowToConnector(row) : null;
  }

  // ─── Resume tokens ────────────────────────────────────────────────

  /**
   * @param {string} contractId
   * @param {string} token
   * @param {string} expiresAt
   */
  async storeResumeToken(contractId, token, expiresAt) {
    this._db().prepare(`
      INSERT INTO resume_tokens (contract_id, token, expires_at)
      VALUES (?, ?, ?)
    `).run(contractId, token, expiresAt);
  }

  /**
   * Atomically consume a resume token.
   * Returns true if consumed. False if not found, already used, or expired.
   * @param {string} contractId
   * @param {string} token
   */
  async consumeResumeToken(contractId, token) {
    const now = new Date().toISOString();
    const result = this._db().prepare(`
      DELETE FROM resume_tokens
      WHERE contract_id = ? AND token = ? AND expires_at > ?
    `).run(contractId, token, now);
    return result.changes > 0;
  }

  // ─── Signal ───────────────────────────────────────────────────────

  async touchSignal() {
    this._touchSignalSync();
  }

  // ─── File locks ───────────────────────────────────────────────────

  /**
   * @param {string} path
   * @param {string} agentId
   * @param {string} operation
   */
  async acquireFileLock(path, agentId, operation) {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    try {
      // Clean expired locks first
      this._db().prepare('DELETE FROM file_locks WHERE lock_expires_at < ?').run(now);
      this._db().prepare(`
        INSERT INTO file_locks (path, locked_by_agent, locked_at, lock_expires_at, operation)
        VALUES (?, ?, ?, ?, ?)
      `).run(path, agentId, now, expiresAt, operation);
      return true;
    } catch {
      return false; // UNIQUE constraint violation = lock already held
    }
  }

  /** @param {string} path */
  async releaseFileLock(path) {
    this._db().prepare('DELETE FROM file_locks WHERE path = ?').run(path);
  }

  // ─── Internals ────────────────────────────────────────────────────

  _db() {
    if (!this.db) throw new Error('SQLiteContractStorage not initialized. Call initialize() first.');
    return this.db;
  }

  _touchSignalSync() {
    const now = new Date();
    try {
      utimesSync(this.signalPath, now, now);
    } catch {
      // File doesn't exist yet — create it
      closeSync(openSync(this.signalPath, 'a'));
    }
  }

  /** @param {unknown} row */
  _rowToConnector(row) {
    const r = /** @type {any} */ (row);
    return /** @type {import('../types/connector-state.js').ConnectorState} */ ({
      ...r,
      never_resurface: r.never_resurface === 1,
    });
  }
}
```

---

### `src/runtime/state-machine.js`

Pure functions. No I/O. No async. Unit-tested in complete isolation.

```js
// src/runtime/state-machine.js

/**
 * @import { ContractStatusValue } from '../types/contract-status.js'
 * @import { ParticipantRoleValue } from '../types/participant.js'
 */

import { VALID_TRANSITIONS, TERMINAL_STATUSES } from '../types/contract-status.js';
import {
  InvalidTransitionError,
  TerminalStateError,
  UnauthorizedRoleError,
} from '../types/errors.js';

/**
 * Operations each role is permitted to perform.
 * @type {Record<ParticipantRoleValue, string[]>}
 */
const ROLE_PERMISSIONS = {
  writer:   ['create', 'update_intent', 'answer_clarification', 'submit'],
  executor: ['update_result', 'spawn_subtask'],
  resolver: ['engage', 'ask_clarification', 'commit', 'abandon'],
  observer: [],
};

/**
 * Assert that a transition is valid. Throws if not.
 * Pure function — no side effects.
 *
 * @param {string} contractId
 * @param {ContractStatusValue} from
 * @param {ContractStatusValue} to
 * @returns {void}
 * @throws {TerminalStateError}
 * @throws {InvalidTransitionError}
 */
export function assertValidTransition(contractId, from, to) {
  if (TERMINAL_STATUSES.includes(from)) {
    throw new TerminalStateError(contractId, from);
  }
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(contractId, from, to);
  }
}

/**
 * Assert that a participant role is permitted for an operation.
 * Throws if not.
 *
 * @param {string} participantId
 * @param {ParticipantRoleValue} role
 * @param {string} operation
 * @returns {void}
 * @throws {UnauthorizedRoleError}
 */
export function assertRolePermitted(participantId, role, operation) {
  const permitted = ROLE_PERMISSIONS[role] ?? [];
  if (!permitted.includes(operation)) {
    throw new UnauthorizedRoleError(participantId, role, operation);
  }
}

/**
 * Extract the resolver_type column value from a contract.
 * Used when writing the contracts table.
 *
 * @param {{ participants: { resolver: { type: string } } }} contract
 * @returns {'human' | 'agent'}
 */
export function resolverType(contract) {
  return contract.participants.resolver.type === 'human' ? 'human' : 'agent';
}
```

---

### `src/runtime/resume-token.js`

```js
// src/runtime/resume-token.js

import { randomUUID } from 'node:crypto';

/** Token lifetime: 24 hours */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @import { ResumeToken } from './resume-token.js'
 */

/**
 * Generate a new single-use resume token.
 * @returns {ResumeToken}
 */
export function generateResumeToken() {
  return {
    token: randomUUID(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  };
}

/**
 * Check whether a token's expiry has passed.
 * The single-use enforcement is done by the storage layer (DELETE WHERE expires_at > now).
 *
 * @param {string} expiresAt - ISO-8601
 * @returns {boolean}
 */
export function isTokenExpired(expiresAt) {
  return new Date(expiresAt) < new Date();
}
```

Companion type declaration:

```ts
// src/runtime/resume-token.d.ts

export interface ResumeToken {
  token: string;
  expiresAt: string;  // ISO-8601
}
```

---

### `src/runtime/type-registry.js`

```js
// src/runtime/type-registry.js

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ContractTypeDefinition } from './type-registry.js'
 */

import { UnknownContractTypeError, ContractValidationError } from '../types/errors.js';

export class TypeRegistry {
  constructor() {
    /** @type {Map<string, ContractTypeDefinition>} */
    this._types = new Map();
  }

  /**
   * Register a domain contract type.
   * @param {ContractTypeDefinition} definition
   * @returns {void}
   * @throws {Error} if the type is already registered
   */
  register(definition) {
    if (this._types.has(definition.type)) {
      throw new Error(`Contract type already registered: "${definition.type}"`);
    }
    this._types.set(definition.type, definition);
  }

  /**
   * Validate a contract against its registered type.
   * @param {BaseContract} contract
   * @returns {void}
   * @throws {UnknownContractTypeError}
   * @throws {ContractValidationError}
   */
  validate(contract) {
    const definition = this._types.get(contract.type);
    if (!definition) throw new UnknownContractTypeError(contract.type);
    const errors = definition.validate(contract);
    if (errors.length > 0) throw new ContractValidationError(contract.type, errors);
  }

  /**
   * @param {string} type
   * @returns {boolean}
   */
  has(type) {
    return this._types.has(type);
  }

  /** @returns {string[]} */
  list() {
    return Array.from(this._types.keys());
  }
}
```

Companion type declaration:

```ts
// src/runtime/type-registry.d.ts

import type { BaseContract } from '../types/base-contract.js';

export interface ContractTypeDefinition {
  type: string;           // Must match contract.type exactly
  version: string;
  description: string;
  validate(contract: BaseContract): string[];  // Returns error strings. Empty = valid.
}
```

---

### `src/runtime/completion-notifier.js`

```js
// src/runtime/completion-notifier.js

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { CompletionNotifier } from './completion-notifier.js'
 */

/**
 * No-op implementation. Safe default for Phase 1 and all tests.
 * @implements {CompletionNotifier}
 */
export class NoOpCompletionNotifier {
  /** @param {BaseContract} _contract */
  async onComplete(_contract) {
    // Intentionally empty. Phase 2 replaces this with engram integration.
  }
}
```

Companion type declaration:

```ts
// src/runtime/completion-notifier.d.ts

import type { BaseContract } from '../types/base-contract.js';

export interface CompletionNotifier {
  onComplete(contract: BaseContract): Promise<void>;
}
```

---

### `src/runtime/ttl-manager.js`

```js
// src/runtime/ttl-manager.js

/**
 * @import { ContractStorage } from '../storage/interface.js'
 * @import { ContractRuntime } from './contract-runtime.js'
 * @import { ParticipantRef } from '../types/participant.js'
 * @import { TtlManagerConfig } from './ttl-manager.js'
 */

const SYSTEM_ACTOR = /** @type {ParticipantRef} */ ({
  id: 'system',
  type: 'system',
});

export class TtlManager {
  /**
   * @param {ContractStorage} storage
   * @param {ContractRuntime} runtime
   * @param {TtlManagerConfig} [config]
   */
  constructor(storage, runtime, config = {}) {
    this._storage = storage;
    this._runtime = runtime;
    this._checkIntervalMs = config.checkIntervalMs ?? 30_000;
    this._resolverTimeoutMs = config.resolverTimeoutMs ?? 300_000;
    /** @type {NodeJS.Timeout | null} */
    this._timer = null;
  }

  start() {
    this._timer = setInterval(() => this.tick(), this._checkIntervalMs);
    // Unref: the timer must not keep the Node process alive in tests
    this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async tick() {
    const now = new Date().toISOString();

    // 1. Expire TTL: waiting_approval contracts past expires_at
    const expired = await this._storage.query({
      status: 'waiting_approval',
      expires_before: now,
    });
    for (const contract of expired) {
      await this._runtime.transition(contract.id, 'failed', SYSTEM_ACTOR);
    }

    // 2. Resolver timeout: resolver_active contracts idle past resolverTimeoutMs
    const cutoff = new Date(Date.now() - this._resolverTimeoutMs).toISOString();
    const timedOut = await this._storage.query({
      status: 'resolver_active',
      updated_before: cutoff,
    });
    for (const contract of timedOut) {
      // Return to waiting_approval — a new resume token will be generated
      await this._runtime.transition(contract.id, 'waiting_approval', SYSTEM_ACTOR);
    }
  }
}
```

Companion type declaration:

```ts
// src/runtime/ttl-manager.d.ts

export interface TtlManagerConfig {
  checkIntervalMs?: number;    // How often to scan (default: 30_000)
  resolverTimeoutMs?: number;  // How long resolver_active can idle (default: 300_000)
}
```

---

### `src/runtime/contract-runtime.js`

The main entry point. Coordinates all modules. Zero OpenClaw imports.

```js
// src/runtime/contract-runtime.js

/**
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { ContractStatusValue } from '../types/contract-status.js'
 * @import { ParticipantRef } from '../types/participant.js'
 * @import { ContractStorage, ContractFilter, LogFilter } from '../storage/interface.js'
 * @import { CompletionNotifier } from './completion-notifier.js'
 * @import { ContractTypeDefinition } from './type-registry.js'
 * @import { AutonomousLogEntry } from '../types/autonomous-log.js'
 * @import { ContractRuntimeConfig } from './contract-runtime.js'
 */

import { randomUUID } from 'node:crypto';
import { NoOpCompletionNotifier } from './completion-notifier.js';
import { TypeRegistry } from './type-registry.js';
import { TtlManager } from './ttl-manager.js';
import { assertValidTransition } from './state-machine.js';
import { generateResumeToken } from './resume-token.js';
import { ContractNotFoundError, InvalidResumeTokenError } from '../types/errors.js';

export class ContractRuntime {
  /**
   * @param {ContractStorage} storage
   * @param {CompletionNotifier} [notifier]
   * @param {ContractRuntimeConfig} [config]
   */
  constructor(storage, notifier = new NoOpCompletionNotifier(), config = {}) {
    this._storage = storage;
    this._notifier = notifier;
    this._typeRegistry = new TypeRegistry();
    this._ttlManager = new TtlManager(storage, this, config.ttl);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  async initialize() {
    await this._storage.initialize();
    this._ttlManager.start();
  }

  async shutdown() {
    this._ttlManager.stop();
    await this._storage.close();
  }

  // ─── Type Registry ────────────────────────────────────────────────

  /** @param {ContractTypeDefinition} definition */
  registerType(definition) {
    this._typeRegistry.register(definition);
  }

  // ─── Contract CRUD ────────────────────────────────────────────────

  /**
   * Create a new contract. Validates against the registered domain type.
   * Initial status is always 'created'.
   *
   * @param {BaseContract} contract
   * @returns {Promise<void>}
   */
  async create(contract) {
    this._typeRegistry.validate(contract);
    const now = new Date().toISOString();
    const normalized = {
      ...contract,
      status: /** @type {ContractStatusValue} */ ('created'),
      created_at: now,
      updated_at: now,
      version: '1.0',
    };
    await this._storage.write(normalized);
    await this._storage.appendLog({
      contract_id: contract.id,
      timestamp: now,
      participant: contract.participants.writer.id,
      event: 'created',
    });
  }

  /**
   * Transition a contract to a new status.
   * Enforces the state machine. Fires completion notifier on 'complete'.
   * Generates a resume token when entering 'waiting_approval'.
   *
   * @param {string} id
   * @param {ContractStatusValue} to
   * @param {ParticipantRef} actor
   * @returns {Promise<void>}
   */
  async transition(id, to, actor) {
    const contract = await this._getOrThrow(id);
    assertValidTransition(id, contract.status, to);

    const now = new Date().toISOString();
    const updated = { ...contract, status: to, updated_at: now };

    const committed = await this._storage.conditionalWrite(updated, contract.status);
    if (!committed) {
      throw new InvalidTransitionError(id, contract.status, to);
    }
    await this._storage.appendLog({
      contract_id: id,
      timestamp: now,
      participant: actor.id,
      event: `transition:${contract.status}→${to}`,
    });

    // Generate resume token when entering waiting_approval
    if (to === 'waiting_approval') {
      const { token, expiresAt } = generateResumeToken();
      await this._storage.storeResumeToken(id, token, expiresAt);
    }

    // Notify on complete
    if (to === 'complete') {
      await this._notifier.onComplete(updated);
    }
  }

  /**
   * Resume a contract from waiting_approval using a single-use token.
   * Consumes the token atomically. Transitions to 'executing'.
   *
   * @param {string} id
   * @param {string} token
   * @param {ParticipantRef} resolver
   * @param {string} action
   * @param {unknown} [value]
   * @param {Record<string, unknown>} [artifacts]
   * @returns {Promise<void>}
   */
  async resume(id, token, resolver, action, value, artifacts) {
    const contract = await this._getOrThrow(id);
    assertValidTransition(id, contract.status, 'executing');
    const consumed = await this._storage.consumeResumeToken(id, token);
    if (!consumed) throw new InvalidResumeTokenError(id);

    const now = new Date().toISOString();
    const updated = {
      ...contract,
      status: /** @type {ContractStatusValue} */ ('executing'),
      updated_at: now,
      resume: {
        action,
        value,
        timestamp: now,
        resolver_id: resolver.id,
        artifacts,
      },
    };

    await this._storage.write(updated);
    await this._storage.appendLog({
      contract_id: id,
      timestamp: now,
      participant: resolver.id,
      event: 'resumed',
      detail: { action, value },
    });
  }

  // ─── Clarification ────────────────────────────────────────────────

  /**
   * Resolver asks a clarifying question.
   * Transitions resolver_active → clarifying.
   *
   * @param {string} id
   * @param {string} question
   * @param {string} resolverId
   * @returns {Promise<void>}
   */
  async askClarification(id, question, resolverId) {
    const contract = await this._getOrThrow(id);
    const now = new Date().toISOString();

    /** @type {import('../types/clarification.js').ClarificationEntry} */
    const entry = {
      id: randomUUID(),
      timestamp: now,
      participant: resolverId,
      role: 'question',
      content: question,
    };

    const updated = {
      ...contract,
      status: /** @type {ContractStatusValue} */ ('clarifying'),
      updated_at: now,
      clarifications: [...(contract.clarifications ?? []), entry],
    };

    await this._storage.write(updated);
    await this._storage.appendLog({
      contract_id: id,
      timestamp: now,
      participant: resolverId,
      event: 'clarification:question',
    });
  }

  /**
   * Agent answers the clarifying question.
   * Transitions clarifying → resolver_active.
   *
   * @param {string} id
   * @param {string} answer
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async answerClarification(id, answer, agentId) {
    const contract = await this._getOrThrow(id);
    const now = new Date().toISOString();

    /** @type {import('../types/clarification.js').ClarificationEntry} */
    const entry = {
      id: randomUUID(),
      timestamp: now,
      participant: agentId,
      role: 'answer',
      content: answer,
    };

    const updated = {
      ...contract,
      status: /** @type {ContractStatusValue} */ ('resolver_active'),
      updated_at: now,
      clarifications: [...(contract.clarifications ?? []), entry],
    };

    await this._storage.write(updated);
    await this._storage.appendLog({
      contract_id: id,
      timestamp: now,
      participant: agentId,
      event: 'clarification:answer',
    });
  }

  /**
   * Agent updates the decision surface (e.g. after answering a clarification).
   * Increments surface.version on every call.
   *
   * @param {string} id
   * @param {BaseContract['surface']} surface
   * @param {string} agentId
   * @returns {Promise<void>}
   */
  async updateSurface(id, surface, agentId) {
    const contract = await this._getOrThrow(id);
    const now = new Date().toISOString();
    const nextVersion = (contract.surface?.version ?? 0) + 1;
    const updatedSurface = surface ? { ...surface, version: nextVersion } : undefined;

    const updated = { ...contract, surface: updatedSurface, updated_at: now };
    await this._storage.write(updated);
    await this._storage.appendLog({
      contract_id: id,
      timestamp: now,
      participant: agentId,
      event: 'surface:updated',
      detail: { surface_version: nextVersion },
    });
  }

  // ─── Hierarchy ───────────────────────────────────────────────────

  /**
   * Spawn a child contract from a parent that is currently in `executing`.
   * Links the child's `parent_id` to the parent, appends the child's ID to
   * the parent's `child_ids`, and transitions the parent `executing → active`
   * so it can wait for the subtask outcome.
   *
   * @param {string} parentId
   * @param {BaseContract} childContract
   * @param {ParticipantRef} actor
   * @returns {Promise<void>}
   */
  async spawnSubtask(parentId, childContract, actor) {
    const parent = await this._getOrThrow(parentId);
    assertValidTransition(parentId, parent.status, 'active');

    const now = new Date().toISOString();

    // Create child with parent link
    const child = {
      ...childContract,
      parent_id: parentId,
      status: /** @type {ContractStatusValue} */ ('created'),
      created_at: now,
      updated_at: now,
      version: '1.0',
    };
    this._typeRegistry.validate(child);
    await this._storage.write(child);
    await this._storage.appendLog({
      contract_id: child.id,
      timestamp: now,
      participant: actor.id,
      event: 'created',
      detail: { parent_id: parentId },
    });

    // Update parent: add child_id, transition executing → active
    const updatedParent = {
      ...parent,
      status: /** @type {ContractStatusValue} */ ('active'),
      updated_at: now,
      child_ids: [...(parent.child_ids ?? []), child.id],
    };
    await this._storage.write(updatedParent);
    await this._storage.appendLog({
      contract_id: parentId,
      timestamp: now,
      participant: actor.id,
      event: `transition:executing→active`,
      detail: { spawned_child: child.id },
    });
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /**
   * @param {string} id
   * @returns {Promise<BaseContract | null>}
   */
  async get(id) {
    return this._storage.read(id);
  }

  /**
   * @param {ContractFilter} [filter]
   * @returns {Promise<BaseContract[]>}
   */
  async list(filter) {
    return this._storage.query(filter);
  }

  /**
   * Contracts in waiting_approval ready to be surfaced (past surface_after).
   * Called by the plugin's WebSocket server on client connect (reconnect recovery).
   *
   * @returns {Promise<BaseContract[]>}
   */
  async getPending() {
    return this._storage.query({
      status: 'waiting_approval',
      surface_after_before: new Date().toISOString(),
    });
  }

  // ─── Autonomous log ───────────────────────────────────────────────

  /** @param {AutonomousLogEntry} entry */
  async logAutonomousAction(entry) {
    await this._storage.writeAutonomousLog(entry);
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * @param {string} id
   * @returns {Promise<BaseContract>}
   */
  async _getOrThrow(id) {
    const contract = await this._storage.read(id);
    if (!contract) throw new ContractNotFoundError(id);
    return contract;
  }
}
```

Companion type declaration:

```ts
// src/runtime/contract-runtime.d.ts

export interface ContractRuntimeConfig {
  ttl?: {
    checkIntervalMs?: number;
    resolverTimeoutMs?: number;
  };
}
```

---

### `src/domain-types/offer-received.js`

Artist reseller use case type. Demonstrates the domain type pattern.

```js
// src/domain-types/offer-received.js

/**
 * @import { ContractTypeDefinition } from '../runtime/type-registry.js'
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { OfferReceivedContext } from './offer-received.js'
 */

/** @type {ContractTypeDefinition} */
export const offerReceivedType = {
  type: 'offer-received',
  version: '1.0',
  description: 'A buyer has made an offer on a listing. Requires owner decision to accept, counter, or decline.',

  /** @param {BaseContract} contract */
  validate(contract) {
    const errors = [];
    const ctx = /** @type {Partial<OfferReceivedContext>} */ (contract.intent.context);

    if (!ctx.platform)          errors.push('context.platform is required');
    if (!ctx.listing_id)        errors.push('context.listing_id is required');
    if (!ctx.buyer_id)          errors.push('context.buyer_id is required');
    if (ctx.offer_amount == null)  errors.push('context.offer_amount is required');
    if (ctx.asking_price == null)  errors.push('context.asking_price is required');

    if (ctx.offer_amount != null && ctx.offer_amount <= 0) {
      errors.push('context.offer_amount must be greater than 0');
    }

    return errors;
  },
};
```

Companion type declaration:

```ts
// src/domain-types/offer-received.d.ts

export interface OfferReceivedContext {
  platform: 'poshmark' | 'etsy' | 'mercari';
  listing_id: string;
  listing_title: string;
  asking_price: number;
  offer_amount: number;
  buyer_id: string;
  budget_threshold?: number;
  vendor_history?: Array<{ date: string; outcome: string; amount: number }>;
}
```

---

### `src/domain-types/grant-report-draft.js`

Non-profit use case type.

```js
// src/domain-types/grant-report-draft.js

/**
 * @import { ContractTypeDefinition } from '../runtime/type-registry.js'
 * @import { BaseContract } from '../types/base-contract.js'
 * @import { GrantReportDraftContext } from './grant-report-draft.js'
 */

/** @type {ContractTypeDefinition} */
export const grantReportDraftType = {
  type: 'grant-report-draft',
  version: '1.0',
  description: 'Agent has compiled a grant report draft. Director reviews before submission.',

  /** @param {BaseContract} contract */
  validate(contract) {
    const errors = [];
    const ctx = /** @type {Partial<GrantReportDraftContext>} */ (contract.intent.context);

    if (!ctx.funder_name)  errors.push('context.funder_name is required');
    if (!ctx.grant_id)     errors.push('context.grant_id is required');
    if (!ctx.deadline)     errors.push('context.deadline is required');
    if (!ctx.draft_path)   errors.push('context.draft_path is required');

    return errors;
  },
};
```

Companion type declaration:

```ts
// src/domain-types/grant-report-draft.d.ts

export interface GrantReportDraftContext {
  funder_name: string;
  grant_id: string;
  report_period: string;   // e.g. "Q1 2026"
  deadline: string;        // ISO-8601 date
  draft_path: string;      // Path in PARA tree
  data_sources: string[];  // Drive doc IDs used to compile draft
}
```

---

### `src/index.js` — Public API

```js
// src/index.js — Public API surface for @aura/contract-runtime

// Status + transitions
export { ContractStatus, VALID_TRANSITIONS, TERMINAL_STATUSES } from './types/contract-status.js';

// Participant
export { ParticipantRole } from './types/participant.js';

// Errors
export {
  AuraRuntimeError,
  InvalidTransitionError,
  TerminalStateError,
  UnauthorizedRoleError,
  InvalidResumeTokenError,
  UnknownContractTypeError,
  ContractValidationError,
  ContractNotFoundError,
} from './types/errors.js';

// Storage
export { ContractStorage } from './storage/interface.js';
export { SQLiteContractStorage } from './storage/sqlite-storage.js';

// Runtime
export { ContractRuntime } from './runtime/contract-runtime.js';
export { TypeRegistry } from './runtime/type-registry.js';
export { NoOpCompletionNotifier } from './runtime/completion-notifier.js';

// Domain types
export { offerReceivedType } from './domain-types/offer-received.js';
export { grantReportDraftType } from './domain-types/grant-report-draft.js';
```

---

### `src/index.d.ts` — Public API types

Type re-exports for the package entry point. Required so that Phase 2 workspace
consumers importing `@aura/contract-runtime` get type information without needing
to reach into `src/types/` internals.

```ts
// src/index.d.ts

// Status
export type { ContractStatusValue } from './types/contract-status.js';
export { ContractStatus, VALID_TRANSITIONS, TERMINAL_STATUSES } from './types/contract-status.js';

// Participant
export type { ParticipantRef, ParticipantRoleValue } from './types/participant.js';
export { ParticipantRole } from './types/participant.js';

// Contract shape
export type {
  BaseContract,
  ContractSurface,
  ContractIntent,
  ContractParticipants,
  ContractResume,
  ContractResult,
  ContractCompletionSurface,
  ComponentRef,
  SurfaceRecommendation,
} from './types/base-contract.js';

export type { SurfaceAction } from './types/surface-action.js';
export type { ClarificationEntry } from './types/clarification.js';
export type { AutonomousLogEntry } from './types/autonomous-log.js';
export type { ConnectorState } from './types/connector-state.js';

// Storage
export type { ContractFilter, LogFilter, ContractLogEntry } from './storage/interface.js';
export { ContractStorage } from './storage/interface.js';
export { SQLiteContractStorage } from './storage/sqlite-storage.js';

// Runtime
export type { ContractRuntimeConfig } from './runtime/contract-runtime.js';
export type { ContractTypeDefinition } from './runtime/type-registry.js';
export type { CompletionNotifier } from './runtime/completion-notifier.js';
export { ContractRuntime } from './runtime/contract-runtime.js';
export { TypeRegistry } from './runtime/type-registry.js';
export { NoOpCompletionNotifier } from './runtime/completion-notifier.js';

// Errors
export {
  AuraRuntimeError,
  InvalidTransitionError,
  TerminalStateError,
  UnauthorizedRoleError,
  InvalidResumeTokenError,
  UnknownContractTypeError,
  ContractValidationError,
  ContractNotFoundError,
} from './types/errors.js';

// Domain types
export type { OfferReceivedContext } from './domain-types/offer-received.js';
export type { GrantReportDraftContext } from './domain-types/grant-report-draft.js';
export { offerReceivedType } from './domain-types/offer-received.js';
export { grantReportDraftType } from './domain-types/grant-report-draft.js';
```

---

## Test Helpers

### `tests/helpers/temp-db.js`

Shared setup/teardown used by every integration test.

```js
// tests/helpers/temp-db.js

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteContractStorage } from '../../src/storage/sqlite-storage.js';
import { ContractRuntime } from '../../src/runtime/contract-runtime.js';

/**
 * Create a temp directory with a fresh contracts.db and .signal file.
 * Returns the runtime, storage, and a cleanup function.
 *
 * @param {object} [runtimeConfig]
 * @returns {{ runtime: ContractRuntime, storage: SQLiteContractStorage,
 *             signalPath: string, cleanup: () => void }}
 */
export function makeTempRuntime(runtimeConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aura-test-'));
  const dbPath = join(dir, 'contracts.db');
  const signalPath = join(dir, '.signal');

  const storage = new SQLiteContractStorage(dbPath, signalPath);
  const runtime = new ContractRuntime(storage, undefined, runtimeConfig);

  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };

  return { runtime, storage, signalPath, cleanup };
}
```

### `tests/helpers/fixtures.js`

Factory helpers. Tests call these rather than constructing contracts inline.

```js
// tests/helpers/fixtures.js

/**
 * @import { BaseContract } from '../../src/types/base-contract.js'
 * @import { OfferReceivedContext } from '../../src/domain-types/offer-received.js'
 * @import { GrantReportDraftContext } from '../../src/domain-types/grant-report-draft.js'
 */

import { randomUUID } from 'node:crypto';

/**
 * @param {Partial<BaseContract>} [overrides]
 * @returns {BaseContract}
 */
export function makeContract(overrides = {}) {
  return /** @type {BaseContract} */ ({
    id: `contract-${randomUUID()}`,
    version: '1.0',
    type: 'offer-received',
    status: 'created',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    participants: {
      writer: { id: 'agent-primary', type: 'agent' },
      resolver: { id: 'owner', type: 'human' },
    },
    intent: {
      goal: 'Get owner decision on buyer offer',
      trigger: 'Buyer submitted offer on Poshmark listing',
      context: makeOfferContext(),
    },
    ...overrides,
  });
}

/**
 * @param {Partial<OfferReceivedContext>} [overrides]
 * @returns {OfferReceivedContext}
 */
export function makeOfferContext(overrides = {}) {
  return {
    platform: 'poshmark',
    listing_id: 'listing-abc123',
    listing_title: 'Vintage Levi\'s 501 - Size 32',
    asking_price: 45,
    offer_amount: 30,
    buyer_id: 'buyer-xyz',
    ...overrides,
  };
}

/**
 * @param {Partial<BaseContract>} [overrides]
 * @returns {BaseContract}
 */
export function makeGrantContract(overrides = {}) {
  return /** @type {BaseContract} */ ({
    id: `grant-${randomUUID()}`,
    version: '1.0',
    type: 'grant-report-draft',
    status: 'created',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    participants: {
      writer: { id: 'agent-primary', type: 'agent' },
      resolver: { id: 'director', type: 'human' },
    },
    intent: {
      goal: 'Director reviews and approves grant report before submission',
      trigger: 'Agent compiled report from Drive data',
      context: /** @type {GrantReportDraftContext} */ ({
        funder_name: 'California Coastal Commission',
        grant_id: 'CCC-2026-Q1',
        report_period: 'Q1 2026',
        deadline: '2026-04-15',
        draft_path: 'projects/ccc-q1-report/draft-v1.md',
        data_sources: ['drive:doc-abc', 'drive:doc-def'],
      }),
    },
    ...overrides,
  });
}

/** @returns {{ id: string, type: 'human' }} */
export const humanResolver = () => ({ id: 'owner', type: /** @type {'human'} */ ('human') });

/** @returns {{ id: string, type: 'agent' }} */
export const agentWriter = () => ({ id: 'agent-primary', type: /** @type {'agent'} */ ('agent') });
```

---

## Test Suite

Phase 1 is done when every test below is green. No exceptions.

---

### `tests/unit/state-machine.test.js`

```js
import { describe, it, expect } from 'vitest';
import { assertValidTransition, assertRolePermitted } from '../../src/runtime/state-machine.js';
import {
  InvalidTransitionError,
  TerminalStateError,
  UnauthorizedRoleError,
} from '../../src/types/errors.js';

describe('assertValidTransition', () => {
  // Valid transitions — should not throw
  it.each([
    ['created',          'active'],
    ['active',           'waiting_approval'],
    ['active',           'complete'],
    ['active',           'failed'],
    ['waiting_approval', 'resolver_active'],
    ['waiting_approval', 'failed'],
    ['resolver_active',  'clarifying'],
    ['resolver_active',  'executing'],
    ['resolver_active',  'waiting_approval'],
    ['clarifying',       'resolver_active'],
    ['executing',        'active'],
    ['executing',        'complete'],
    ['executing',        'failed'],
    ['failed',           'active'],   // recoverable — human instructs retry
  ])('%s → %s is valid', (from, to) => {
    expect(() => assertValidTransition('cid', from, to)).not.toThrow();
  });

  // Invalid transitions — should throw InvalidTransitionError
  it.each([
    ['created',  'complete'],
    ['created',  'waiting_approval'],
    ['active',   'created'],
    ['active',   'resolver_active'],
    ['clarifying', 'executing'],
  ])('%s → %s throws InvalidTransitionError', (from, to) => {
    expect(() => assertValidTransition('cid', from, to))
      .toThrow(InvalidTransitionError);
  });

  // Only `complete` is truly terminal
  it('complete → active throws TerminalStateError', () => {
    expect(() => assertValidTransition('cid', 'complete', 'active'))
      .toThrow(TerminalStateError);
  });

  // `failed` is recoverable — invalid targets throw InvalidTransitionError, not TerminalStateError
  it('failed → complete throws InvalidTransitionError (failed is not terminal)', () => {
    expect(() => assertValidTransition('cid', 'failed', 'complete'))
      .toThrow(InvalidTransitionError);
  });

  it('error includes correct contractId, from, and to', () => {
    try {
      assertValidTransition('my-contract', 'active', 'created');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      expect(/** @type {InvalidTransitionError} */ (e).contractId).toBe('my-contract');
      expect(/** @type {InvalidTransitionError} */ (e).from).toBe('active');
      expect(/** @type {InvalidTransitionError} */ (e).to).toBe('created');
    }
  });
});

describe('assertRolePermitted', () => {
  it('allows writer to create', () => {
    expect(() => assertRolePermitted('p1', 'writer', 'create')).not.toThrow();
  });

  it('allows resolver to engage', () => {
    expect(() => assertRolePermitted('p1', 'resolver', 'engage')).not.toThrow();
  });

  it('throws UnauthorizedRoleError when writer tries to commit', () => {
    expect(() => assertRolePermitted('p1', 'writer', 'commit'))
      .toThrow(UnauthorizedRoleError);
  });

  it('throws UnauthorizedRoleError for any observer operation', () => {
    expect(() => assertRolePermitted('p1', 'observer', 'create'))
      .toThrow(UnauthorizedRoleError);
  });
});
```

---

### `tests/unit/resume-token.test.js`

```js
import { describe, it, expect } from 'vitest';
import { generateResumeToken, isTokenExpired } from '../../src/runtime/resume-token.js';

describe('generateResumeToken', () => {
  it('returns a token and expiresAt', () => {
    const result = generateResumeToken();
    expect(result.token).toBeTruthy();
    expect(result.expiresAt).toBeTruthy();
  });

  it('token matches UUID v4 format', () => {
    const { token } = generateResumeToken();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('expiresAt is approximately 24 hours from now', () => {
    const before = Date.now();
    const { expiresAt } = generateResumeToken();
    const after = Date.now();
    const exp = new Date(expiresAt).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000);
    expect(exp).toBeLessThanOrEqual(after + 25 * 60 * 60 * 1000);
  });

  it('generates unique tokens on every call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateResumeToken().token));
    expect(tokens.size).toBe(100);
  });
});

describe('isTokenExpired', () => {
  it('returns false for a future expiry', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isTokenExpired(future)).toBe(false);
  });

  it('returns true for a past expiry', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isTokenExpired(past)).toBe(true);
  });
});
```

---

### `tests/unit/type-registry.test.js`

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { TypeRegistry } from '../../src/runtime/type-registry.js';
import { UnknownContractTypeError, ContractValidationError } from '../../src/types/errors.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';
import { grantReportDraftType } from '../../src/domain-types/grant-report-draft.js';
import { makeContract, makeGrantContract, makeOfferContext } from '../helpers/fixtures.js';

describe('TypeRegistry', () => {
  let registry;
  beforeEach(() => { registry = new TypeRegistry(); });

  it('registers a type definition', () => {
    registry.register(offerReceivedType);
    expect(registry.has('offer-received')).toBe(true);
  });

  it('throws on duplicate registration', () => {
    registry.register(offerReceivedType);
    expect(() => registry.register(offerReceivedType)).toThrow();
  });

  it('lists registered types', () => {
    registry.register(offerReceivedType);
    registry.register(grantReportDraftType);
    expect(registry.list()).toContain('offer-received');
    expect(registry.list()).toContain('grant-report-draft');
  });

  it('throws UnknownContractTypeError for unregistered type', () => {
    expect(() => registry.validate(makeContract({ type: 'unknown-type' })))
      .toThrow(UnknownContractTypeError);
  });

  it('passes validation for a valid offer-received contract', () => {
    registry.register(offerReceivedType);
    expect(() => registry.validate(makeContract())).not.toThrow();
  });

  it('throws ContractValidationError for offer-received with missing offer_amount', () => {
    registry.register(offerReceivedType);
    const contract = makeContract({
      intent: { goal: '', trigger: '', context: makeOfferContext({ offer_amount: undefined }) },
    });
    expect(() => registry.validate(contract)).toThrow(ContractValidationError);
  });

  it('throws ContractValidationError for offer-received with offer_amount = 0', () => {
    registry.register(offerReceivedType);
    const contract = makeContract({
      intent: { goal: '', trigger: '', context: makeOfferContext({ offer_amount: 0 }) },
    });
    const err = /** @type {ContractValidationError} */ (
      (() => { try { registry.validate(contract); } catch(e) { return e; } })()
    );
    expect(err).toBeInstanceOf(ContractValidationError);
    expect(err.details.some(d => d.includes('offer_amount'))).toBe(true);
  });

  it('passes validation for a valid grant-report-draft contract', () => {
    registry.register(grantReportDraftType);
    expect(() => registry.validate(makeGrantContract())).not.toThrow();
  });

  it('throws ContractValidationError for grant-report-draft with missing deadline', () => {
    registry.register(grantReportDraftType);
    const contract = makeGrantContract();
    delete contract.intent.context.deadline;
    expect(() => registry.validate(contract)).toThrow(ContractValidationError);
  });
});
```

---

### `tests/integration/transitions.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';
import { InvalidTransitionError, TerminalStateError } from '../../src/types/errors.js';

describe('Contract lifecycle transitions', () => {
  let runtime, storage, cleanup;
  beforeEach(async () => {
    ({ runtime, storage, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('creates a contract in created status', async () => {
    const c = makeContract();
    await runtime.create(c);
    const saved = await runtime.get(c.id);
    expect(saved?.status).toBe('created');
  });

  it('transitions created → active', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    expect((await runtime.get(c.id))?.status).toBe('active');
  });

  it('transitions active → waiting_approval and stores a resume token', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    expect((await runtime.get(c.id))?.status).toBe('waiting_approval');
    // Resume token should exist in DB
    const row = storage._db().prepare(
      'SELECT * FROM resume_tokens WHERE contract_id = ?'
    ).get(c.id);
    expect(row).toBeTruthy();
  });

  it('transitions active → complete and fires completion notifier', async () => {
    let notified = null;
    const notifier = { onComplete: async (contract) => { notified = contract; } };
    const { runtime: rt, cleanup: cl } = makeTempRuntime();
    await rt.initialize();
    rt._notifier = notifier;
    rt.registerType(offerReceivedType);

    const c = makeContract();
    await rt.create(c);
    await rt.transition(c.id, 'active', agentWriter());
    await rt.transition(c.id, 'complete', agentWriter());
    expect(notified?.id).toBe(c.id);
    await rt.shutdown(); cl();
  });

  it('throws InvalidTransitionError for an invalid transition', async () => {
    const c = makeContract();
    await runtime.create(c);
    await expect(runtime.transition(c.id, 'complete', agentWriter()))
      .rejects.toThrow(InvalidTransitionError);
  });

  it('throws TerminalStateError on complete contract', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'complete', agentWriter());
    await expect(runtime.transition(c.id, 'active', agentWriter()))
      .rejects.toThrow(TerminalStateError);
  });

  it('updates updated_at on every transition', async () => {
    const c = makeContract();
    await runtime.create(c);
    const before = (await runtime.get(c.id))?.updated_at;
    await new Promise(r => setTimeout(r, 5)); // ensure clock advances
    await runtime.transition(c.id, 'active', agentWriter());
    const after = (await runtime.get(c.id))?.updated_at;
    expect(after).not.toBe(before);
  });

  it('appends an entry to contract_log on every transition', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    const log = await storage.queryLog(c.id);
    // created + 2 transitions
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log.some(e => e.event.includes('created→active')
      || e.event === 'created')).toBe(true);
  });
});
```

---

### `tests/integration/deferred-surfacing.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('Deferred surfacing', () => {
  let runtime, cleanup;
  beforeEach(async () => {
    ({ runtime, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('getPending() does not return a contract before surface_after', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const c = makeContract({ surface_after: future });
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    const pending = await runtime.getPending();
    expect(pending.find(p => p.id === c.id)).toBeUndefined();
  });

  it('getPending() returns a contract after surface_after has passed', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const c = makeContract({ surface_after: past });
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    const pending = await runtime.getPending();
    expect(pending.find(p => p.id === c.id)).toBeTruthy();
  });

  it('getPending() returns contracts with no surface_after', async () => {
    const c = makeContract(); // no surface_after
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    const pending = await runtime.getPending();
    expect(pending.find(p => p.id === c.id)).toBeTruthy();
  });
});
```

---

### `tests/integration/clarification.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('Clarification round-trip', () => {
  let runtime, cleanup;
  beforeEach(async () => {
    ({ runtime, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  async function setupToWaiting(c) {
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    await runtime.transition(c.id, 'resolver_active', humanResolver());
  }

  it('transitions resolver_active → clarifying on askClarification', async () => {
    const c = makeContract();
    await setupToWaiting(c);
    await runtime.askClarification(c.id, 'What was their last counter?', 'owner');
    expect((await runtime.get(c.id))?.status).toBe('clarifying');
  });

  it('appends question entry to clarifications array', async () => {
    const c = makeContract();
    await setupToWaiting(c);
    await runtime.askClarification(c.id, 'What was their last counter?', 'owner');
    const saved = await runtime.get(c.id);
    expect(saved?.clarifications?.length).toBeGreaterThan(0);
    expect(saved?.clarifications?.at(-1)?.role).toBe('question');
    expect(saved?.clarifications?.at(-1)?.content).toBe('What was their last counter?');
  });

  it('transitions clarifying → resolver_active on answerClarification', async () => {
    const c = makeContract();
    await setupToWaiting(c);
    await runtime.askClarification(c.id, 'What was their last counter?', 'owner');
    await runtime.answerClarification(c.id, 'They accepted $42 in March.', 'agent-primary');
    expect((await runtime.get(c.id))?.status).toBe('resolver_active');
  });

  it('appends answer entry and preserves question', async () => {
    const c = makeContract();
    await setupToWaiting(c);
    await runtime.askClarification(c.id, 'Question?', 'owner');
    await runtime.answerClarification(c.id, 'Answer.', 'agent-primary');
    const saved = await runtime.get(c.id);
    expect(saved?.clarifications?.length).toBe(2);
    expect(saved?.clarifications?.[0].role).toBe('question');
    expect(saved?.clarifications?.[1].role).toBe('answer');
  });

  it('increments surface version on updateSurface', async () => {
    const c = makeContract();
    await setupToWaiting(c);
    const surface = {
      voice_line: 'Recommend counter at $38.',
      summary: 'Buyer offered $30.',
      recommendation: { action: 'counter', value: 38, reasoning: 'History shows they accept $38.' },
      actions: [],
      version: 0,
    };
    await runtime.updateSurface(c.id, surface, 'agent-primary');
    const saved = await runtime.get(c.id);
    expect(saved?.surface?.version).toBe(1);
    await runtime.updateSurface(c.id, surface, 'agent-primary');
    expect((await runtime.get(c.id))?.surface?.version).toBe(2);
  });

  it('supports multiple clarification rounds', async () => {
    const c = makeContract();
    await setupToWaiting(c);
    await runtime.askClarification(c.id, 'Q1?', 'owner');
    await runtime.answerClarification(c.id, 'A1.', 'agent-primary');
    await runtime.askClarification(c.id, 'Q2?', 'owner');
    await runtime.answerClarification(c.id, 'A2.', 'agent-primary');
    const saved = await runtime.get(c.id);
    expect(saved?.clarifications?.length).toBe(4);
  });
});
```

---

### `tests/integration/ttl-expiry.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('TTL enforcement', () => {
  let runtime, cleanup;
  beforeEach(async () => {
    ({ runtime, cleanup } = makeTempRuntime({ ttl: { checkIntervalMs: 50 } }));
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('moves waiting_approval → failed when expires_at has passed', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const c = makeContract({ expires_at: past });
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    // Manually trigger tick
    await runtime._ttlManager.tick();
    expect((await runtime.get(c.id))?.status).toBe('failed');
  });

  it('does not expire a contract before expires_at', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const c = makeContract({ expires_at: future });
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    await runtime._ttlManager.tick();
    expect((await runtime.get(c.id))?.status).toBe('waiting_approval');
  });

  it('does not expire a contract with no expires_at', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    await runtime._ttlManager.tick();
    expect((await runtime.get(c.id))?.status).toBe('waiting_approval');
  });
});
```

---

### `tests/integration/resolver-timeout.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter, humanResolver } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('Resolver timeout', () => {
  let runtime, storage, cleanup;
  beforeEach(async () => {
    // 100ms resolver timeout for testing
    ({ runtime, storage, cleanup } = makeTempRuntime({ ttl: { resolverTimeoutMs: 100 } }));
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('moves resolver_active → waiting_approval after resolverTimeoutMs', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    await runtime.transition(c.id, 'resolver_active', humanResolver());

    // Wait past the timeout
    await new Promise(r => setTimeout(r, 150));
    await runtime._ttlManager.tick();

    expect((await runtime.get(c.id))?.status).toBe('waiting_approval');
  });

  it('generates a new resume token after returning to waiting_approval', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());
    await runtime.transition(c.id, 'waiting_approval', agentWriter());
    await runtime.transition(c.id, 'resolver_active', humanResolver());

    const tokensBefore = storage._db()
      .prepare('SELECT COUNT(*) as n FROM resume_tokens WHERE contract_id = ?')
      .get(c.id).n;

    await new Promise(r => setTimeout(r, 150));
    await runtime._ttlManager.tick();

    const tokensAfter = storage._db()
      .prepare('SELECT COUNT(*) as n FROM resume_tokens WHERE contract_id = ?')
      .get(c.id).n;

    expect(tokensAfter).toBeGreaterThan(tokensBefore);
  });
});
```

---

### `tests/integration/concurrent-writes.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('Concurrent writes', () => {
  let runtime, cleanup;
  beforeEach(async () => {
    ({ runtime, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('handles 10 simultaneous creates without data corruption', async () => {
    const contracts = Array.from({ length: 10 }, () => makeContract());
    await Promise.all(contracts.map(c => runtime.create(c)));

    for (const c of contracts) {
      const saved = await runtime.get(c.id);
      expect(saved?.id).toBe(c.id);
      expect(saved?.status).toBe('created');
    }
  });

  it('serializes 10 simultaneous transitions on the same contract', async () => {
    // All 10 attempt active → waiting_approval.
    // Only one should succeed; conditionalWrite (compare-and-swap) ensures the remaining 9
    // throw InvalidTransitionError — the CAS UPDATE finds status != 'active' and returns false.
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        runtime.transition(c.id, 'waiting_approval', agentWriter())
      )
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures  = results.filter(r => r.status === 'rejected');

    // Exactly one should succeed — SQLite serializes the writes
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(9);

    // Final state should be waiting_approval
    expect((await runtime.get(c.id))?.status).toBe('waiting_approval');
  });
});
```

---

### `tests/integration/signal-timing.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { statSync } from 'node:fs';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('Signal timing', () => {
  let runtime, storage, signalPath, cleanup;
  beforeEach(async () => {
    ({ runtime, storage, signalPath, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  async function signalMtime() {
    return statSync(signalPath).mtimeMs;
  }

  it('.signal is touched after create', async () => {
    const before = await signalMtime();
    await new Promise(r => setTimeout(r, 5));
    await runtime.create(makeContract());
    const after = await signalMtime();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('.signal is touched after transition', async () => {
    const c = makeContract();
    await runtime.create(c);
    const before = await signalMtime();
    await new Promise(r => setTimeout(r, 5));
    await runtime.transition(c.id, 'active', agentWriter());
    const after = await signalMtime();
    expect(after).toBeGreaterThan(before);
  });

  it('reading contracts.db after signal fires returns committed data', async () => {
    const c = makeContract();
    await runtime.create(c);
    await runtime.transition(c.id, 'active', agentWriter());

    // After signal fires, the data is already in DB
    const saved = await storage.read(c.id);
    expect(saved?.status).toBe('active');
  });

  it('.signal is not touched when a write fails (invalid transition)', async () => {
    const c = makeContract();
    await runtime.create(c);
    const before = await signalMtime();
    await new Promise(r => setTimeout(r, 5));
    // Attempt invalid transition — should throw, should NOT touch signal
    await runtime.transition(c.id, 'complete', agentWriter()).catch(() => {});
    const after = await signalMtime();
    // mtime should not have changed (no write happened)
    expect(after).toBe(before);
  });
});
```

---

### `tests/integration/offer-received.test.js` — Artist reseller end-to-end

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, makeOfferContext, agentWriter, humanResolver } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('offer-received — full lifecycle', () => {
  let runtime, storage, cleanup;
  beforeEach(async () => {
    ({ runtime, storage, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('full lifecycle including clarification and resume with artifact', async () => {
    // 1. Agent creates contract after reasoning about incoming email
    const wakeTime = new Date(Date.now() - 1000).toISOString(); // already past
    const contract = makeContract({
      surface_after: wakeTime,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      intent: {
        goal: 'Owner decision: accept, counter, or decline offer',
        trigger: 'Buyer offer received on Poshmark listing',
        context: makeOfferContext({
          asking_price: 45,
          offer_amount: 30,
          buyer_id: 'buyer-xyz',
          vendor_history: [{ date: '2026-03-01', outcome: 'accepted-counter', amount: 38 }],
        }),
      },
    });

    await runtime.create(contract);
    expect((await runtime.get(contract.id))?.status).toBe('created');

    // 2. Agent submits
    await runtime.transition(contract.id, 'active', agentWriter());
    expect((await runtime.get(contract.id))?.status).toBe('active');

    // 3. Agent surfaces decision with voice and recommendation
    await runtime.updateSurface(contract.id, {
      voice_line: 'Acme has offered $30 on your $45 Levi\'s. Based on their March counter, I recommend $38.',
      summary: 'Buyer offered $30 on $45 listing',
      recommendation: { action: 'counter', value: 38, reasoning: 'Buyer accepted $38 in March 2026' },
      actions: [
        { id: 'accept', label: 'Accept $30', action: 'accept', style: 'secondary' },
        { id: 'counter', label: 'Counter $38', action: 'counter', value: 38, style: 'primary' },
        { id: 'decline', label: 'Decline', action: 'decline', style: 'destructive' },
      ],
      version: 0,
    }, 'agent-primary');

    await runtime.transition(contract.id, 'waiting_approval', agentWriter());

    // 4. Deferred surfacing: getPending() returns it (surface_after already past)
    const pending = await runtime.getPending();
    expect(pending.find(p => p.id === contract.id)).toBeTruthy();

    // 5. Owner engages
    await runtime.transition(contract.id, 'resolver_active', humanResolver());
    expect((await runtime.get(contract.id))?.status).toBe('resolver_active');

    // 6. Owner asks for clarification
    await runtime.askClarification(contract.id, 'What did they accept last time?', 'owner');
    expect((await runtime.get(contract.id))?.status).toBe('clarifying');

    // 7. Agent answers and updates surface
    await runtime.answerClarification(
      contract.id,
      'They accepted a counter of $38 on March 1st, 2026.',
      'agent-primary'
    );
    await runtime.updateSurface(contract.id, {
      voice_line: 'They accepted $38 in March. Counter at $38 is your strongest play.',
      summary: 'Buyer offered $30. History: accepted $38 in March.',
      recommendation: { action: 'counter', value: 38, reasoning: 'Accepted $38 previously' },
      actions: [
        { id: 'counter', label: 'Counter $38', action: 'counter', value: 38, style: 'primary' },
        { id: 'decline', label: 'Decline', action: 'decline', style: 'destructive' },
      ],
      version: 1,
    }, 'agent-primary');

    expect((await runtime.get(contract.id))?.surface?.version).toBe(2);

    // 8. Owner commits via resume token
    const tokenRow = storage._db()
      .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
      .get(contract.id);
    expect(tokenRow).toBeTruthy();

    await runtime.resume(
      contract.id,
      tokenRow.token,
      humanResolver(),
      'counter',
      38,
      { draft_message: 'Would you accept $38? Happy to work with you.' }
    );
    expect((await runtime.get(contract.id))?.status).toBe('executing');
    expect((await runtime.get(contract.id))?.resume?.value).toBe(38);

    // 9. Token is consumed — replay rejected
    await expect(
      runtime.resume(contract.id, tokenRow.token, humanResolver(), 'counter', 38)
    ).rejects.toThrow();

    // 10. Agent completes
    let notified = null;
    runtime._notifier = { onComplete: async (c) => { notified = c; } };
    await runtime.transition(contract.id, 'complete', agentWriter());
    expect((await runtime.get(contract.id))?.status).toBe('complete');
    expect(notified?.id).toBe(contract.id);

    // 11. Full audit trail exists
    const log = await storage.queryLog(contract.id);
    const events = log.map(e => e.event);
    expect(events).toContain('created');
    expect(events.some(e => e.includes('active'))).toBe(true);
    expect(events.some(e => e.includes('waiting_approval'))).toBe(true);
    expect(events.some(e => e.includes('complete'))).toBe(true);
    expect(events).toContain('clarification:question');
    expect(events).toContain('clarification:answer');
  });
});
```

---

### `tests/integration/grant-report-draft.test.js` — Non-profit end-to-end

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeGrantContract, agentWriter, humanResolver } from '../helpers/fixtures.js';
import { grantReportDraftType } from '../../src/domain-types/grant-report-draft.js';
import { ContractValidationError } from '../../src/types/errors.js';

describe('grant-report-draft — full lifecycle', () => {
  let runtime, storage, cleanup;
  beforeEach(async () => {
    ({ runtime, storage, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(grantReportDraftType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  it('rejects draft with missing deadline', async () => {
    const c = makeGrantContract();
    delete c.intent.context.deadline;
    await expect(runtime.create(c)).rejects.toThrow(ContractValidationError);
  });

  it('full lifecycle: draft compiled, director reviews, edits artifact, commits', async () => {
    const contract = makeGrantContract({
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });

    await runtime.create(contract);
    await runtime.transition(contract.id, 'active', agentWriter());

    await runtime.updateSurface(contract.id, {
      voice_line: 'Q1 grant report for CCC is ready for your review. Deadline is April 15th.',
      summary: 'Q1 2026 grant report compiled from 2 Drive documents.',
      recommendation: {
        action: 'approve_and_submit',
        reasoning: 'All required metrics present. Word count within limit.',
      },
      actions: [
        { id: 'approve', label: 'Approve & Submit', action: 'approve_and_submit', style: 'primary' },
        { id: 'edit', label: 'Edit Draft', action: 'edit', opens_artifact: 'draft', style: 'secondary' },
      ],
      version: 0,
    }, 'agent-primary');

    await runtime.transition(contract.id, 'waiting_approval', agentWriter());
    await runtime.transition(contract.id, 'resolver_active', humanResolver());

    // Director reviews and commits with edited artifact
    const tokenRow = storage._db()
      .prepare('SELECT token FROM resume_tokens WHERE contract_id = ?')
      .get(contract.id);

    await runtime.resume(
      contract.id,
      tokenRow.token,
      humanResolver(),
      'approve_and_submit',
      undefined,
      { edited_report_path: 'projects/ccc-q1-report/draft-v2.md' }
    );

    expect((await runtime.get(contract.id))?.status).toBe('executing');
    expect((await runtime.get(contract.id))?.resume?.artifacts?.edited_report_path)
      .toBe('projects/ccc-q1-report/draft-v2.md');

    let notified = null;
    runtime._notifier = { onComplete: async (c) => { notified = c; } };
    await runtime.transition(contract.id, 'complete', agentWriter());

    expect((await runtime.get(contract.id))?.status).toBe('complete');
    expect(notified?.id).toBe(contract.id);

    const log = await storage.queryLog(contract.id);
    expect(log.length).toBeGreaterThanOrEqual(4); // created + transitions + resume
  });
});
```

---

### `tests/integration/connector-state.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';

describe('ConnectorState CRUD', () => {
  let storage, cleanup;
  beforeEach(async () => {
    ({ storage, cleanup } = makeTempRuntime());
    await storage.initialize();
  });
  afterEach(async () => { await storage.close(); cleanup(); });

  /** @returns {import('../../src/types/connector-state.js').ConnectorState} */
  function makeConnector(overrides = {}) {
    return {
      id: 'etsy',
      source: 'aura-connector',
      status: 'not-offered',
      capability_without: 'Agent cannot watch Etsy listings.',
      capability_with: 'Agent watches listings and surfaces price alerts.',
      never_resurface: false,
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('writes and reads back a connector', async () => {
    const c = makeConnector();
    await storage.writeConnector(c);
    const result = await storage.readConnector('etsy');
    expect(result?.id).toBe('etsy');
    expect(result?.status).toBe('not-offered');
    expect(result?.never_resurface).toBe(false);
  });

  it('upserts on conflict: updates status and updated_at', async () => {
    await storage.writeConnector(makeConnector());
    const updated = makeConnector({ status: 'active', connected_at: new Date().toISOString() });
    await storage.writeConnector(updated);
    const result = await storage.readConnector('etsy');
    expect(result?.status).toBe('active');
    expect(result?.connected_at).toBeTruthy();
  });

  it('readConnectors() returns all connectors', async () => {
    await storage.writeConnector(makeConnector({ id: 'etsy' }));
    await storage.writeConnector(makeConnector({ id: 'poshmark', source: 'aura-connector' }));
    const all = await storage.readConnectors();
    expect(all.length).toBe(2);
    expect(all.map(c => c.id).sort()).toEqual(['etsy', 'poshmark']);
  });

  it('readConnector() returns null for unknown id', async () => {
    expect(await storage.readConnector('unknown')).toBeNull();
  });

  it('stores never_resurface as boolean, not integer', async () => {
    await storage.writeConnector(makeConnector({ never_resurface: true }));
    const result = await storage.readConnector('etsy');
    expect(result?.never_resurface).toBe(true);
    expect(typeof result?.never_resurface).toBe('boolean');
  });

  it('stores and retrieves optional encrypted token fields', async () => {
    const connector = makeConnector({
      id: 'gmail-agent',
      source: 'openclaw-channel',
      status: 'active',
      oauth_token_enc: 'enc:abc123',
      refresh_token_enc: 'enc:def456',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    await storage.writeConnector(connector);
    const result = await storage.readConnector('gmail-agent');
    expect(result?.oauth_token_enc).toBe('enc:abc123');
    expect(result?.refresh_token_enc).toBe('enc:def456');
    expect(result?.expires_at).toBeTruthy();
  });
});
```

---

### `tests/integration/hierarchy.test.js`

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRuntime } from '../helpers/temp-db.js';
import { makeContract, agentWriter } from '../helpers/fixtures.js';
import { offerReceivedType } from '../../src/domain-types/offer-received.js';

describe('Hierarchy: parent/child linking', () => {
  let runtime, cleanup;
  beforeEach(async () => {
    ({ runtime, cleanup } = makeTempRuntime());
    await runtime.initialize();
    runtime.registerType(offerReceivedType);
  });
  afterEach(async () => { await runtime.shutdown(); cleanup(); });

  async function parentInExecuting() {
    const parent = makeContract();
    await runtime.create(parent);
    await runtime.transition(parent.id, 'active', agentWriter());
    await runtime.transition(parent.id, 'waiting_approval', agentWriter());
    await runtime.transition(parent.id, 'resolver_active', { id: 'owner', type: 'human' });
    await runtime.transition(parent.id, 'executing', agentWriter());
    return parent;
  }

  it('spawnSubtask creates child with correct parent_id', async () => {
    const parent = await parentInExecuting();
    const child = makeContract();
    await runtime.spawnSubtask(parent.id, child, agentWriter());
    const savedChild = await runtime.get(child.id);
    expect(savedChild?.parent_id).toBe(parent.id);
  });

  it('spawnSubtask transitions parent executing → active', async () => {
    const parent = await parentInExecuting();
    await runtime.spawnSubtask(parent.id, makeContract(), agentWriter());
    expect((await runtime.get(parent.id))?.status).toBe('active');
  });

  it('parent child_ids includes spawned child', async () => {
    const parent = await parentInExecuting();
    const child = makeContract();
    await runtime.spawnSubtask(parent.id, child, agentWriter());
    const savedParent = await runtime.get(parent.id);
    expect(savedParent?.child_ids).toContain(child.id);
  });

  it('multiple subtasks accumulate in child_ids', async () => {
    const parent = await parentInExecuting();
    const child1 = makeContract();
    await runtime.spawnSubtask(parent.id, child1, agentWriter());
    // Re-advance parent to executing for second spawn
    await runtime.transition(parent.id, 'waiting_approval', agentWriter());
    await runtime.transition(parent.id, 'resolver_active', { id: 'owner', type: 'human' });
    await runtime.transition(parent.id, 'executing', agentWriter());
    const child2 = makeContract();
    await runtime.spawnSubtask(parent.id, child2, agentWriter());
    const savedParent = await runtime.get(parent.id);
    expect(savedParent?.child_ids?.length).toBe(2);
    expect(savedParent?.child_ids).toContain(child1.id);
    expect(savedParent?.child_ids).toContain(child2.id);
  });

  it('child contract traverses its state machine independently', async () => {
    const parent = await parentInExecuting();
    const child = makeContract();
    await runtime.spawnSubtask(parent.id, child, agentWriter());
    await runtime.transition(child.id, 'active', agentWriter());
    await runtime.transition(child.id, 'complete', agentWriter());
    expect((await runtime.get(child.id))?.status).toBe('complete');
    // Parent not affected
    expect((await runtime.get(parent.id))?.status).toBe('active');
  });

  it('spawnSubtask appends log entries to both parent and child', async () => {
    const parent = await parentInExecuting();
    const child = makeContract();
    await runtime.spawnSubtask(parent.id, child, agentWriter());
    const childLog = await runtime._storage.queryLog(child.id);
    const parentLog = await runtime._storage.queryLog(parent.id);
    expect(childLog.some(e => e.event === 'created')).toBe(true);
    expect(parentLog.some(e => e.event.includes('executing→active'))).toBe(true);
  });
});
```

```json
{
  "name": "@aura/contract-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.js",
  "types": "src/index.d.ts",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "test":           "vitest run",
    "test:watch":     "vitest",
    "test:coverage":  "vitest run --coverage",
    "typecheck":      "tsc -p jsconfig.json --noEmit",
    "lint":           "eslint src tests",
    "lint:fix":       "eslint src tests --fix"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "globals": "^15.0.0"
  }
}
```

**Why no `better-sqlite3`:**
Node.js 24 ships `node:sqlite` as a stable built-in. No native addon to
compile, no version pinning, no `@types/better-sqlite3`. The synchronous
`DatabaseSync` API is functionally equivalent for this use case.

**Node 24 timing:**
Node.js 24 is expected to release in April 2026. Development targets the
RC (available March 2026). `node:sqlite` was experimental in Node 22.5+
and is stabilized in Node 24. The `engines` field enforces this requirement.

**OpenShell task schema:**
The technical research (Section 07, follow-up #1) recommended inspecting the
`tasks/` directory in `github.com/NVIDIA/OpenShell` before finalizing the contract
schema. The OpenShell sandbox is Linux-only and not relevant to Phase 1 or Phase 2
(macOS target). The contract schema is considered finalized. If Linux deployment
becomes a target, compare the `BaseContract` shape against OpenShell task primitives
before extending the schema.

**Why `"types": "src/index.d.ts"`:**
Handwritten `.d.ts` files sit alongside their `.js` counterparts in
`src/`. The `"types"` field allows Phase 2 workspace consumers importing
`@aura/contract-runtime` to resolve all public types from the entry point
without reaching into `src/` internals.

**Why `typescript` in devDependencies even for a JS project:**
`tsc` reads JSDoc `@import` annotations and validates the JS files against
the handwritten `.d.ts` declarations via `--checkJs --noEmit`. The project
never compiles `.js` to a different `.js` — `tsc` is purely a type checker.

---

## Definition of Done — Phase 1

Phase 1 is complete when all eleven criteria are true:

| # | Criterion |
|---|---|
| 1 | `npm test` passes with zero failures |
| 2 | `npm run typecheck` passes with zero errors |
| 3 | `npm run lint` passes with zero errors |
| 4 | `offer-received` end-to-end: all states including clarification round-trip and resume with artifact |
| 5 | `grant-report-draft` end-to-end: all states including resume with edited artifact |
| 6 | Signal timing test: `.signal` fires after commit, not before |
| 7 | Concurrent writes test: 10 parallel creates, 10 racing transitions — no corruption |
| 8 | Hierarchy test: `spawnSubtask()` links child, transitions parent `executing → active`, child traverses independently |
| 9 | ConnectorState test: write/upsert/read round-trip correct including `never_resurface` boolean coercion |
| 10 | No `@ts-ignore` or `// @ts-nocheck` in `src/` |
| 11 | No import from any `openclaw/*` path anywhere in `packages/contract-runtime/` |

Only after all eleven criteria are met does Phase 2 begin.

---

## What Phase 2 Picks Up

Phase 2 adds `packages/openclaw-plugin/` alongside this package.

The plugin imports `@aura/contract-runtime` as a workspace dependency.
Zero changes to this package are required. The plugin provides:

- `setup-entry.js` — HTTP route for Pulse PWA static files (`registerHttpRoute`)
- `index.js` — `ContractRuntime` as a `registerService`, WebSocket server on port 7700, all `aura_*` tools
- `SignalWatcher` — the debounced `.signal` watcher (75ms debounce, `updated_at > last_checked_at` query)
- Engram SDK compatibility check before integration (per technical research Decision 7)
- `EngramCompletionNotifier` implementing `CompletionNotifier` — replaces `NoOpCompletionNotifier`

All SDK imports in the plugin use `openclaw/plugin-sdk/*` subpaths only.
`openclaw/extension-api` and `openclaw/plugin-sdk/compat` are never used.

---

*Phase 1 Code Plan v2.5 — March 26, 2026*
*Language: JavaScript + JSDoc + handwritten .d.ts | Tests: Vitest | Modules: ESM | SQLite: node:sqlite (Node 24)*
*No code written before this document. Code begins with Phase 1.*
*Changes to this document require explicit version bump.*
