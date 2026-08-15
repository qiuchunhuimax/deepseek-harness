import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}

/** Request to change one entry's persisted enablement. */
export interface SetPluginEnabledRequest {
  readonly entryId: PluginEntryId
  readonly enabled: boolean
}

/** Reason a {@link SetPluginEnabledRequest} was rejected without an exception. */
export type SetPluginEnabledFailure =
  /** No Loader entry with this id is currently mounted. */
  | { readonly code: 'not-found' }
  /** Disabling this id would break the web server or the Settings UI itself. */
  | { readonly code: 'protected' }
  /** This composition has no writable profile patch layer to persist the change into. */
  | { readonly code: 'no-patch-layer' }

/** Outcome of one {@link SetPluginEnabledRequest}. */
export type SetPluginEnabledResult =
  | { readonly ok: true; readonly value: PluginInventorySnapshot }
  | { readonly ok: false; readonly error: SetPluginEnabledFailure }
