#!/usr/bin/env node
/**
 * scripts/run-tests.mjs
 *
 * 为什么需要它（前面踩过的坑合集）：
 *   1. `node --test "tests-dist/*.spec.js"` —— 加引号后 Node 不展开 glob，
 *      会当成一个不存在的文件：收集 0 个用例、退出码 0（假绿！）；
 *   2. `node --test tests-dist/` —— 在某些 Node/Windows 组合下被当成「要加载的模块」，
 *      报 MODULE_NOT_FOUND: Cannot find module 'D:\...\tests-dist'；
 *   3. Node runner 的目录收集只认 *.test.js / *-test.js / test-*.js。
 *
 * 因此这里不依赖任何 shell 或 Node 的 glob 行为：自己读目录、自己校验，
 * 把「真实存在的文件绝对路径」作为参数交给 Node，并强制要求至少 1 个测试文件
 * （否则以非零码退出，杜绝 0 用例假绿）。
 *
 * 前置：pnpm build:tests（tsc -p tsconfig.tests.json）已把 src + tests 编译到 tests-dist/。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dir = join(root, 'tests-dist')

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`[run-tests] 找不到编译后的测试目录：${dir}`)
  console.error('[run-tests] 请先执行：pnpm build:tests')
  process.exit(1)
}

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.spec.js'))
  .map((name) => join(dir, name))
  .sort()

if (files.length === 0) {
  console.error(`[run-tests] ${dir} 下没有任何 *.spec.js`)
  console.error('[run-tests] 请确认 tests/*.spec.ts 存在，且 tsconfig.tests.json 的 include/exclude 正确')
  process.exit(1)
}

console.log(`[run-tests] 即将运行 ${files.length} 个测试文件：`)
for (const file of files) console.log(`  - ${file.slice(root.length + 1)}`)

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
})

if (result.error !== undefined) {
  console.error(`[run-tests] 启动 node --test 失败：${String(result.error)}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
