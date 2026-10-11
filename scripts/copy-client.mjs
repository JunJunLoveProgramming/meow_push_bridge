#!/usr/bin/env node
/**
 * scripts/copy-client.mjs
 *
 * 客户端半体（src/client.js）是**手写的预构建 bundle**，格式为
 * `window.__ModuleLoader__.load({ id, factory })`。DSH 的客户端模块系统会
 * 直接读取 package.json 的 `exports["./client"]` 指向的文件字节，
 * 所以这里不需要任何打包工具，只需把它复制到 lib/client.js。
 *
 * 为何不放进 dist/：dist 由 tsc 生成且带 .d.ts；客户端 bundle 不是 tsc 产物，
 * 两者混在一起容易在清理 dist 时被误删。
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = join(root, 'src', 'client.js')
const target = join(root, 'lib', 'client.js')

// 组装前自检：bundle 必须是我们预期的模块装载器格式
const text = await readFile(source, 'utf8')
if (!text.includes('window.__ModuleLoader__.load(')) {
  console.error('[copy-client] src/client.js 不是 __ModuleLoader__ 格式，DSH 会拒绝加载。')
  process.exit(1)
}
if (!text.includes("id: 'meow-push-bridge'")) {
  console.error('[copy-client] src/client.js 的模块 id 必须是 meow-push-bridge。')
  process.exit(1)
}

await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
console.log(`[copy-client] src/client.js → lib/client.js（${text.length} 字节）`)
