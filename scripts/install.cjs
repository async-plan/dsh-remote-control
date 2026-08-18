#!/usr/bin/env node
/**
 * 将 dsh-remote-control 安装到 DSH web profile（等价于
 *   dsh plugin --profile web add <本仓库>
 * 但无需 dsh CLI/pnpm 在 PATH 上，也规避路径含空格时的引号问题）：
 *   1. 在 $DSH_HOME/profiles/web/node_modules 下创建 junction 链接 → 本仓库
 *   2. 把 dsh-remote-control 追加进 profile 的 dsh.profile.bundles（若缺）
 *   3. 在 profile.dependencies 记录 dsh-remote-control（便于后续 dsh plugin 认知）
 *
 * 用法： node scripts/install.cjs
 * 生效：安装后需重启 dsh web，设置 → 插件 页才会出现 remote-control。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const repo = path.resolve(__dirname, '..')
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profile = path.join(home, 'profiles', 'web')
const manifestPath = path.join(profile, 'package.json')
const link = path.join(profile, 'node_modules', 'dsh-remote-control')

if (!fs.existsSync(manifestPath)) {
  console.error(`[dsh-remote-control] 未找到 web profile 清单: ${manifestPath}`)
  process.exit(2)
}

fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true })
if (fs.existsSync(link)) {
  console.log('[dsh-remote-control] node_modules/dsh-remote-control 已存在，跳过链接创建')
} else {
  try {
    fs.symlinkSync(repo, link, 'junction')
    console.log(`[dsh-remote-control] 已创建链接: ${link} -> ${repo}`)
  } catch (error) {
    console.error('[dsh-remote-control] 创建链接失败: ' + error.message)
    process.exit(3)
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
const bundles = manifest.dsh.profile.bundles || []
if (!bundles.includes('dsh-remote-control')) {
  bundles.push('dsh-remote-control')
}
manifest.dsh.profile.bundles = bundles
manifest.dependencies = manifest.dependencies || {}
manifest.dependencies['dsh-remote-control'] = 'link:' + repo
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

console.log('[dsh-remote-control] profile bundles 现为: ' + JSON.stringify(bundles))
console.log('[dsh-remote-control] 完成。重启 dsh web 后，设置 → 插件 页会出现 remote-control。')
