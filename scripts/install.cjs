#!/usr/bin/env node
/**
 * 将 dsh-remote-control 安装到 DSH web profile —— 等价于
 *   dsh plugin --profile web add <本仓库>
 * 但无需 dsh CLI 在 PATH 上：在 web profile 目录执行 `pnpm add <repo>`，
 * 并自动把 dsh-remote-control 追加进 profile 的 dsh.profile.bundles（若缺）。
 *
 * 用法： node scripts/install.cjs
 * 生效：安装后需重启 dsh web，设置 → 插件 页才会出现 remote-control。
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const repo = path.resolve(__dirname, '..')
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profile = path.join(home, 'profiles', 'web')
const manifestPath = path.join(profile, 'package.json')

if (!fs.existsSync(manifestPath)) {
  console.error(`[dsh-remote-control] 未找到 web profile 清单: ${manifestPath}`)
  process.exit(2)
}

let out = ''
try {
  out = execFileSync('cmd.exe', ['/c', 'pnpm', 'add', `"${repo}"`], {
    cwd: profile,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
} catch (error) {
  console.error('[dsh-remote-control] pnpm add 失败: ' + error.message)
  if (error.stdout) process.stderr.write(String(error.stdout))
  if (error.stderr) process.stderr.write(String(error.stderr))
  process.exit(3)
}
console.log('[pnpm] ' + (out || '').trim())

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
const bundles = manifest.dsh.profile.bundles || []
if (!bundles.includes('dsh-remote-control')) {
  bundles.push('dsh-remote-control')
  manifest.dsh.profile.bundles = bundles
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}
console.log('[dsh-remote-control] profile bundles 现为: ' + JSON.stringify(manifest.dsh.profile.bundles || []))
console.log('[dsh-remote-control] 完成。重启 dsh web 后，设置 → 插件 页会出现 remote-control。')
