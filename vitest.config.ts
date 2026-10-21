import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // react 是宿主提供的外部 peer，仓内不安装；测试拉入 client 模块时用桩顶替模块加载。
    alias: { react: fileURLToPath(new URL('./tests/stubs/react.mjs', import.meta.url)) },
  },
})
