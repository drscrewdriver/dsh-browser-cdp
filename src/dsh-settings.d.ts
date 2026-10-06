// Ambient declaration for the OPTIONAL peer @deepseek-ai/dsh-settings.
// The host provides the module on every supported line (0.1.0-rc.x through
// 0.2.0-rc.x); the plugin only touches the legacy module-level surface that
// exists on 0.1.0/0.1.1 (installSettingsSection + settingsNamespace). The
// package is intentionally NOT a devDependency: pinning it would drag host
// packages from conflicting lines into npm resolution.
declare module '@deepseek-ai/dsh-settings' {
  export const installSettingsSection:
    | ((owner: unknown, ns: unknown, schema: unknown, entry: unknown, hooks: unknown) => void)
    | undefined
  export const settingsNamespace: ((ns: string) => unknown) | undefined
  export const SettingsConflictError: new (...args: any[]) => Error
  const SettingsProvider: any
  export { SettingsProvider as default }
  export const redactSecrets: ((value: unknown) => unknown) | undefined
}
