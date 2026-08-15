# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

Read-only **Custom plugins** and **Plugin list** tabs for Web Settings. The browser plugin registers localized `settings.plugins.tab` contributions with ids `custom` and `all`; the Plugins section owns the navigation entry and tab chrome. It performs no Remote read during plugin activation. Selecting either tab for the first time mounts it and lazily calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md).

Both tabs render a searchable two-column catalog of compact disclosure cards. **Custom plugins** projects entries whose exact module name begins with the local authoring convention `@dsh-external/`; **Plugin list** keeps the complete Loader view. Each collapsed card uses the short module name as its title and a small effective-enablement tag; enabled entries also show a colored root-fiber status dot. Expanding one card reveals its Loader-tree entry id without a redundant field label, followed by the effective configuration and, for enabled entries, Cordis status. Disabled entries omit the redundant unmounted runtime state. The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details. The registrations use `ctx.slots.inject()`, so they follow late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes a Host-owned deployment snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per tab mount or retry** — the tabs do not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves each mounted snapshot, while reopening Settings obtains new snapshots as the tabs are selected.
- **Namespace-based local ownership** — the custom view intentionally treats only `@dsh-external/*` modules as locally authored; it does not infer ownership from filesystem or Git installation details.
- **Read-only Loader view** — local search does not add current-browser activation diagnosis or plugin mutation controls.
