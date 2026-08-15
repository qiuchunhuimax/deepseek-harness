// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
  PluginInventoryView,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(
  list: PluginInventorySettingsTabInjected['list'],
  view: PluginInventoryView = 'all',
  setEnabled: PluginInventorySettingsTabInjected['setEnabled'] = vi.fn(),
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    setEnabled,
    view,
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
    { entryId: 'custom-ocr', moduleName: '@dsh-external/dsh-paddle-ocr', enabled: true, fiberPhase: 'active' },
    { entryId: 'custom-skin', moduleName: '@dsh-external/dsh-client-ui-skin-pokemon', enabled: false, fiberPhase: null },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('9')
    expect(screen.getAllByRole('listitem')).toHaveLength(9)
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getAllByRole('img', { name: value }).length).toBeGreaterThan(0)
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(1)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('projects every plugin outside the official @deepseek-ai/ catalog in the custom view', async () => {
    const view = render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, 'custom')} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    expect(screen.getByText(en.customIntro)).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.customCatalog })).toBeTruthy()
    // 9 fixture entries minus the 2 official @deepseek-ai/ rows (hmr, directory-picker-native).
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getByText('paddle-ocr')).toBeTruthy()
    expect(screen.getByText('ui-skin-pokemon')).toBeTruthy()
    expect(screen.getByText('pending-name')).toBeTruthy()
    expect(screen.queryByText('hmr')).toBeNull()
    expect(screen.queryByText('directory-picker-native')).toBeNull()

    fireEvent.change(search, { target: { value: 'pokemon' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'deepseek-ai' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows the custom empty state when only official plugins exist', async () => {
    const builtIns = {
      entries: SNAPSHOT.entries.filter(entry => entry.moduleName.startsWith('@deepseek-ai/')),
    } as Snapshot
    render(<PluginInventorySettingsTab {...props(async () => builtIns, 'custom')} />)

    expect(await screen.findByText(en.customEmpty)).toBeTruthy()
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('toggles a plugin on click and adopts the returned snapshot', async () => {
    const toggled = {
      entries: SNAPSHOT.entries.map(entry => entry.entryId === '8a1b2c3d' ? { ...entry, enabled: false, fiberPhase: null } : entry),
    } as unknown as Snapshot
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockResolvedValue({ ok: true, value: toggled })
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, 'all', setEnabled)} />)

    const toggle = await screen.findByRole('switch', { name: 'Disable hmr' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledWith('8a1b2c3d', false)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Enable hmr' }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('marks a toggle pending while in flight and disables it against a second click', async () => {
    const deferred = Promise.withResolvers<Awaited<ReturnType<PluginInventorySettingsTabInjected['setEnabled']>>>()
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>(() => deferred.promise)
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, 'all', setEnabled)} />)

    const toggle = await screen.findByRole('switch', { name: 'Disable hmr' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('data-pending')).toBe('true')
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledOnce()

    await act(async () => { deferred.resolve({ ok: true, value: SNAPSHOT }) })
    expect(toggle.getAttribute('data-pending')).toBeNull()
  })

  it('shows an inline message and keeps the prior state when the Host rejects a toggle', async () => {
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockResolvedValue({ ok: false, error: { code: 'protected' } })
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, 'all', setEnabled)} />)

    const toggle = await screen.findByRole('switch', { name: 'Disable hmr' })
    fireEvent.click(toggle)

    expect(await screen.findByText(en.toggleErrorProtected)).toBeTruthy()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('shows a transport-failure message when the injected call itself rejects', async () => {
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockRejectedValue(new Error('private transport detail'))
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, 'all', setEnabled)} />)

    const toggle = await screen.findByRole('switch', { name: 'Disable hmr' })
    fireEvent.click(toggle)

    expect(await screen.findByText(en.toggleErrorTransport)).toBeTruthy()
    expect(screen.queryByText('private transport detail')).toBeNull()
  })

  it('toggles a nested-shaped entry id (a real production row) like any other', async () => {
    // A real deployment's plugin ids are nested at least one level (the
    // running app's own patch-file Include), so the switch must not treat a
    // `:`-containing entryId as unsupported.
    const nestedShaped = {
      entries: [
        { entryId: 'include:paddle-ocr', moduleName: '@dsh-external/dsh-paddle-ocr', enabled: true, fiberPhase: 'active' },
      ],
    } as unknown as Snapshot
    const toggled = {
      entries: [{ ...nestedShaped.entries[0], enabled: false, fiberPhase: null }],
    } as unknown as Snapshot
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockResolvedValue({ ok: true, value: toggled })
    render(<PluginInventorySettingsTab {...props(async () => nestedShaped, 'all', setEnabled)} />)

    const toggle = await screen.findByRole('switch', { name: 'Disable paddle-ocr' })
    expect((toggle as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledWith('include:paddle-ocr', false)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Enable paddle-ocr' }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})
