/**
 * Durable persistence for one id-targeted `disabled` override in a profile's
 * `cordis.patch.yml`. A comment-preserving read-modify-write under the
 * cross-process writer lock: patches an existing top-level row for `id` in
 * place when one exists, otherwise appends a fresh `{ id, disabled }` row.
 * Later rows win over earlier ones and over every bundle layer (the loader's
 * own composition semantics), so an appended row takes effect regardless of
 * where the entry itself was originally inserted.
 */

import { readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, parseDocument, YAMLMap, YAMLSeq } from 'yaml'

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Read `filename`, set `id`'s `disabled` field to `disabled`, and write the
 * result back atomically. Creates the file (as `[]`) when absent or blank.
 * @param filename - absolute path of the profile's `cordis.patch.yml`.
 * @param id - the target entry's raw (unprefixed) Loader id.
 * @param disabled - the next `disabled` value to persist.
 * @throws when the file exists but does not parse as a top-level YAML array.
 */
export async function persistPluginDisabled(filename: string, id: string, disabled: boolean): Promise<void> {
  await withFileLock(filename, async () => {
    let text: string
    try {
      text = await readFile(filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      text = '[]\n'
    }
    // An absent, empty, or comment-only file parses to a null document root;
    // reparsing the empty-array literal keeps `.contents` a real (Parsed)
    // YAMLSeq node instead of hand-constructing one, which the `yaml`
    // package's stricter Parsed-node types would reject on assignment.
    const document = parseDocument(text.trim().length === 0 ? '[]\n' : text)
    if (!(document.contents instanceof YAMLSeq)) {
      throw new Error(`plugin-inventory: ${filename} must be a top-level YAML array of patches`)
    }
    // Cast away the Parsed-node generics `yaml` infers for a parsed
    // document's contents: at this granularity (reading/writing one scalar
    // field of one row, or appending a freshly created row) they add
    // friction without adding safety, and `YAMLMap`/`YAMLSeq`'s methods
    // already unwrap and wrap scalars for us at runtime.
    const seq = document.contents as YAMLSeq
    const rows = seq.items.filter(isMap) as YAMLMap[]
    const existing = rows.find(row => row.get('id') === id)
    if (existing !== undefined) {
      existing.set('disabled', disabled)
    } else {
      seq.add(document.createNode({ id, disabled }))
    }
    await writeFileAtomic(filename, document.toString(), { mode: 0o600, dirMode: 0o700 })
  })
}
