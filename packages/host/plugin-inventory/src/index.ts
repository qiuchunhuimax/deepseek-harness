/** Read-only projection, plus a narrow write path, of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
// Side-effect: brings in the ambient `ctx.loader` augmentation.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { persistPluginDisabled } from './persist-disabled.ts'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  SetPluginEnabledRequest,
  SetPluginEnabledResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Absolute path of the booted profile's own `cordis.patch.yml`, provided
     * by `@deepseek-ai/dsh-app-boot` (duplicated here, not imported, so this
     * package takes no dependency on the app-boot layer for one optional
     * field). Absent in compositions the product CLI did not boot.
     */
    dshProfilePatchPath?: string
  }
}

/**
 * Ids whose disablement would break the web server or the Settings UI itself
 * (self-lockout), unrecoverable from the browser once it happens.
 */
const PROTECTED_IDS = new Set([
  'webserver',
  'web-startup',
  'web-runtime',
  'cordis-host-runner',
  'plugin-inventory',
  'ui-settings-plugin-inventory',
])

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Toggle one entry's enablement, live and durably: applies the change to
   * the running Loader immediately by its full Loader-tree id (matching
   * {@link list}'s `enabled` field without waiting on file-watch HMR), then
   * persists a `{ id, disabled }` override — keyed by the entry's *raw*,
   * unprefixed local id (`entry.options.id`), the same id shape every
   * hand-written `cordis.patch.yml` override in this codebase already uses —
   * into the profile's patch file so the change survives a restart. The two
   * mechanisms compute the same target value from the same request, so
   * applying both is idempotent — a later file-watch reconciliation of the
   * same value is a no-op.
   *
   * Refuses the small set of entries whose disablement would brick the web
   * server or this Settings surface itself.
   * @param request - the target entry (its full Loader-tree id) and its next enablement.
   * @returns the refreshed inventory, or a typed rejection reason.
   */
  @Remote('setEnabled')
  async setEnabled(request: SetPluginEnabledRequest): Promise<SetPluginEnabledResult> {
    const fullId = request.entryId as string
    const entry = [...this.ctx.loader.entries()].find(candidate => candidate.id === fullId)
    if (entry === undefined) return { ok: false, error: { code: 'not-found' } }
    const rawId = entry.options.id
    if (PROTECTED_IDS.has(rawId)) return { ok: false, error: { code: 'protected' } }
    const patchPath = this.ctx.dshProfilePatchPath
    if (patchPath === undefined) return { ok: false, error: { code: 'no-patch-layer' } }
    const disabled = !request.enabled
    await this.ctx.loader.update(fullId, { disabled })
    await persistPluginDisabled(patchPath, rawId, disabled)
    return { ok: true, value: this.list() }
  }
}

export default PluginInventoryGateway
