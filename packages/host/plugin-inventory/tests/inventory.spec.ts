import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway from '../src/index.ts'
import type { PluginEntryId } from '../src/types.ts'

/** Brand a Loader-assigned id for a Remote call under test. */
function entryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

const contexts: Context[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempPatchPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-inventory-gateway-'))
  dirs.push(dir)
  return join(dir, 'cordis.patch.yml')
}

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(options: { patchPath?: string } = {}): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  if (options.patchPath !== undefined) ctx.provide('dshProfilePatchPath', options.patchPath)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  ctx.loader.builtins.group = Group
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes one direct list method under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual(expect.arrayContaining([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
    ]))
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  describe('setEnabled', () => {
    it('rejects a protected id, checked against the raw local id not the full one', async () => {
      const patchPath = await tempPatchPath()
      const { ctx, inventory } = await harness({ patchPath })
      // Cordis only auto-generates an id when the caller omits one (Loader
      // `ensureId`); an explicit id — the shape every real deployment's
      // bundle-declared row uses — is honored as-is despite `create`'s
      // narrower `Omit<EntryOptions, 'id'>` type.
      const webserverId = await ctx.loader.create({ id: 'webserver', name: 'cordis:active' } as never)
      const result = await inventory.setEnabled({ entryId: entryId(webserverId), enabled: false })
      expect(result).toEqual({ ok: false, error: { code: 'protected' } })
      // Refused before any write: the entry stays live and the file untouched.
      expect(inventory.list().entries.find(e => e.entryId === webserverId)).toMatchObject({ enabled: true })
      await expect(readFile(patchPath, 'utf8')).rejects.toThrow()
    })

    it('rejects an id with no matching entry', async () => {
      const { inventory } = await harness({ patchPath: await tempPatchPath() })
      const result = await inventory.setEnabled({ entryId: entryId('does-not-exist'), enabled: false })
      expect(result).toEqual({ ok: false, error: { code: 'not-found' } })
    })

    it('toggles an entry created inside a real cordis:group builtin', async () => {
      // A production composition nests every bundle-declared row at least
      // one level (the running app's own patch-file Include), which is what
      // originally surfaced this method's now-fixed bug: matching
      // `cordis.patch.yml` by an entry's full Loader-tree id instead of its
      // raw `entry.options.id` silently failed to persist anything for
      // every real plugin. `cordis:group` doesn't reproduce that id-prefix
      // shape in this harness, but this still proves toggling a nested
      // (non-root) entry succeeds rather than misfiring on group plumbing.
      const patchPath = await tempPatchPath()
      const { ctx, inventory } = await harness({ patchPath })
      const groupId = await ctx.loader.create({ name: 'cordis:group', group: true, config: [] } as never)
      const childId = await ctx.loader.create({ id: 'paddle-ocr', name: 'cordis:active' } as never, groupId)

      const result = await inventory.setEnabled({ entryId: entryId(childId), enabled: false })
      expect(result.ok).toBe(true)
      expect(inventory.list().entries.find(e => e.entryId === childId)).toMatchObject({ enabled: false })

      const text = await readFile(patchPath, 'utf8')
      expect(text).toContain('id: paddle-ocr')
    })

    it('rejects when the composition has no writable profile patch layer', async () => {
      const { ctx, inventory } = await harness()
      const activeId = await ctx.loader.create({ name: 'cordis:active' })
      expect(ctx.dshProfilePatchPath).toBeUndefined()
      const result = await inventory.setEnabled({ entryId: entryId(activeId), enabled: false })
      expect(result).toEqual({ ok: false, error: { code: 'no-patch-layer' } })
    })

    it('disables a top-level entry live and persists the override', async () => {
      const patchPath = await tempPatchPath()
      const { ctx, inventory } = await harness({ patchPath })
      const activeId = await ctx.loader.create({ name: 'cordis:active' })

      const result = await inventory.setEnabled({ entryId: entryId(activeId), enabled: false })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      expect(result.value.entries.find(entry => entry.entryId === activeId)).toMatchObject({
        enabled: false,
      })
      // Live effect is immediate, matching the returned snapshot.
      expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toMatchObject({
        enabled: false,
      })
      // Durable: a fresh read of the patch file carries the override.
      const text = await readFile(patchPath, 'utf8')
      expect(text).toContain(`id: ${activeId}`)
      expect(text).toContain('disabled: true')
    })

    it('re-enables an entry, patching its existing disabled row in place', async () => {
      const patchPath = await tempPatchPath()
      const { ctx, inventory } = await harness({ patchPath })
      const disabledId = await ctx.loader.create({ name: 'cordis:active', disabled: true })

      const result = await inventory.setEnabled({ entryId: entryId(disabledId), enabled: true })
      expect(result.ok).toBe(true)
      expect(inventory.list().entries.find(entry => entry.entryId === disabledId)).toMatchObject({
        enabled: true,
      })
      const text = await readFile(patchPath, 'utf8')
      expect(text.match(new RegExp(`id: ${disabledId}`, 'g'))).toHaveLength(1)
      expect(text).toContain('disabled: false')
    })
  })
})
