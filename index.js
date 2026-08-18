/**
 * dsh-remote-control —— 静态 bundle 版宿主插件。
 *
 * 让 DSH 网页版在局域网/公网可被完整远程使用：
 *  - 登录门网关（Cookie 令牌 / ?token= 302 跳转）转发全部请求到本机网页版
 *  - 令牌保护的精简控制页 /remote-control + JSON API
 *  - tapIndex 注入移动端适配样式（侧栏/详情全屏抽屉、代码块/表格内滚动、弹层限宽、安全区）
 *  - cloudflared/ngrok 一键公网隧道（自动下载，多镜像兜底）
 *
 * 与动态版（src/host.js）的差异：
 *  - 普通 cordis 插件（ESM 命名导出），随网页版 profile 组合树启动
 *  - 令牌来自环境变量 DSH_REMOTE_TOKEN（未设置则每次启动随机并打印到宿主日志）
 *  - 无动态 Client 面板（harness 专用），令牌/入口在日志与控制页可见
 *
 * @module dsh-remote-control
 */

export const name = 'dsh-remote-control'
export const inject = ['webServer', 'timer', 'subprocess']

const PAGE_HTML = '<!doctype html>\n'
  + '<html lang="zh-CN">\n'
  + '<head>\n'
  + '<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  + '<title>DSH 远程控制</title>\n'
  + '<style>\n'
  + ':root { color-scheme: dark; }\n'
  + '* { box-sizing: border-box; }\n'
  + 'body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0d1117; color: #e6edf3; }\n'
  + '#app { max-width: 880px; margin: 0 auto; padding: 16px 12px 120px; }\n'
  + 'header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }\n'
  + 'h1 { font-size: 20px; margin: 0; }\n'
  + '.badge { font-size: 12px; padding: 4px 10px; border-radius: 999px; }\n'
  + '.badge.ok { background: rgba(46,160,67,.18); color: #3fb950; }\n'
  + '.badge.err { background: rgba(248,81,73,.18); color: #f85149; }\n'
  + '.tokenbar, .tunnelbar { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #8b949e; margin-bottom: 12px; flex-wrap: wrap; }\n'
  + '.tokenbar input { flex: 1; background: #161b22; border: 1px solid #30363d; color: #e6edf3; border-radius: 6px; padding: 6px 8px; font: inherit; }\n'
  + '.tokenbar button, .tunnelbar button { padding: 6px 10px; font-size: 12px; }\n'
  + '.tunnelbar a { color: #58a6ff; word-break: break-all; }\n'
  + 'main { display: flex; flex-direction: column; gap: 14px; }\n'
  + '.sessions { display: flex; flex-direction: column; gap: 8px; }\n'
  + '.session { border: 1px solid #30363d; border-radius: 10px; padding: 10px 12px; cursor: pointer; background: #161b22; }\n'
  + '.session.selected { border-color: #58a6ff; box-shadow: 0 0 0 1px #58a6ff; }\n'
  + '.session .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }\n'
  + '.session .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n'
  + '.session .meta { font-size: 12px; color: #8b949e; margin-top: 4px; }\n'
  + '.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }\n'
  + '.dot.running { background: #3fb950; }\n'
  + '.dot.idle { background: #8b949e; }\n'
  + '.feed { border: 1px solid #30363d; border-radius: 10px; background: #161b22; min-height: 120px; max-height: 340px; overflow-y: auto; padding: 8px 10px; }\n'
  + '.evt { padding: 5px 0; border-bottom: 1px dashed #21262d; font-size: 13px; line-height: 1.5; }\n'
  + '.evt:last-child { border-bottom: none; }\n'
  + '.evt .who { font-size: 11px; color: #8b949e; margin-bottom: 2px; }\n'
  + '.evt.user .who { color: #58a6ff; }\n'
  + '.evt.assistant .who { color: #3fb950; }\n'
  + '.evt.tool .who { color: #d29922; }\n'
  + '.evt .body { white-space: pre-wrap; word-break: break-word; }\n'
  + '.empty { color: #8b949e; font-size: 13px; text-align: center; padding: 18px 0; }\n'
  + '#composer { position: fixed; left: 0; right: 0; bottom: 0; background: #0d1117; border-top: 1px solid #30363d; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); }\n'
  + '#composer .inner { max-width: 880px; margin: 0 auto; }\n'
  + '.modes { display: flex; gap: 14px; font-size: 13px; margin-bottom: 8px; }\n'
  + 'textarea { width: 100%; background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 10px; padding: 10px; font: inherit; font-size: 15px; resize: none; height: 64px; }\n'
  + 'textarea:focus { outline: none; border-color: #58a6ff; }\n'
  + '.buttons { display: flex; gap: 10px; margin-top: 8px; justify-content: flex-end; }\n'
  + 'button { font: inherit; font-size: 14px; padding: 8px 18px; border-radius: 8px; border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer; }\n'
  + 'button.primary { background: #1f6feb; border-color: #1f6feb; }\n'
  + 'button.danger { background: #b62324; border-color: #b62324; }\n'
  + 'button:disabled { opacity: .5; cursor: not-allowed; }\n'
  + '#status { font-size: 12px; color: #8b949e; margin-top: 10px; }\n'
  + '@media (min-width: 720px) { main { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; } }\n'
  + '</style>\n'
  + '</head>\n'
  + '<body>\n'
  + '<div id="app">\n'
  + '  <header><h1>DSH 远程控制</h1><span id="conn" class="badge err">未连接</span></header>\n'
  + '  <div class="tokenbar"><input id="token" placeholder="访问令牌 token"><button id="apply-token">应用</button><button id="copy-link">复制链接</button></div>\n'
  + '  <div class="tunnelbar"><span id="tunnel-status">公网：未启动</span><a id="tunnel-link" target="_blank" rel="noreferrer" style="display:none"></a><button id="tunnel-toggle">启动公网隧道</button></div>\n'
  + '  <main>\n'
  + '    <section class="sessions" id="sessions"></section>\n'
  + '    <section id="detail"><div class="feed" id="feed"></div></section>\n'
  + '  </main>\n'
  + '  <div id="status"></div>\n'
  + '</div>\n'
  + '<div id="composer"><div class="inner">\n'
  + '  <div class="modes"><label><input type="radio" name="mode" value="followup" checked> 新消息</label><label><input type="radio" name="mode" value="steer"> 引导当前回合</label></div>\n'
  + '  <textarea id="text" placeholder="输入内容，发送给选中的会话…（Ctrl+Enter 发送）"></textarea>\n'
  + '  <div class="buttons"><button id="stop" class="danger">停止当前回合</button><button id="send" class="primary">发送</button></div>\n'
  + '</div></div>\n'
  + '<script>\n'
  + '(function () {\n'
  + "  'use strict'\n"
  + '  var params = {};\n'
  + "  (location.search || '').slice(1).split('&').forEach(function (pair) {\n"
  + "    if (pair === '') return\n"
  + "    var eq = pair.indexOf('=')\n"
  + '    var k = eq === -1 ? pair : pair.slice(0, eq)\n'
  + "    var v = eq === -1 ? '' : pair.slice(eq + 1)\n"
  + '    try { params[decodeURIComponent(k)] = decodeURIComponent(v) } catch (e) {}\n'
  + '  })\n'
  + "  var token = params.token || ''\n"
  + "  var API = '/remote-control/api'\n"
  + '  var state = null\n'
  + '  var selectedId = null\n'
  + '  var busy = false\n'
  + "  var tokenInput = document.getElementById('token')\n"
  + "  var conn = document.getElementById('conn')\n"
  + "  var sessionsEl = document.getElementById('sessions')\n"
  + "  var feedEl = document.getElementById('feed')\n"
  + "  var statusEl = document.getElementById('status')\n"
  + "  var textEl = document.getElementById('text')\n"
  + "  var sendBtn = document.getElementById('send')\n"
  + "  var stopBtn = document.getElementById('stop')\n"
  + "  var tunnelStatusEl = document.getElementById('tunnel-status')\n"
  + "  var tunnelLinkEl = document.getElementById('tunnel-link')\n"
  + "  var tunnelToggleBtn = document.getElementById('tunnel-toggle')\n"
  + "  var TUNNEL_LABELS = { none: '未启动', starting: '启动中…', provisioning: '下载客户端中…', running: '已连接', unavailable: '未找到隧道客户端', failed: '启动失败' }\n"
  + "  if (token !== '') tokenInput.value = token\n"
  + "  function setConn(ok, label) { conn.textContent = label; conn.className = 'badge ' + (ok ? 'ok' : 'err') }\n"
  + '  function api(path, body) {\n'
  + '    var headers = {}\n'
  + "    var options = { method: body === undefined ? 'GET' : 'POST', headers: headers }\n"
  + "    if (body !== undefined) { headers['content-type'] = 'application/json'; options.body = JSON.stringify(body) }\n"
  + "    return fetch(path + '?token=' + encodeURIComponent(token), options).then(function (r) { return r.json() })\n"
  + '  }\n'
  + '  function selected() {\n'
  + '    if (state === null) return null\n'
  + "    for (var i = 0; i < state.sessions.length; i++) if (state.sessions[i].id === selectedId) return state.sessions[i]\n"
  + '    return null\n'
  + '  }\n'
  + '  function render() {\n'
  + '    var sel = selected()\n'
  + "    sessionsEl.textContent = ''\n"
  + '    state.sessions.forEach(function (s) {\n'
  + "      var card = document.createElement('div')\n"
  + "      card.className = 'session' + (s.id === selectedId ? ' selected' : '')\n"
  + "      var top = document.createElement('div'); top.className = 'top'\n"
  + "      var title = document.createElement('span'); title.className = 'title'; title.textContent = s.title\n"
  + "      var right = document.createElement('span')\n"
  + "      var dot = document.createElement('span'); dot.className = 'dot ' + (s.status === 'running' ? 'running' : 'idle')\n"
  + "      var label = document.createElement('span'); label.textContent = s.status === 'running' ? '运行中' : '空闲'\n"
  + '      right.appendChild(dot); right.appendChild(label)\n'
  + '      top.appendChild(title); top.appendChild(right)\n'
  + "      var meta = document.createElement('div'); meta.className = 'meta'\n"
  + "      meta.textContent = '回合 ' + s.turn + ' · 队列 ' + s.nextTurn + ' · 引导 ' + s.nextStep\n"
  + '      card.appendChild(top); card.appendChild(meta)\n'
  + '      card.onclick = function () { selectedId = s.id; render() }\n'
  + '      sessionsEl.appendChild(card)\n'
  + '    })\n'
  + "    feedEl.textContent = ''\n"
  + '    if (sel === null || sel.feed.length === 0) {\n'
  + "      var empty = document.createElement('div'); empty.className = 'empty'\n"
  + "      empty.textContent = sel === null ? '没有会话' : '（暂无消息）'\n"
  + '      feedEl.appendChild(empty)\n'
  + '    } else {\n'
  + '      sel.feed.slice(-40).forEach(function (evt) {\n'
  + "        var row = document.createElement('div'); row.className = 'evt ' + evt.kind\n"
  + "        var who = document.createElement('div'); who.className = 'who'\n"
  + "        who.textContent = (evt.kind === 'user' ? '用户' : evt.kind === 'assistant' ? '助手' : '工具') + ' · #' + evt.seq + ' · ' + new Date(evt.time).toLocaleTimeString()\n"
  + "        var body = document.createElement('div'); body.className = 'body'; body.textContent = evt.text\n"
  + '        row.appendChild(who); row.appendChild(body)\n'
  + '        feedEl.appendChild(row)\n'
  + '      })\n'
  + '    }\n'
  + "    var st = ''\n"
  + "    if (sel !== null) st = '已选中：' + sel.title + '（' + (sel.status === 'running' ? '运行中' : '空闲') + '）'\n"
  + '    statusEl.textContent = st\n'
  + '    sendBtn.disabled = busy || sel === null\n'
  + "    stopBtn.disabled = busy || sel === null || sel.status !== 'running'\n"
  + "    var steerRadio = document.querySelector('input[name=\"mode\"][value=\"steer\"]')\n"
  + "    if (sel !== null) steerRadio.disabled = sel.status !== 'running'\n"
  + '    var t = (state.tunnel !== null && state.tunnel !== undefined) ? state.tunnel : { status: \'none\', url: null }\n'
  + "    if (t.status === 'running' && typeof t.url === 'string') {\n"
  + "      tunnelStatusEl.textContent = '公网：已连接'\n"
  + "      tunnelLinkEl.href = t.url + '/?token=' + encodeURIComponent(token)\n"
  + '      tunnelLinkEl.textContent = t.url\n'
  + "      tunnelLinkEl.style.display = ''\n"
  + "      tunnelToggleBtn.textContent = '停止公网隧道'\n"
  + '      tunnelToggleBtn.disabled = false\n'
  + '    } else {\n'
  + "      tunnelStatusEl.textContent = '公网：' + (TUNNEL_LABELS[t.status] || t.status)\n"
  + "      tunnelLinkEl.style.display = 'none'\n"
  + "      tunnelToggleBtn.textContent = (t.status === 'starting' || t.status === 'provisioning') ? '处理中…' : '启动公网隧道'\n"
  + "      tunnelToggleBtn.disabled = t.status === 'starting' || t.status === 'provisioning'\n"
  + '    }\n'
  + '  }\n'
  + '  function refresh() {\n'
  + "    if (token === '') { setConn(false, '缺少令牌'); return }\n"
  + "    api(API + '/state').then(function (s) {\n"
  + '      if (!s.ok) { setConn(false, s.error === \'unauthorized\' ? \'令牌无效\' : \'状态错误\'); return }\n'
  + '      state = s\n'
  + "      if (state.sessions.length > 0 && (selectedId === null || !state.sessions.some(function (x) { return x.id === selectedId }))) {\n"
  + "        var want = (s.defaultSessionId !== null && s.defaultSessionId !== undefined && state.sessions.some(function (x) { return x.id === s.defaultSessionId })) ? s.defaultSessionId : state.sessions[0].id\n"
  + '        selectedId = want\n'
  + '      }\n'
  + "      if (state.sessions.length === 0) selectedId = null\n"
  + "      setConn(true, '已连接')\n"
  + '      render()\n'
  + '    }).catch(function (err) { setConn(false, \'网络错误\'); console.error(err) })\n'
  + '  }\n'
  + '  function applyToken() {\n'
  + "    token = tokenInput.value.trim()\n"
  + "    if (token === '') return\n"
  + "    try { history.replaceState(null, '', location.pathname + '?token=' + encodeURIComponent(token)) } catch (e) {}\n"
  + '    refresh()\n'
  + '  }\n'
  + "  tokenInput.addEventListener('change', applyToken)\n"
  + "  document.getElementById('apply-token').addEventListener('click', applyToken)\n"
  + "  document.getElementById('copy-link').addEventListener('click', function () {\n"
  + "    var url = location.origin + '/remote-control/?token=' + encodeURIComponent(token)\n"
  + '    if (navigator.clipboard && navigator.clipboard.writeText) {\n'
  + "      navigator.clipboard.writeText(url).then(function () { statusEl.textContent = '链接已复制' }).catch(function () { statusEl.textContent = url })\n"
  + '    } else { statusEl.textContent = url }\n'
  + '  })\n'
  + "  tunnelToggleBtn.addEventListener('click', function () {\n"
  + "    var running = state !== null && state.tunnel !== null && state.tunnel !== undefined && state.tunnel.status === 'running'\n"
  + "    api(API + '/tunnel', { action: running ? 'stop' : 'start' }).then(function (r) {\n"
  + "      if (!r.ok) statusEl.textContent = '隧道操作失败：' + (r.error || '未知错误')\n"
  + '      refresh()\n'
  + "    }).catch(function (err) { statusEl.textContent = '隧道操作失败：' + String(err) })\n"
  + '  })\n'
  + "  sendBtn.addEventListener('click', function () {\n"
  + '    var sel = selected()\n'
  + '    var text = textEl.value\n'
  + "    if (sel === null || text.trim() === '' || busy) return\n"
  + "    var mode = document.querySelector('input[name=\"mode\"]:checked').value\n"
  + '    busy = true\n'
  + "    api(API + '/message', { sessionId: sel.id, text: text, mode: mode }).then(function (r) {\n"
  + "      if (r.ok) { textEl.value = '' } else { statusEl.textContent = '发送失败：' + (r.error || '未知错误') }\n"
  + '      busy = false\n'
  + '      refresh()\n'
  + "    }).catch(function (err) { statusEl.textContent = '发送失败：' + String(err); busy = false })\n"
  + '  })\n'
  + "  stopBtn.addEventListener('click', function () {\n"
  + '    var sel = selected()\n'
  + '    if (sel === null || busy) return\n'
  + '    busy = true\n'
  + "    api(API + '/stop', { sessionId: sel.id }).then(function (r) {\n"
  + "      if (!r.ok) statusEl.textContent = '停止失败：' + (r.error || '未知错误')\n"
  + '      busy = false\n'
  + '      refresh()\n'
  + "    }).catch(function (err) { statusEl.textContent = '停止失败：' + String(err); busy = false })\n"
  + '  })\n'
  + "  textEl.addEventListener('keydown', function (e) {\n"
  + "    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendBtn.click()\n"
  + '  })\n'
  + '  refresh()\n'
  + '  setInterval(refresh, 1500)\n'
  + '})()\n'
  + '</script>\n'
  + '</body>\n'
  + '</html>\n'

const MOBILE_CSS = '<style id="dsh-remote-mobile">\n'
  + 'html { -webkit-text-size-adjust: 100%; }\n'
  + 'body { overscroll-behavior: none; }\n'
  + 'html, body { overflow-x: hidden; }\n'
  + '@media (pointer: coarse) { [data-side] { display: none !important; } }\n'
  + '@media (max-width: 900px) {\n'
  + '  [data-details-collapsed][data-sidebar-collapsed] { grid-template-columns: 56px minmax(0, 1fr) 0px !important; }\n'
  + '  [data-details-collapsed]:not([data-sidebar-collapsed]) { grid-template-columns: minmax(0, 1fr) 0px 0px !important; }\n'
  + '  [data-sidebar-collapsed]:not([data-details-collapsed]) { grid-template-columns: 0px 0px minmax(0, 1fr) !important; }\n'
  + '  :not([data-sidebar-collapsed]):not([data-details-collapsed]) { grid-template-columns: 0px 0px minmax(0, 1fr) !important; }\n'
  + '  html, body, #root { height: 100dvh !important; }\n'
  + '  [data-slot="sidebar"] { width: 100% !important; }\n'
  + '  [data-slot="sidebar"] > div { width: 100% !important; max-width: 100% !important; }\n'
  + '  [data-slot="conversation.session.header"] > div { padding: 8px 10px 0 !important; }\n'
  + '  [data-slot="conversation.session.header"] [role="tablist"] { gap: 14px; padding-left: 4px; overflow-x: auto; }\n'
  + '  [data-slot="conversation.session.header"] [role="tab"] { white-space: nowrap; }\n'
  + '  [data-slot="conversation.session"] img,\n'
  + '  [data-slot="conversation.session"] video,\n'
  + '  [data-slot="conversation.session"] table,\n'
  + '  [data-slot="conversation.session"] pre,\n'
  + '  [data-slot="conversation.session"] code { max-width: 100% !important; }\n'
  + '  [data-slot="conversation.session"] pre { overflow-x: auto; }\n'
  + '  [data-slot="conversation.session"] table { display: block; overflow-x: auto; }\n'
  + '  [role="menu"], [role="dialog"], [role="listbox"] { max-width: calc(100vw - 24px) !important; }\n'
  + '  [data-composer-seat] { padding-bottom: env(safe-area-inset-bottom); }\n'
  + '}\n'
  + '@media (max-width: 480px) {\n'
  + '  [data-phase] { --dsh-composer-side-clearance: 8px; }\n'
  + '}\n'
  + '</style>'

function randomToken(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function textPreview(content) {
  let out = ''
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') out += block.text
    }
  }
  if (out.length > 500) return out.slice(0, 500) + '…'
  return out
}

function describeSession(agent, sessionTitle) {
  let title = typeof agent.id === 'string' ? agent.id : 'session'
  if (sessionTitle !== undefined) {
    try {
      const snapshot = sessionTitle.get(agent.session)
      if (snapshot !== undefined && typeof snapshot.title === 'string') title = snapshot.title
    } catch (error) { /* fallback */ }
  }
  const events = (agent.session && Array.isArray(agent.session.events)) ? agent.session.events : []
  let turn = 0
  for (const event of events) {
    if (event !== null && typeof event === 'object' && event.type === 'turn/start' && event.data !== null && typeof event.data === 'object' && typeof event.data.turn === 'number') turn = event.data.turn
  }
  const tail = events.slice(-14)
  const feed = []
  for (const event of tail) {
    if (event === null || typeof event !== 'object' || typeof event.type !== 'string') continue
    let kind = null
    let text = ''
    if (event.type === 'user/message') { kind = 'user'; text = textPreview(event.data === null || event.data === undefined ? undefined : event.data.content) }
    else if (event.type === 'assistant/message') {
      kind = 'assistant'
      const msg = event.data === null || event.data === undefined ? undefined : event.data.message
      text = textPreview(msg === null || msg === undefined ? undefined : msg.content)
    } else if (event.type === 'tool/call') { kind = 'tool'; text = (event.data !== null && event.data !== undefined && typeof event.data.name === 'string') ? event.data.name : '' }
    else if (event.type === 'tool/result') { kind = 'tool'; text = '工具结果' }
    else continue
    feed.push({ seq: typeof event.seq === 'number' ? event.seq : 0, time: typeof event.time === 'number' ? event.time : 0, kind, text })
  }
  const last = tail.length > 0 ? tail[tail.length - 1] : null
  return {
    id: typeof agent.id === 'string' ? agent.id : '',
    status: agent.status === 'running' ? 'running' : 'idle',
    title,
    turn,
    nextTurn: (agent.inbox && Array.isArray(agent.inbox.nextTurn)) ? agent.inbox.nextTurn.length : 0,
    nextStep: (agent.inbox && Array.isArray(agent.inbox.nextStep)) ? agent.inbox.nextStep.length : 0,
    lastEvent: last !== null && typeof last.type === 'string' ? { type: last.type, seq: typeof last.seq === 'number' ? last.seq : 0, time: typeof last.time === 'number' ? last.time : 0 } : null,
    feed,
  }
}

function makeUserMessage(text) {
  const id = 'rc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', remoteControl: true } }
}

function json(res, status, payload) {
  let body
  try { body = JSON.stringify(payload) } catch (error) { body = '{"ok":false,"error":"serialize"}' }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    const decoder = new TextDecoder()
    const parts = []
    let size = 0
    req.on('data', (chunk) => {
      size += typeof chunk.length === 'number' ? chunk.length : 0
      if (size > 1024 * 1024) { req.destroy(); resolve(null); return }
      try { parts.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })) } catch (error) { /* skip chunk */ }
    })
    req.on('end', () => {
      try { parts.push(decoder.decode()) } catch (error) { /* skip */ }
      resolve(parts.join(''))
    })
    req.on('error', () => resolve(null))
  })
}

function parseTarget(rawUrl) {
  const url = typeof rawUrl === 'string' ? rawUrl : '/'
  const qIndex = url.indexOf('?')
  const path = qIndex === -1 ? url : url.slice(0, qIndex)
  const query = qIndex === -1 ? '' : url.slice(qIndex + 1)
  const params = {}
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    try { params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' ')) } catch (error) { /* skip */ }
  }
  return { path, params }
}

function tokenOf(req, params) {
  if (typeof params.token === 'string' && params.token.length > 0) return params.token
  const header = req.headers['x-remote-token']
  if (typeof header === 'string' && header.length > 0) return header
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.indexOf('Bearer ') === 0) return auth.slice(7)
  return null
}

function gatewayScript(dsPort, gatePort, gateToken) {
  const tokenLiteral = JSON.stringify(gateToken)
  const loginHtml = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>DSH 网页版 · 远程登录</title>',
    '<style>',
    "body{margin:0;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;min-height:100vh}",
    '.box{width:min(92vw,360px);display:flex;flex-direction:column;gap:12px;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px}',
    'h1{font-size:18px;margin:0}',
    'p{font-size:12px;color:#8b949e;margin:0;line-height:1.6}',
    'input{background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:10px;font-size:15px}',
    'input:focus{outline:none;border-color:#58a6ff}',
    'button{font-size:15px;padding:10px;border-radius:8px;border:none;background:#1f6feb;color:#fff}',
    '#err{color:#f85149}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="box">',
    '<h1>DSH 网页版 · 远程登录</h1>',
    '<p>输入访问令牌（见电脑上 DSH 宿主日志或 DSH_REMOTE_TOKEN 环境变量）即可使用完整网页版。令牌即密码，请勿泄露。</p>',
    '<input id="t" placeholder="访问令牌 token" autocomplete="off">',
    '<button onclick="go()">进入</button>',
    '<p id="err"></p>',
    '</div>',
    '<script>',
    'function go(){var t=document.getElementById(\'t\').value.trim();if(!t){document.getElementById(\'err\').textContent=\'请输入令牌\';return}location.href=\'/?token=\'+encodeURIComponent(t)}',
    "document.getElementById('t').addEventListener('keydown',function(e){if(e.key==='Enter')go()})",
    '</script>',
    '</body>',
    '</html>',
  ].join('\n')
  return [
    "const http = require('http')",
    "const net = require('net')",
    'const DS_PORT = ' + dsPort,
    'const TOKEN = ' + tokenLiteral,
    "const COOKIE = 'dsh_rc'",
    "const DENY = ['/api/credentials.describe', '/api/credentials.set', '/api/credentials.unset', '/api/settings.openDocument']",
    'const LOGIN = ' + JSON.stringify(loginHtml),
    'function authorized(req) {',
    "  const c = String(req.headers.cookie || '')",
    "  const parts = c.split(';')",
    '  for (let i = 0; i < parts.length; i++) {',
    '    const pair = parts[i].trim()',
    "    const eq = pair.indexOf('=')",
    '    if (eq !== -1 && pair.slice(0, eq) === COOKIE && pair.slice(eq + 1) === TOKEN) return true',
    '  }',
    '  return false',
    '}',
    'function queryToken(raw) {',
    "  const q = raw.indexOf('?')",
    '  if (q === -1) return null',
    '  const query = raw.slice(q + 1)',
    '  const m = query.match(/(?:^|&)token=([^&]*)/)',
    '  if (m === null) return null',
    '  try { return decodeURIComponent(m[1]) } catch (e) { return null }',
    '}',
    'function pathOf(raw) {',
    "  const q = raw.indexOf('?')",
    '  return q === -1 ? raw : raw.slice(0, q)',
    '}',
    'function forward(req, res) {',
    '  const headers = {}',
    '  Object.keys(req.headers).forEach(function (k) {',
    '    const lk = k.toLowerCase()',
    "    if (lk === 'host' || lk === 'origin' || lk === 'referer') return",
    '    headers[k] = req.headers[k]',
    '  })',
    "  headers['host'] = '127.0.0.1:' + DS_PORT",
    "  const upstream = http.request({ host: '127.0.0.1', port: DS_PORT, path: req.url, method: req.method, headers: headers }, function (up) {",
    '    res.writeHead(up.statusCode || 502, up.headers)',
    '    up.pipe(res)',
    '  })',
    "  upstream.on('error', function () {",
    '    if (!res.headersSent) res.writeHead(502)',
    "    res.end('upstream unreachable')",
    '  })',
    '  req.pipe(upstream)',
    '}',
    "const server = http.createServer(function (req, res) {",
    "  const raw = req.url || '/'",
    '  const path = pathOf(raw)',
    "  if (DENY.indexOf(path) !== -1) {",
    "    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })",
    "    res.end('forbidden: privileged endpoint')",
    '    return',
    '  }',
    '  if (authorized(req)) { forward(req, res); return }',
    '  const tok = queryToken(raw)',
    '  if (tok !== null && tok === TOKEN) {',
    "    res.writeHead(302, { location: path, 'set-cookie': COOKIE + '=' + TOKEN + '; Path=/; HttpOnly; SameSite=Lax' })",
    '    res.end()',
    '    return',
    '  }',
    "  if (req.method === 'GET' && String(req.headers.accept || '').indexOf('text/html') !== -1) {",
    "    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })",
    '    res.end(LOGIN)',
    '    return',
    '  }',
    "  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })",
    "  res.end('{\"ok\":false,\"error\":\"unauthorized\"}')",
    '})',
    "server.on('upgrade', function (req, socket, head) {",
    '  if (!authorized(req)) {',
    "    socket.write('HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n')",
    '    socket.destroy()',
    '    return',
    '  }',
    "  const upstream = net.connect(DS_PORT, '127.0.0.1', function () {",
    "    const lines = [req.method + ' ' + req.url + ' HTTP/' + req.httpVersion]",
    '    const rh = req.rawHeaders || []',
    '    for (let i = 0; i + 1 < rh.length; i += 2) {',
    '      const lk = rh[i].toLowerCase()',
    "      if (lk === 'host' || lk === 'origin' || lk === 'referer') continue",
    "      lines.push(rh[i] + ': ' + rh[i + 1])",
    '    }',
    "    lines.push('Host: 127.0.0.1:' + DS_PORT)",
    "    upstream.write(lines.join('\\r\\n') + '\\r\\n\\r\\n')",
    '    if (head && head.length > 0) upstream.write(head)',
    '    socket.pipe(upstream)',
    '    upstream.pipe(socket)',
    '  })',
    "  upstream.on('error', function () { socket.destroy() })",
    "  socket.on('error', function () { upstream.destroy() })",
    "  socket.on('close', function () { upstream.destroy() })",
    '})',
    "server.listen(" + gatePort + ", '0.0.0.0', function () {",
    "  console.log('[dsh-remote-control] gateway listening on 0.0.0.0:" + gatePort + "')",
    '})',
  ].join('\n')
}

function downloaderScript(outPath) {
  const out = JSON.stringify(outPath)
  return [
    "const https = require('https')",
    "const fs = require('fs')",
    "const path = require('path')",
    'const OUT_PATH = ' + out,
    'const urls = [',
    "  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',",
    "  'https://ghfast.top/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',",
    "  'https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',",
    "  'https://ghproxy.net/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',",
    "  'https://mirror.ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'",
    ']',
    'let idx = 0',
    'function attempt() {',
    "  if (idx >= urls.length) { console.error('[dsh-remote-control] cloudflared download: all mirrors failed'); process.exit(1) }",
    '  const url = urls[idx]',
    '  idx += 1',
    "  console.error('[dsh-remote-control] cloudflared download: trying ' + url)",
    "  const req = https.get(url, { headers: { 'User-Agent': 'dsh-remote-control' } }, function (res) {",
    "    if (res.statusCode >= 300 && res.statusCode < 400 && typeof res.headers.location === 'string') {",
    '      res.resume()',
    "      urls.push(new URL(res.headers.location, url).toString())",
    '      attempt()',
    '      return',
    '    }',
    "    if (res.statusCode !== 200) { res.resume(); attempt(); return }",
    '    const file = fs.createWriteStream(OUT_PATH)',
    '    res.pipe(file)',
    "    file.on('finish', function () { file.close(); console.error('[dsh-remote-control] cloudflared downloaded'); process.exit(0) })",
    "    file.on('error', function () { try { fs.unlinkSync(OUT_PATH) } catch (e) {} attempt() })",
    '  })',
    "  req.on('error', function (error) { console.error('[dsh-remote-control] download error: ' + String(error)); attempt() })",
    '}',
    "try { fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true }) } catch (error) {}",
    'attempt()',
  ].join('\n')
}

export function apply(ctx) {
  const agents = ctx.get('agents')
  const sessionTitle = ctx.get('sessionTitle')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const webServer = ctx.webServer
  const subprocess = ctx.subprocess

  const BRIDGE_PORT = Number.isFinite(Number(process.env.DSH_REMOTE_PORT)) ? Number(process.env.DSH_REMOTE_PORT) : 8790
  const ROOT = '/remote-control'
  const API_ROOT = ROOT + '/api'
  const token = (typeof process.env.DSH_REMOTE_TOKEN === 'string' && process.env.DSH_REMOTE_TOKEN.length > 0)
    ? process.env.DSH_REMOTE_TOKEN
    : randomToken(20)
  let workspaceCwd = 'C:\\'
  if (sandboxPolicy !== undefined && typeof sandboxPolicy.workspaceRoot === 'string') workspaceCwd = sandboxPolicy.workspaceRoot

  const bridgeRef = { status: 'none', handle: undefined, disposed: false, port: BRIDGE_PORT }
  const tunnelRef = { status: 'none', url: null, handle: undefined, poll: null, disposed: false }
  const TUNNEL_URL_PATTERNS = [
    /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
    /https:\/\/[a-z0-9-]+\.ngrok-free\.app/,
    /https:\/\/[a-z0-9-]+\.ngrok\.app/,
    /https:\/\/[a-z0-9-]+\.ngrok\.io/,
  ]

  const statePayload = () => {
    let sessions = []
    try { sessions = agents.list().map((agent) => describeSession(agent, sessionTitle)) } catch (error) { /* empty */ }
    return {
      ok: true,
      server: { host: webServer.host, port: webServer.port },
      bridge: { status: bridgeRef.status, port: bridgeRef.port },
      tunnel: { status: tunnelRef.status, url: tunnelRef.url },
      sessions,
    }
  }

  const apiHandler = async (req, res) => {
    const { path, params } = parseTarget(req.url)
    const given = tokenOf(req, params, token)
    if (given !== token) { json(res, 401, { ok: false, error: 'unauthorized' }); return }
    const sub = path.slice(API_ROOT.length)
    if (sub === '/state' && req.method === 'GET') {
      json(res, 200, statePayload())
      return
    }
    if (sub === '/message' && req.method === 'POST') {
      const raw = await readBody(req)
      let parsed = null
      if (raw !== null) { try { parsed = JSON.parse(raw) } catch (error) { parsed = null } }
      if (parsed === null || typeof parsed !== 'object') { json(res, 400, { ok: false, error: 'invalid-json' }); return }
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : null
      const text = typeof parsed.text === 'string' ? parsed.text : ''
      const mode = parsed.mode === 'steer' ? 'steer' : 'followup'
      if (sessionId === null) { json(res, 400, { ok: false, error: 'missing-session-id' }); return }
      if (text.trim().length === 0) { json(res, 400, { ok: false, error: 'empty-text' }); return }
      let agent
      try { agent = agents.get(sessionId) } catch (error) { agent = undefined }
      if (agent === undefined) { json(res, 404, { ok: false, error: 'session-not-found' }); return }
      if (mode === 'steer') {
        if (agent.status !== 'running') { json(res, 409, { ok: false, error: 'steer-unavailable' }); return }
        try { agent.steer(makeUserMessage(text)) } catch (error) { json(res, 500, { ok: false, error: 'steer-rejected' }); return }
      } else {
        try { agent.followup(makeUserMessage(text)) } catch (error) { json(res, 500, { ok: false, error: 'agent-busy' }); return }
      }
      json(res, 200, { ok: true, accepted: true })
      return
    }
    if (sub === '/stop' && req.method === 'POST') {
      const raw = await readBody(req)
      let parsed = null
      if (raw !== null) { try { parsed = JSON.parse(raw) } catch (error) { parsed = null } }
      const sessionId = parsed !== null && typeof parsed === 'object' && typeof parsed.sessionId === 'string' ? parsed.sessionId : null
      if (sessionId === null) { json(res, 400, { ok: false, error: 'missing-session-id' }); return }
      let agent
      try { agent = agents.get(sessionId) } catch (error) { agent = undefined }
      if (agent === undefined) { json(res, 404, { ok: false, error: 'session-not-found' }); return }
      try { agent.cancel({ kind: 'user' }, { keepInbox: true }) } catch (error) { /* best effort */ }
      json(res, 200, { ok: true, stopped: true })
      return
    }
    if (sub === '/tunnel' && req.method === 'POST') {
      const raw = await readBody(req)
      let parsed = null
      if (raw !== null) { try { parsed = JSON.parse(raw) } catch (error) { parsed = null } }
      const action = parsed !== null && typeof parsed === 'object' && parsed.action === 'stop' ? 'stop' : 'start'
      if (action === 'stop') stopTunnel()
      else await startTunnel()
      json(res, 200, { ok: true, tunnel: { status: tunnelRef.status, url: tunnelRef.url } })
      return
    }
    json(res, 404, { ok: false, error: 'not-found' })
  }

  const pageHandler = (req, res) => { html(res, 200, PAGE_HTML) }

  ctx.effect(() => webServer.register({ kind: 'exact', path: ROOT, handler: pageHandler }), 'remote-control page route')
  ctx.effect(() => webServer.register({ kind: 'exact', path: ROOT + '/', handler: pageHandler }), 'remote-control page route (trailing slash)')
  ctx.effect(() => webServer.register({ kind: 'prefix', path: API_ROOT, handler: apiHandler }), 'remote-control api route')

  ctx.effect(() => webServer.tapIndex((page) => {
    if (typeof page !== 'string' || page.indexOf('dsh-remote-mobile') !== -1) return page
    const at = page.indexOf('</head>')
    return at === -1 ? page : page.slice(0, at) + MOBILE_CSS + page.slice(at)
  }), 'remote-control mobile css tap')

  ctx.effect(() => () => {
    bridgeRef.disposed = true
    tunnelRef.disposed = true
    if (bridgeRef.handle !== undefined) {
      try { bridgeRef.handle.terminate() } catch (error) { /* already gone */ }
      bridgeRef.handle = undefined
    }
    stopTunnel()
  }, 'remote-control network lifecycle')

  console.log('[dsh-remote-control] 访问令牌: ' + token + '（可设置环境变量 DSH_REMOTE_TOKEN 固定）')
  console.log('[dsh-remote-control] 本机网页版入口: http://127.0.0.1:' + webServer.port + '/?token=' + token)
  console.log('[dsh-remote-control] 本机控制页: http://127.0.0.1:' + webServer.port + ROOT + '/?token=' + token)

  if (webServer.host === '127.0.0.1') {
    bridgeRef.status = 'starting'
    subprocess.resolveExecutable('node').then((nodePath) => {
      if (bridgeRef.disposed) return
      if (typeof nodePath !== 'string' || nodePath.length === 0) {
        bridgeRef.status = 'unavailable'
        console.log('[dsh-remote-control] 未找到 node，无法启动网关（本机访问不受影响）')
        return
      }
      const script = gatewayScript(webServer.port, BRIDGE_PORT, token)
      let handle
      try {
        handle = subprocess.spawn({
          argv: [nodePath, '-e', script],
          cwd: workspaceCwd,
          stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
          graceMs: 2000,
        })
      } catch (error) {
        bridgeRef.status = 'failed'
        console.log('[dsh-remote-control] 网关启动失败: ' + String(error))
        return
      }
      if (bridgeRef.disposed) {
        try { handle.terminate() } catch (error) { /* ignore */ }
        return
      }
      bridgeRef.handle = handle
      bridgeRef.status = 'listening'
      console.log('[dsh-remote-control] 局域网网页版: http://<本机局域网IP>:' + BRIDGE_PORT + '/?token=' + token)
      console.log('[dsh-remote-control] 若 Windows 防火墙弹出提示，请允许 node 的网络访问')
      handle.done.then((outcome) => {
        if (bridgeRef.handle !== handle) return
        bridgeRef.handle = undefined
        if (!bridgeRef.disposed && (outcome === null || outcome.exitCode !== 0)) bridgeRef.status = 'failed'
      }).catch(() => {})
      startTunnel(false).catch(() => {})
    }).catch(() => {
      if (!bridgeRef.disposed) bridgeRef.status = 'unavailable'
    })
  }

  function tunnelCandidates() {
    return [
      { path: workspaceCwd + '\\.dsh-tools\\cloudflared.exe', kind: 'cloudflared' },
      { path: workspaceCwd + '\\cloudflared.exe', kind: 'cloudflared' },
      { name: 'cloudflared', kind: 'cloudflared' },
      { name: 'ngrok', kind: 'ngrok' },
    ]
  }

  async function provisionTunnelClient() {
    let nodePath = null
    try { nodePath = await subprocess.resolveExecutable('node') } catch (error) { nodePath = null }
    if (typeof nodePath !== 'string' || nodePath.length === 0) return false
    const outPath = workspaceCwd + '\\.dsh-tools\\cloudflared.exe'
    const script = downloaderScript(outPath)
    let handle
    try {
      handle = subprocess.spawn({
        argv: [nodePath, '-e', script],
        cwd: workspaceCwd,
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
        graceMs: 5000,
      })
    } catch (error) { return false }
    const outcome = await handle.done.catch(() => null)
    return outcome !== null && outcome !== undefined && outcome.exitCode === 0
  }

  async function startTunnel(allowProvision) {
    if (tunnelRef.status === 'starting' || tunnelRef.status === 'running') return
    if (bridgeRef.status !== 'listening') {
      tunnelRef.status = 'failed'
      console.log('[dsh-remote-control] 公网隧道未启动：网关不在运行状态')
      return
    }
    if (tunnelRef.disposed) return
    tunnelRef.status = 'starting'
    let exe = null
    let kind = null
    for (const candidate of tunnelCandidates()) {
      if (tunnelRef.disposed) return
      let resolved = null
      if (candidate.path !== undefined) {
        resolved = candidate.path
      } else {
        try { resolved = await subprocess.resolveExecutable(candidate.name) } catch (error) { resolved = null }
      }
      if (typeof resolved !== 'string' || resolved.length === 0) continue
      const args = candidate.kind === 'ngrok'
        ? ['http', String(BRIDGE_PORT), '--log', 'stdout']
        : ['tunnel', '--url', 'http://127.0.0.1:' + BRIDGE_PORT, '--no-autoupdate']
      let handle
      try {
        handle = subprocess.spawn({
          argv: [resolved].concat(args),
          cwd: workspaceCwd,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
          graceMs: 2000,
        })
      } catch (error) { continue }
      if (typeof handle.pid !== 'number' || handle.pid === -1) continue
      tunnelRef.handle = handle
      exe = resolved
      kind = candidate.kind
      break
    }
    if (exe === null || tunnelRef.handle === undefined) {
      if (allowProvision === false) {
        tunnelRef.status = 'unavailable'
        console.log('[dsh-remote-control] 未找到可用的隧道客户端（cloudflared / ngrok）')
        return
      }
      tunnelRef.status = 'provisioning'
      console.log('[dsh-remote-control] 未找到隧道客户端，正在自动下载 cloudflared…')
      provisionTunnelClient().then((ok) => {
        if (tunnelRef.disposed) return
        if (!ok) {
          tunnelRef.status = 'failed'
          console.log('[dsh-remote-control] 自动下载失败。可手动安装（winget install Cloudflare.cloudflared），然后重新点击“启动公网隧道”。')
          return
        }
        tunnelRef.status = 'none'
        startTunnel(false).catch(() => {})
      }).catch(() => {
        if (!tunnelRef.disposed) tunnelRef.status = 'failed'
      })
      return
    }
    const handle = tunnelRef.handle
    let stdoutOffset = 0
    let stderrOffset = 0
    const scan = () => {
      let text = ''
      const out = handle.collected.stdout
      const err = handle.collected.stderr
      if (out !== undefined) {
        try { const read = out.readFrom(stdoutOffset); stdoutOffset = read.nextOffset; text += '\n' + read.text } catch (error) { /* ignore */ }
      }
      if (err !== undefined) {
        try { const read = err.readFrom(stderrOffset); stderrOffset = read.nextOffset; text += '\n' + read.text } catch (error) { /* ignore */ }
      }
      for (const pattern of TUNNEL_URL_PATTERNS) {
        const match = text.match(pattern)
        if (match !== null && match.length > 0 && typeof match[0] === 'string') {
          tunnelRef.status = 'running'
          tunnelRef.url = match[0]
          console.log('[dsh-remote-control] 公网网页版入口: ' + match[0] + '/?token=' + token)
          if (tunnelRef.poll !== null) { try { tunnelRef.poll() } catch (error) { /* ignore */ } tunnelRef.poll = null }
          return
        }
      }
    }
    scan()
    if (tunnelRef.status !== 'running') tunnelRef.poll = ctx.interval(scan, 1000)
    handle.done.then((outcome) => {
      if (tunnelRef.handle !== handle) return
      if (tunnelRef.poll !== null) { try { tunnelRef.poll() } catch (error) { /* ignore */ } tunnelRef.poll = null }
      tunnelRef.handle = undefined
      if (tunnelRef.status !== 'running') {
        tunnelRef.status = 'failed'
        console.log('[dsh-remote-control] 公网隧道进程退出（exitCode=' + (outcome === null ? '?' : String(outcome.exitCode)) + '），请检查网络或客户端配置')
      } else {
        tunnelRef.status = 'none'
        tunnelRef.url = null
      }
    }).catch(() => {})
  }

  function stopTunnel() {
    if (tunnelRef.poll !== null) { try { tunnelRef.poll() } catch (error) { /* ignore */ } tunnelRef.poll = null }
    if (tunnelRef.handle !== undefined) {
      try { tunnelRef.handle.terminate() } catch (error) { /* ignore */ }
      tunnelRef.handle = undefined
    }
    tunnelRef.status = 'none'
    tunnelRef.url = null
  }
}

export default { name, inject, apply }
