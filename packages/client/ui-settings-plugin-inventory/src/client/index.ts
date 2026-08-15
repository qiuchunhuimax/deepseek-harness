/** Read-only Host plugin inventory registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  PluginInventorySettingsTab,
  type PluginInventorySettingsTabInjected,
  type PluginInventoryView,
} from './PluginInventorySettingsTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
  PluginInventoryView,
} from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (view: PluginInventoryView): PluginInventorySettingsTabInjected => ({ list, view })

  ctx.slots.inject('settings.plugins.tab', function* () {
    yield ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'custom',
      order: 10,
      label: () => t('customTab'),
      locale: NS,
      inject: () => injected('custom'),
    }, PluginInventorySettingsTab)
    yield ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'all',
      order: 20,
      label: () => t('tab'),
      locale: NS,
      inject: () => injected('all'),
    }, PluginInventorySettingsTab)
  })
}
