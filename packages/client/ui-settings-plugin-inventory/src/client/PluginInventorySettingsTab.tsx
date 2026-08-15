import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type {
  PluginInventorySnapshot,
  SetPluginEnabledFailure,
  SetPluginEnabledResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /**
   * Toggle one top-level entry's enablement. Resolves to the Host's typed
   * business outcome (a rejection is not an exception); only a transport
   * failure throws.
   */
  setEnabled: (entryId: PluginInventoryEntry['entryId'], enabled: boolean) => Promise<SetPluginEnabledResult>
  /** Select the full Loader inventory or only locally-authored packages. */
  view: PluginInventoryView
}

/** Inventory projection selected by one Settings tab contribution. */
export type PluginInventoryView = 'all' | 'custom'

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/**
 * Whether a Loader entry ships as part of the official `@deepseek-ai/`
 * catalog. `cordis:include` is the one framework primitive the official
 * `@deepseek-ai/dsh-base` bundle inserts under its own unscoped Cordis name
 * rather than an `@deepseek-ai/` package name.
 */
function isOfficialPlugin(entry: PluginInventoryEntry): boolean {
  return entry.moduleName.startsWith('@deepseek-ai/') || entry.moduleName === 'cordis:include'
}

/** Whether a Loader entry falls outside the official `@deepseek-ai/` catalog. */
function isCustomPlugin(entry: PluginInventoryEntry): boolean {
  return !isOfficialPlugin(entry)
}

const TOGGLE_ERROR_KEYS = {
  'not-found': 'toggleErrorNotFound',
  'protected': 'toggleErrorProtected',
  'no-patch-layer': 'toggleErrorNoPatchLayer',
} satisfies Record<SetPluginEnabledFailure['code'], PluginInventoryLocaleKey>

/** One row's in-flight or last-failed toggle, keyed by entry id; absent means idle. */
type ToggleState =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly messageKey: PluginInventoryLocaleKey }

/** Render the current Loader inventory, with a toggle switch per top-level entry. */
export function PluginInventorySettingsTab({ list, setEnabled, t, view }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [toggles, setToggles] = useState<ReadonlyMap<PluginInventoryEntry['entryId'], ToggleState>>(new Map())

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const toggle = async (entry: PluginInventoryEntry): Promise<void> => {
    const id = entry.entryId
    setToggles(prev => new Map(prev).set(id, { status: 'pending' }))
    let result: SetPluginEnabledResult
    try {
      result = await setEnabled(id, !entry.enabled)
    } catch {
      setToggles(prev => new Map(prev).set(id, { status: 'error', messageKey: 'toggleErrorTransport' }))
      return
    }
    if (result.ok) {
      setState({ status: 'ready', snapshot: result.value })
      setToggles((prev) => {
        if (!prev.has(id)) return prev
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    } else {
      setToggles(prev => new Map(prev).set(id, { status: 'error', messageKey: TOGGLE_ERROR_KEYS[result.error.code] }))
    }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => view === 'all' || isCustomPlugin(entry))
      : [],
    [state, view],
  )
  const filteredEntries = useMemo(
    () => visibleEntries.filter(entry => matches(entry, normalizedQuery)),
    [normalizedQuery, visibleEntries],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          {view === 'custom' ? <p className={css.status}>{t('customIntro')}</p> : null}
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.catalogHeading}>
            <h3>{t(view === 'custom' ? 'customCatalog' : 'catalog')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {visibleEntries.length === 0
            ? <p className={css.status}>{t(view === 'custom' ? 'customEmpty' : 'empty')}</p>
            : null}
          {visibleEntries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                const toggleState = toggles.get(entry.entryId)
                const togglePending = toggleState?.status === 'pending'
                const toggleLabel = `${entry.enabled ? t('toggleOff') : t('toggleOn')} ${title}`
                return (
                  <li
                    className={css.card}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-open={open ? 'true' : undefined}
                  >
                    <div className={css.cardContent}>
                      <button
                        className={css.cardExpandButton}
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                        onClick={() => {
                          setExpanded(current => current === entry.entryId ? null : entry.entryId)
                        }}
                      >
                        <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                        <span className={css.cardTrailing}>
                          {entry.enabled ? (
                            <span
                              className={css.statusDot}
                              data-phase={entry.fiberPhase ?? 'unobserved'}
                              role="img"
                              aria-label={status}
                              title={status}
                            />
                          ) : null}
                          <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                        </span>
                      </button>
                      <button
                        className={css.toggle}
                        type="button"
                        role="switch"
                        aria-checked={entry.enabled}
                        aria-label={toggleLabel}
                        title={toggleLabel}
                        disabled={togglePending}
                        data-pending={togglePending ? 'true' : undefined}
                        onClick={() => { void toggle(entry) }}
                      >
                        <span className={css.toggleTrack} data-on={entry.enabled || undefined} aria-hidden="true">
                          <span className={css.toggleThumb} />
                        </span>
                      </button>
                    </div>
                    {toggleState?.status === 'error' ? (
                      <p className={css.toggleError} role="alert">{t(toggleState.messageKey)}</p>
                    ) : null}
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('configuration')}</dt>
                            <dd>{configuration}</dd>
                          </div>
                          {entry.enabled ? (
                            <div>
                              <dt>{t('cordis')}</dt>
                              <dd>{status}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
