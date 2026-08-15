// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
type SetEnabledResult =
  | { readonly ok: true; readonly value: { readonly ok: true; readonly value: typeof EMPTY } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  const setEnabled = vi.fn<(request: unknown) => Promise<SetEnabledResult>>()
    .mockResolvedValue({ ok: true, value: { ok: true, value: EMPTY } })
  ctx.provide('remote.pluginInventory', { list, setEnabled })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, setEnabled }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory'])
  })

  it('registers localized custom and complete tabs without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entries = b.slots.entries('settings.plugins.tab')
    expect(entries).toHaveLength(2)
    const custom = entries.find(entry => entry.options.id === 'custom')!
    const all = entries.find(entry => entry.options.id === 'all')!
    expect(custom.component).toBe(PluginInventorySettingsTab)
    expect(custom.options).toMatchObject({ id: 'custom', order: 10 })
    expect(custom.locale).toBe(NS)
    expect(resolveSlotLabel(custom.options.label)).toBe('自建插件')
    expect(all.component).toBe(PluginInventorySettingsTab)
    expect(all.options).toMatchObject({ id: 'all', order: 20 })
    expect(all.locale).toBe(NS)
    expect(resolveSlotLabel(all.options.label)).toBe('插件列表')
    expect(b.list).not.toHaveBeenCalled()

    const customInjected = (custom.inject as unknown as () => PluginInventorySettingsTabInjected)()
    const allInjected = (all.inject as unknown as () => PluginInventorySettingsTabInjected)()
    expect(customInjected.view).toBe('custom')
    expect(allInjected.view).toBe('all')
    await expect(customInjected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(customInjected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')

    await expect(customInjected.setEnabled('some-id' as never, false)).resolves.toEqual({ ok: true, value: EMPTY })
    expect(b.setEnabled).toHaveBeenCalledWith({ entryId: 'some-id', enabled: false })
    b.setEnabled.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(customInjected.setEnabled('some-id' as never, false))
      .rejects.toThrow('pluginInventory.setEnabled failed: REMOTE_ERROR: unavailable')

    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(2) })
    b.locale.setLocale('en')
    expect(b.slots.entries('settings.plugins.tab').map(entry => resolveSlotLabel(entry.options.label)))
      .toEqual(['Custom plugins', 'Plugin list'])

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')).toHaveLength(2)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
