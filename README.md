# dsh-remote-control

让运行在电脑上的 **DeepSeek Harness（DSH）网页版** 在任何有网络的设备上可远程访问：完整网页版布局、手机横竖屏适配、令牌登录门、一键公网隧道。体验对齐 Codex 的远程控制。

> 社区插件（动态 Cordis 插件形态），非官方产品。本插件**不收集、不上传任何数据**：访问令牌由插件在本地随机生成，所有流量只经过你自己的加密隧道，源码中不含任何个人路径或凭据。

## 特性

- **完整网页版远程入口**：公网/局域网访问到的就是 DSH 网页版本体（会话、消息流、实时更新、工具卡片、详情面板），而不是精简替代页。
- **令牌登录门**：首次访问 `?token=…` 后 302 跳转并种下 HttpOnly Cookie，令牌从地址栏移除；未登录只看到登录页，API 一律 401。
- **移动端适配**：向网页版注入响应式样式——竖屏侧栏收成图标栏、展开为全屏抽屉；详情面板打开时全屏展示；触屏隐藏拖拽把手；横竖屏通用。
- **一键公网隧道**：自动探测/下载 `cloudflared`（多镜像兜底），一键建立 `https://xxx.trycloudflare.com` 公网入口；也支持已配置的 ngrok。无需路由器端口映射、无需账号。
- **局域网入口**：同机网段设备可直接访问 `http://<主机IP>:8790`。
- **敏感接口拦截**：网关层拒绝 `credentials.*` 与 `settings.openDocument`，远程端无法读取凭据库或在主机上打开配置文档（本机使用不受影响）。
- **实时通道**：WebSocket 升级请求同样过登录门并转发，消息实时推送可用。
- **随插件生命周期自动清理**：停止/更新/删除插件会终止网关与隧道进程、撤销路由与样式注入。

## 架构

```
手机/平板（任意网络，浏览器）
        │ HTTPS
        ▼
cloudflared（插件 spawn；上游 8790）        ← 一键启动，URL 自动分配
        │ 127.0.0.1:8790
        ▼
node 网关（插件 spawn；监听 0.0.0.0:8790）  ← 登录门 + 完整转发
  ├─ 鉴权：Cookie dsh_rc=<token>，或首次 ?token= → 302 种 Cookie
  ├─ 拦截：/api/credentials.* 与 /api/settings.openDocument → 403
  ├─ 改写：Host → 127.0.0.1；剥离 Origin/Referer（通过 DSH 的 API 信任栅栏）
  └─ WebSocket 升级转发
        │ 127.0.0.1:3080
        ▼
DSH webServer
  ├─ SPA 网页版（含插件 tapIndex 注入的移动端适配样式）
  └─ 插件补充路由（令牌保护的精简控制页 + JSON API）
       /remote-control         控制页（发消息/停止/隧道开关）
       /remote-control/api     state / message / stop / tunnel
```

## 目录结构

```
dsh-remote-control/
├── index.js         # 静态 bundle 版宿主插件（注册到 设置→插件，持久化）
├── cordis.patch.yml # bundle 组合补丁（插入 remote-control 行）
├── package.json     # bundle 清单（dsh.bundle.patch 声明）
├── src/
│   ├── host.js       # 动态插件的 code.host（Host 半区：路由、网关、隧道）
│   └── client.js     # 动态插件的 code.client（Client 半区：Run 卡片面板）
├── LICENSE
└── README.md
```

## 静态安装（设置 → 插件 页可见、持久化）

仓库根目录的 `index.js` + `cordis.patch.yml` + `package.json` 构成一个 DSH **bundle 包**（`package.json` 声明 `dsh.bundle.patch`）。安装后插件会作为网页版组合树里的一行，出现在 **设置 → 插件** 页（可启用/停用、查看运行状态），并随 DSH 重启自动生效——不再是进程内临时插件。

1. 安装到 web profile（本机执行）：
   ```powershell
   dsh plugin --profile web add <本仓库路径>   # 例如 D:\...\dsh-remote-control
   ```
2. （推荐）固定令牌：设置环境变量 `DSH_REMOTE_TOKEN=<长随机串>`；未设置则每次启动随机生成并打印到宿主日志。
3. 重启网页版（`dsh web` 或重启 DSH）→ **设置 → 插件** 出现 `remote-control` 行。
4. 使用入口（令牌来自 `DSH_REMOTE_TOKEN`，否则见宿主日志）：
   - 局域网完整网页版：`http://<主机IP>:8790/?token=<令牌>`
   - 公网：控制页 `/remote-control/` 点「启动公网隧道」，得 `https://xxx.trycloudflare.com/?token=<令牌>`
   - 可选环境变量 `DSH_REMOTE_PORT` 覆盖端口（默认 8790）。

> 说明：静态 bundle 版不含动态 Run 卡片面板（面板是动态插件专用能力）；令牌/入口通过宿主日志与环境变量提供。若需要面板与一站式链接，用下方「快速开始」的动态版（进程内、DSH 重启即失）。

## 快速开始（动态版，会话内试用）

前置条件：电脑上运行着 DSH 网页版（`http://127.0.0.1:3080`），且机器装有 Node.js（用于网关子进程）。

1. 在 DSH 网页版的对话中新建一个动态 Cordis 插件（`cordis_define`）：
   - 插件 ID 前缀：`remctl`（或其他 3–6 位小写字母）；
   - `code.host` 粘贴 `src/host.js` 的完整内容；
   - `code.client` 粘贴 `src/client.js` 的完整内容。
2. 运行插件（`cordis_run`），并在弹出审批时允许（它会向网页版注册路由与 Run 卡片面板）。
3. 运行成功后，Run 卡片面板会显示：
   - **访问令牌**（20 位随机字符，令牌即密码）；
   - 本机网页版 / 局域网网页版 / 公网入口与隧道开关。
4. 点「启动公网隧道」：首次会自动下载 cloudflared（约 60MB，依次尝试 5 个镜像），随后面板出现 `https://xxx.trycloudflare.com`。
5. 手机（任意网络）打开 `https://xxx.trycloudflare.com/?token=<令牌>` → 登录门放行 → 完整网页版，横竖屏均可使用。

局域网用法：`http://<主机局域网IP>:8790/?token=<令牌>`（若 Windows 防火墙弹窗，允许 node）。

## 安全模型与注意事项

- **令牌即密码**：请勿公开分享带 `?token=` 的完整链接；令牌在首次跳转后即以 HttpOnly Cookie 承载，但链接本身仍可被他人使用。
- **远程端受限接口**：`credentials.describe/set/unset` 与 `settings.openDocument` 被网关拦截（403），因此远程的凭据/设置页部分功能不可用，属预期设计；主机本机使用完全不受影响。
- **公网地址随机且每次激活变化**：Quick Tunnel 特性；需要固定域名请自行改用 Named Tunnel（需 Cloudflare 账号）。
- **动态插件为进程内形态**：DSH 重启后插件消失，需重新定义运行；每次重建/更新都会生成新令牌。
- 本插件通过 DSH 内部 API 操作会话（发送/引导/停止），不对 DSH 源码做任何修改。

## 配置项（在 `src/host.js` 顶部常量区修改）

| 常量 | 默认 | 说明 |
|---|---|---|
| `BRIDGE_PORT` | `8790` | 网关监听端口（局域网/公网入口都用它） |
| 网关 `DENY` 列表 | `credentials.*`、`settings.openDocument` | 远程端被拦截的 DSH API 路径，可按需增减 |
| 隧道客户端探测 | `.dsh-tools\cloudflared.exe` → PATH `cloudflared` → PATH `ngrok` | 自动下载保存到工作区的 `.dsh-tools` 目录 |
| 下载镜像 | github 直连 + 4 个加速镜像 | 依次尝试，全部失败时提示手动安装 |
| Cookie 名 | `dsh_rc` | HttpOnly + SameSite=Lax |

## 常见问题

- **点「启动公网隧道」后停在"下载客户端中…"**：等待 1–3 分钟（60MB）；失败可手动 `winget install Cloudflare.cloudflared` 后点重试。
- **Cloudflare 在本网络不可达**：改用 Tailscale（`tailscale serve --bg 8790`，仅限你的设备）或 ngrok（登录配置后插件自动识别）。
- **远程设置页报错**：预期行为（敏感接口被拦截），见上文安全模型。
- **网页版打不开但登录页正常**：确认主机上 DSH 网页版（3080 端口）仍在运行。
- **插件停止后公网失效**：网关与隧道进程随插件停止而终止，属预期。

## 已知限制

- 精简控制页（`/remote-control`）是补充入口，完整功能请用完整网页版入口。
- 仅支持 Windows 主机（cloudflared 自动下载为 Windows 构建；网关脚本本身跨平台）。
- 令牌在首次 URL 中出现一次（跳转后移除）；仍应把链接当密码保管。

## 免责声明

本项目以 MIT 协议提供，无任何担保。将 DSH 暴露到公网存在安全风险，请自行评估：保持令牌保密、定期停止隧道、必要时叠加 Cloudflare Access 或 Tailscale 等额外防护。

## License

[MIT](./LICENSE)
