/**
 * Browser half of dsh-usage-panel: the Settings page that lists every provider
 * the usage dashboard reports, its meters and the times they recover.
 *
 * The page is driven by the payload alone. Provider keys, meter labels and
 * meter counts are never hardcoded: whatever `providers` carries is rendered,
 * known keys only get a friendlier title and an earlier seat, and a provider
 * with no meters still shows its status and its reason.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const NS = 'usage-panel'
    /** Titles and seats for the providers this dashboard is known to carry; anything else renders by key. */
    const KNOWN = [['opencode_go', 'OpenCode Go'], ['claude', 'Claude'], ['free_pool', 'free-pool']]
    /** How often an open page re-reads while it stays visible. */
    const POLL_MS = 60000

    const ja = {
      nav: '使用量',
      updated: '{time} 時点',
      source: '取得元 {host}',
      reload: '再取得',
      reloading: '取得中',
      empty: '提供元がありません',
      failed: '使用量を取得できません',
      failedHint: 'ダッシュボードの応答を確認してください',
      cooldowns: '停止中',
      cooldownUntil: '{until} まで',
      reset: '回復 {time}',
      attempts: '試行',
      noMeters: '内訳なし',
      statusOk: '取得済み',
      statusOther: '取得できず',
    }
    const en = {
      nav: 'Usage',
      updated: 'as of {time}',
      source: 'from {host}',
      reload: 'Refresh',
      reloading: 'Reading',
      empty: 'No providers reported',
      failed: 'Could not read usage',
      failedHint: 'Check what the dashboard answers',
      cooldowns: 'Paused',
      cooldownUntil: 'until {until}',
      reset: 'recovers {time}',
      attempts: 'attempts',
      noMeters: 'no breakdown',
      statusOk: 'read',
      statusOther: 'not read',
    }
    const zh = {
      ...en,
      nav: '用量',
      updated: '{time} 时',
      source: '来源 {host}',
      reload: '重新获取',
      reloading: '获取中',
      empty: '没有提供方数据',
      failed: '无法获取用量',
      failedHint: '请检查看板返回的内容',
      cooldowns: '已暂停',
      cooldownUntil: '至 {until}',
      reset: '{time} 恢复',
      attempts: '次尝试',
      noMeters: '无明细',
      statusOk: '已获取',
      statusOther: '未获取',
    }

    const translator = source => (key, params) => {
      let text = typeof source === 'function' ? source(key, params) : undefined
      if (typeof text !== 'string' || text === '' || text === key) text = (ja[key] !== undefined && /^ja/i.test(navigator.language) ? ja : en)[key] ?? key
      if (params === undefined) return text
      return text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
    }

    const CSS = [
      '.up_page{display:flex;flex-direction:column;gap:14px;max-width:660px;padding:4px 0 12px}',
      '.up_head{display:flex;align-items:center;gap:10px;min-height:26px}',
      '.up_stamp{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.up_btn{flex:none;height:26px;padding:0 10px;border-radius:7px;border:none;font:inherit;font-size:12px;cursor:pointer;',
      'background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);transition:opacity .12s}',
      '.up_btn:disabled{opacity:.45;cursor:default}',
      '.up_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.up_card{border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px 13px}',
      '.up_chead{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}',
      '.up_name{font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}',
      '.up_badge{flex:none;padding:1px 7px;border-radius:9px;font-size:11px;line-height:16px;',
      'background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
      '.up_badge.bad{background:var(--dsw-alias-state-warn-primary);color:#fff}',
      '.up_note{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.up_rows{display:flex;flex-direction:column;gap:10px}',
      '.up_row{display:flex;align-items:center;gap:10px}',
      '.up_lab{flex:0 0 96px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.up_track{position:relative;flex:1 1 auto;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.up_fill{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--dsw-alias-brand-primary)}',
      '.up_fill.warn{background:var(--dsw-alias-state-warn-primary)}',
      '.up_fill.hot{background:var(--dsw-alias-state-error-primary)}',
      '.up_fill.idle{background:var(--dsw-alias-state-idle-primary);opacity:.5}',
      '.up_pct{flex:0 0 52px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.up_detail{display:flex;gap:10px;margin:-4px 0 0 106px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
      '.up_muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.up_error{display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary)}',
      '.up_error code{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
      '.up_cooldown{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}',
      '.up_cooldown .up_badge.bad{background:var(--dsw-alias-state-warn-primary)}',
    ].join('')

    let services

    /** Call one endpoint of this plugin's Host channel through the page's own carrier. */
    const call = async (endpoint, payload, signal) => {
      const result = await services.connection.rpc.call('/api', `usage-panel/${endpoint}`, payload ?? {}, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }

    const whole = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined)
    const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined)
    const host = (url) => {
      try { return new URL(url).host } catch { return url }
    }
    /** `generated_at` is the dashboard's own stamp; show the clock time when it parses. */
    const clock = (value) => {
      const raw = text(value)
      if (raw === undefined) return undefined
      const at = new Date(raw)
      if (Number.isNaN(at.getTime())) return raw
      return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    const humanize = (key) => key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

    /** Known providers first, in their usual order; everything else by key. Unknown keys render unchanged. */
    const ordered = (providers) => {
      const seat = new Map(KNOWN.map(([key], index) => [key, index]))
      const title = new Map(KNOWN)
      return Object.entries(providers).sort((a, b) => {
        const left = seat.has(a[0]) ? seat.get(a[0]) : Number.MAX_SAFE_INTEGER
        const right = seat.has(b[0]) ? seat.get(b[0]) : Number.MAX_SAFE_INTEGER
        return left === right ? String(a[0]).localeCompare(String(b[0])) : left - right
      }).map(([key, provider]) => ({ key, title: title.get(key) ?? humanize(String(key)), provider: provider ?? {} }))
    }

    /** Percent tone: the same thresholds in every provider. */
    const tone = (percent) => percent === undefined ? 'idle' : percent >= 90 ? 'hot' : percent >= 75 ? 'warn' : 'ok'

    function Meter({ tr, meter }) {
      const percent = whole(meter?.percent)
      const label = text(meter?.label) ?? tr('noMeters')
      const reset = text(meter?.reset)
      const detail = text(meter?.detail)
      const value = percent === undefined ? 0 : Math.max(0, Math.min(100, percent))
      return h(React.Fragment, null,
        h('div', { className: 'up_row' },
          h('span', { className: 'up_lab', title: label }, label),
          h('div', {
            className: 'up_track', role: 'progressbar', 'aria-label': label,
            'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(value),
            'aria-valuetext': percent === undefined ? tr('noMeters') : `${percent}%`,
          }, h('i', { className: `up_fill ${tone(percent)}`, style: { width: `${value}%` } })),
          h('span', { className: 'up_pct' }, percent === undefined ? '—' : `${percent}%`)),
        reset === undefined && detail === undefined ? null : h('div', { className: 'up_detail' },
          reset === undefined ? null : h('span', null, tr('reset', { time: reset })),
          detail === undefined ? null : h('span', null, detail)))
    }

    function Provider({ tr, title, provider }) {
      const meters = Array.isArray(provider.meters) ? provider.meters.filter(meter => meter !== null && typeof meter === 'object') : []
      const status = text(provider.status)
      const notes = ['reason', 'detail', 'message', 'error']
        .map(field => text(provider[field]))
        .filter(value => value !== undefined)
      const note = text(provider.reset_note)
      return h('section', { className: 'up_card' },
        h('div', { className: 'up_chead' },
          h('span', { className: 'up_name' }, title),
          status === undefined || status === 'ok' ? null : h('span', { className: 'up_badge bad', title: status }, tr('statusOther')),
          note === undefined ? null : h('span', { className: 'up_note' }, note)),
        meters.length === 0
          ? h('p', { className: 'up_muted' }, tr('noMeters'))
          : h('div', { className: 'up_rows' }, meters.map((meter, index) => h(Meter, { key: `${index}`, tr, meter }))),
        notes.map((value, index) => h('p', { key: `note-${index}`, className: 'up_muted', style: { margin: '6px 0 0' } }, value)))
    }

    function Cooldowns({ tr, list }) {
      const rows = Array.isArray(list)
        ? list.filter(item => item !== null && typeof item === 'object').map(item => ({
          key: text(item.key) ?? text(item.label) ?? '—',
          reason: text(item.reason),
          until: text(item.until),
        }))
        : []
      if (rows.length === 0) return null
      return h('section', { className: 'up_card' },
        h('div', { className: 'up_chead' }, h('span', { className: 'up_name' }, tr('cooldowns'))),
        h('div', { className: 'up_rows' }, rows.map((row, index) => h('div', { key: `${index}`, className: 'up_cooldown' },
          h('span', { className: 'up_badge bad' }, row.key),
          row.reason === undefined ? null : h('span', null, row.reason),
          row.until === undefined ? null : h('span', { className: 'up_muted' }, tr('cooldownUntil', { until: row.until }))))))
    }

    function UsagePage({ t }) {
      const tr = translator(t)
      const [state, setState] = useState({ status: 'loading' })
      const [req, setReq] = useState({ id: 0, force: false })
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        const controller = new AbortController()
        let live = true
        call('snapshot', { force: req.force }, controller.signal).then((value) => {
          if (!live) return
          setState({ status: 'ready', value })
          setLoading(false)
        }, (error) => {
          if (!live || controller.signal.aborted) return
          setState({ status: 'failed', error: error?.message ?? String(error) })
          setLoading(false)
        })
        return () => { live = false; controller.abort() }
      }, [req])

      useEffect(() => {
        const timer = setInterval(() => setReq(previous => ({ id: previous.id + 1, force: false })), POLL_MS)
        return () => clearInterval(timer)
      }, [])

      const reload = useCallback(() => {
        setLoading(true)
        setReq(previous => ({ id: previous.id + 1, force: true }))
      }, [])

      const value = state.status === 'ready' ? state.value : undefined
      const data = value?.data
      const providers = data !== undefined && data.providers !== null && typeof data.providers === 'object' ? data.providers : undefined
      const rows = providers === undefined ? [] : ordered(providers)
      const stamp = clock(data?.generated_at) ?? clock(value?.at)

      return h('div', { className: 'up_page' },
        h('style', null, CSS),
        h('div', { className: 'up_head' },
          h('div', { className: 'up_stamp' },
            stamp === undefined ? null : h('span', null, tr('updated', { time: stamp })),
            text(value?.source) === undefined ? null : h('span', null, tr('source', { host: host(value.source) }))),
          h('button', {
            type: 'button', className: 'up_btn', disabled: loading,
            onClick: reload,
          }, loading ? tr('reloading') : tr('reload'))),
        state.status === 'failed'
          ? h('section', { className: 'up_card' },
            h('div', { className: 'up_error' },
              h('span', null, tr('failed')),
              h('span', { className: 'up_muted' }, tr('failedHint')),
              h('code', null, state.error)))
          : null,
        state.status === 'ready' && Array.isArray(value?.errors) && value.errors.length > 0
          ? h('section', { className: 'up_card' },
            h('div', { className: 'up_error' },
              h('span', null, tr('failed')),
              h('span', { className: 'up_muted' }, tr('failedHint')),
              value.errors.map((line, index) => h('code', { key: `${index}` }, line))))
          : null,
        rows.length === 0
          ? state.status === 'ready' && data !== undefined ? h('p', { className: 'up_muted' }, tr('empty')) : null
          : rows.map(row => h(Provider, { key: row.key, tr, title: row.title, provider: row.provider })),
        data === undefined ? null : h(Cooldowns, { tr, list: data.cooldowns }))
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        services = ctx
        ctx.effect(() => ctx.locale.register(NS, { ja, en, zh }), 'usage-panel: dictionaries')
        const bound = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'usage-panel', order: 52,
          label: () => translator(bound)('nav'), locale: NS,
        }, UsagePage))
      },
    }
  },
})
