function RcPanel(props) {
  const ctx = props.ctx
  const [info, setInfo] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    host.call('rc-info').then((data) => {
      if (alive) setInfo(data)
    }).catch((err) => {
      if (alive) setError(String(err && err.message ? err.message : err))
    })
    return () => { alive = false }
  }, [])
  if (error !== null) {
    return React.createElement('div', { className: 'drc-panel drc-err' }, '远程控制状态读取失败：' + error)
  }
  if (info === null) {
    return React.createElement('div', { className: 'drc-panel' }, '正在读取远程控制信息…')
  }
  const scheduleRefresh = () => {
    try {
      ctx.timeout(() => { host.call('rc-info').then((next) => setInfo(next)).catch(() => {}) }, 3000)
      ctx.timeout(() => { host.call('rc-info').then((next) => setInfo(next)).catch(() => {}) }, 8000)
    } catch (err) { /* timer unavailable */ }
  }
  const localUrl = 'http://127.0.0.1:' + info.port + '/remote-control/?token=' + info.token
  const bridge = info.bridge === null || info.bridge === undefined ? null : info.bridge
  const bridgeOn = bridge !== null && bridge.status === 'listening'
  const tunnel = info.tunnel === null || info.tunnel === undefined ? null : info.tunnel
  const tunnelRunning = tunnel !== null && tunnel.status === 'running' && typeof tunnel.url === 'string'
  const tunnelBusyState = tunnel !== null && (tunnel.status === 'starting' || tunnel.status === 'provisioning')
  const tunnelLabel = tunnel !== null && tunnel.status === 'starting' ? '启动中…'
    : tunnel !== null && tunnel.status === 'provisioning' ? '下载客户端中…'
    : tunnel !== null && tunnel.status === 'failed' ? '重试公网隧道'
    : '启动公网隧道'
  const rows = [
    React.createElement('div', { key: 'gui-local', className: 'drc-row' },
      React.createElement('span', null, '本机网页版'),
      React.createElement('a', {
        className: 'drc-pub',
        href: 'http://127.0.0.1:' + info.port + '/?token=' + info.token,
        target: '_blank',
        rel: 'noreferrer',
      }, '打开完整网页版 ↗')),
    React.createElement('div', { key: 'token', className: 'drc-row' },
      React.createElement('span', null, '访问令牌'),
      React.createElement('code', { className: 'drc-token' }, info.token)),
    React.createElement('div', { key: 'sessions', className: 'drc-row' },
      React.createElement('span', null, '活跃会话'),
      React.createElement('span', null, String(info.sessions))),
  ]
  if (tunnelRunning) {
    rows.push(React.createElement('div', { key: 'pub', className: 'drc-row' },
      React.createElement('span', null, '公网入口'),
      React.createElement('span', { className: 'drc-pubcell' },
        React.createElement('a', {
          className: 'drc-pub',
          href: tunnel.url + '/?token=' + info.token,
          target: '_blank',
          rel: 'noreferrer',
        }, tunnel.url),
        React.createElement('button', {
          className: 'drc-btn',
          disabled: busy,
          onClick: () => {
            setBusy(true)
            host.call('rc-tunnel', { action: 'stop' })
              .then(() => host.call('rc-info'))
              .then((next) => { setInfo(next); setBusy(false) })
              .catch(() => setBusy(false))
          },
        }, '停止'))))
  } else {
    rows.push(React.createElement('div', { key: 'pub', className: 'drc-row' },
      React.createElement('span', null, '公网隧道'),
      React.createElement('button', {
        className: 'drc-btn',
        disabled: busy || tunnelBusyState,
        onClick: () => {
          setBusy(true)
          host.call('rc-tunnel', { action: 'start' })
            .then(() => host.call('rc-info'))
            .then((next) => { setInfo(next); setBusy(false); scheduleRefresh() })
            .catch(() => setBusy(false))
        },
      }, tunnelLabel)))
    if (tunnel !== null && (tunnel.status === 'unavailable' || tunnel.status === 'failed')) {
      rows.push(React.createElement('div', { key: 'tunnel-hint', className: 'drc-hint' },
        '未检测到可用隧道客户端。点击按钮会自动下载 cloudflared（约 60MB）；也可手动安装（winget install Cloudflare.cloudflared）后再点。'))
    }
  }
  if (bridgeOn) {
    rows.push(React.createElement('div', { key: 'lan', className: 'drc-row' },
      React.createElement('span', null, '局域网网页版'),
      React.createElement('a', {
        className: 'drc-pub',
        href: 'http://' + '127.0.0.1' + ':' + bridge.port + '/?token=' + info.token,
        target: '_blank',
        rel: 'noreferrer',
      }, 'http://<本机局域网IP>:' + bridge.port + ' ↗')))
  }
  rows.push(React.createElement('div', { key: 'note', className: 'drc-hint' },
    '网页版入口带登录门（令牌保护，仅拦截 credentials.* 与 settings.openDocument 等敏感接口）。控制页入口：' + localUrl))
  return React.createElement('div', { className: 'drc-panel' },
    React.createElement('div', { className: 'drc-head' }, '📡 DSH 远程控制'),
    rows)
}

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert([
      '.drc-panel { padding: 12px; border: 1px solid #30363d; border-radius: 10px; font-size: 13px; display: flex; flex-direction: column; gap: 8px; color: #e6edf3; }',
      '.drc-head { font-weight: 600; }',
      '.drc-open { display: inline-block; padding: 7px 12px; border-radius: 8px; background: #1f6feb; color: #fff !important; text-decoration: none; text-align: center; }',
      '.drc-row { display: flex; justify-content: space-between; gap: 10px; align-items: center; }',
      '.drc-row span:first-child { color: #8b949e; }',
      '.drc-token { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }',
      '.drc-pubcell { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }',
      '.drc-pub { font-size: 11px; word-break: break-all; color: #58a6ff; }',
      '.drc-btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer; }',
      '.drc-btn:disabled { opacity: .5; cursor: not-allowed; }',
      '.drc-hint { color: #8b949e; font-size: 12px; line-height: 1.5; }',
      '.drc-err { color: #f85149; }',
    ].join('\n'))
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(RcPanel, { ctx }),
    ))
  },
}