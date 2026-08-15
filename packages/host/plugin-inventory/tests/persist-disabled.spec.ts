import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistPluginDisabled } from '../src/persist-disabled.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempPatchFile(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-inventory-persist-'))
  dirs.push(dir)
  const filename = join(dir, 'cordis.patch.yml')
  if (content !== undefined) await writeFile(filename, content, 'utf8')
  return filename
}

describe('persistPluginDisabled', () => {
  it('creates an absent file as a fresh array with the appended row', async () => {
    const filename = await tempPatchFile()
    await persistPluginDisabled(filename, 'record-replay', true)
    const text = await readFile(filename, 'utf8')
    expect(text).toContain('id: record-replay')
    expect(text).toContain('disabled: true')
  })

  it('appends a new row after an existing array, preserving prior content and comments', async () => {
    const filename = await tempPatchFile([
      '# a hand-written comment worth keeping',
      '- id: deepseek-usage',
      '  config:',
      '    apiKeyEnv: DEEPSEEK_API_KEY',
      '',
    ].join('\n'))
    await persistPluginDisabled(filename, 'record-replay', true)
    const text = await readFile(filename, 'utf8')
    expect(text).toContain('# a hand-written comment worth keeping')
    expect(text).toContain('id: deepseek-usage')
    expect(text).toContain('apiKeyEnv: DEEPSEEK_API_KEY')
    expect(text).toContain('id: record-replay')
    expect(text).toContain('disabled: true')
  })

  it('patches an existing row for the same id in place instead of duplicating it', async () => {
    const filename = await tempPatchFile([
      '- id: record-replay',
      '  config:',
      '    runsOut: runs',
      '',
    ].join('\n'))
    await persistPluginDisabled(filename, 'record-replay', true)
    const text = await readFile(filename, 'utf8')
    expect(text.match(/id: record-replay/g)).toHaveLength(1)
    expect(text).toContain('runsOut: runs')
    expect(text).toContain('disabled: true')
  })

  it('flips an existing disabled row back to false in place', async () => {
    const filename = await tempPatchFile('- id: record-replay\n  disabled: true\n')
    await persistPluginDisabled(filename, 'record-replay', false)
    const text = await readFile(filename, 'utf8')
    expect(text.match(/id: record-replay/g)).toHaveLength(1)
    expect(text).toContain('disabled: false')
  })

  it('treats a blank file the same as an absent one', async () => {
    const filename = await tempPatchFile('   \n')
    await persistPluginDisabled(filename, 'record-replay', true)
    const text = await readFile(filename, 'utf8')
    expect(text).toContain('id: record-replay')
  })

  it('rejects a file that does not parse as a top-level array', async () => {
    const filename = await tempPatchFile('id: not-an-array\n')
    await expect(persistPluginDisabled(filename, 'record-replay', true))
      .rejects.toThrow('must be a top-level YAML array of patches')
  })
})
