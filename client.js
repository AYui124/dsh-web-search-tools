window.__ModuleLoader__.load({
  id: '@ayui124/dsh-web-search-tools',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'web-search-tools'
    const FIELDS = ['tavilyBaseURL', 'braveBaseURL', 'timeoutMs', 'maxResults', 'maxResponseBytes', 'maxSnippetChars']
    const SECRET_FIELDS = ['tavilyApiKey', 'braveApiKey']
    const defaults = {
      tavilyBaseURL: 'https://api.tavily.com',
      braveBaseURL: 'https://api.search.brave.com/res/v1',
      timeoutMs: 30000,
      maxResults: 10,
      maxResponseBytes: 2097152,
      maxSnippetChars: 2000,
    }
    const dictionaries = {
      en: {
        summary: 'Configure one auto-routed search tool. Tavily is preferred when both provider keys are saved.',
        loading: 'Loading web search settings…', unavailable: 'This configuration is unavailable.', readOnly: 'This configuration is read-only.',
        credentials: 'Search providers', limits: 'Request and output limits', tavilyBaseURL: 'Tavily base URL', braveBaseURL: 'Brave base URL',
        tavilyApiKey: 'Tavily API key', braveApiKey: 'Brave subscription token', secretHint: 'Leave blank to keep the saved secret unchanged.',
        clearTavilyApiKey: 'Clear saved Tavily API key', clearBraveApiKey: 'Clear saved Brave subscription token',
        timeoutMs: 'Request timeout (ms)', maxResults: 'Maximum results per call', maxResponseBytes: 'Maximum response bytes', maxSnippetChars: 'Maximum characters per snippet',
        save: 'Save settings', saving: 'Saving…', saved: 'Settings saved.', refused: 'The Host refused this change. Refresh and try again.',
        failed: 'Could not save: {message}', reset: 'Restore defaults', resetConfirm: 'Restore all fields, including saved API keys, to their composed defaults?',
      },
      zh: {
        summary: '配置一个自动路由的搜索工具；两个密钥都保存时优先使用 Tavily。',
        loading: '正在加载网络搜索设置…', unavailable: '此配置当前不可用。', readOnly: '此配置为只读。',
        credentials: '搜索提供商', limits: '请求与输出限制', tavilyBaseURL: 'Tavily 基础 URL', braveBaseURL: 'Brave 基础 URL',
        tavilyApiKey: 'Tavily API Key', braveApiKey: 'Brave Subscription Token', secretHint: '留空将保持已保存的密钥不变。',
        clearTavilyApiKey: '清除已保存的 Tavily API Key', clearBraveApiKey: '清除已保存的 Brave Subscription Token',
        timeoutMs: '请求超时（毫秒）', maxResults: '单次最大结果数', maxResponseBytes: '最大响应字节数', maxSnippetChars: '每条摘要最大字符数',
        save: '保存配置', saving: '保存中…', saved: '配置已保存。', refused: 'Host 拒绝了本次修改，请刷新后重试。',
        failed: '保存失败：{message}', reset: '恢复默认值', resetConfirm: '确定让所有字段（包括已保存的 API Key）恢复为组合默认值吗？',
      },
    }

    function TextField({ label, name, value, onChange, type = 'text', hint, min, max }) {
      return h('label', { className: 'wst-field' },
        h('span', { className: 'wst-label' }, label),
        h('input', { className: 'wst-input', name, type, value, min, max, onChange: event => onChange(event.target.value), autoComplete: type === 'password' ? 'new-password' : 'off' }),
        hint ? h('span', { className: 'wst-hint' }, hint) : null,
      )
    }

    const acceptedValues = value => Object.fromEntries(FIELDS.map(field => [field, value?.[field] ?? defaults[field]]))

    function SearchToolsConfigPage({ form, t }) {
      const revision = form.state.revision
      const accepted = acceptedValues(form.state.value)
      const [draft, setDraft] = React.useState(accepted)
      const [secrets, setSecrets] = React.useState({ tavilyApiKey: '', braveApiKey: '' })
      const [cleared, setCleared] = React.useState({ tavilyApiKey: false, braveApiKey: false })
      const [status, setStatus] = React.useState(null)
      const [saving, setSaving] = React.useState(false)

      React.useEffect(() => {
        setDraft(acceptedValues(form.state.value))
        setSecrets({ tavilyApiKey: '', braveApiKey: '' })
        setCleared({ tavilyApiKey: false, braveApiKey: false })
      }, [revision])

      const set = (field, value) => setDraft(current => ({ ...current, [field]: value }))
      const setSecret = (field, value) => {
        setSecrets(current => ({ ...current, [field]: value }))
        if (value.length > 0) setCleared(current => ({ ...current, [field]: false }))
      }
      const setClear = (field, value) => {
        setCleared(current => ({ ...current, [field]: value }))
        if (value) setSecrets(current => ({ ...current, [field]: '' }))
      }
      const numberField = (name, min, max) => h(TextField, {
        label: t(name), name, type: 'number', min, max, value: String(draft[name]),
        onChange: value => set(name, Math.max(min, Math.min(max, Number(value) || min))),
      })

      const save = async event => {
        event.preventDefault()
        if (!form.state.writable || saving) return
        setSaving(true)
        setStatus(null)
        const ops = FIELDS.filter(field => draft[field] !== accepted[field]).map(field => ({ op: 'set', path: [field], value: draft[field] }))
        for (const field of SECRET_FIELDS) {
          if (cleared[field]) ops.push({ op: 'unset', path: [field] })
          else if (secrets[field].length > 0) ops.push({ op: 'set', path: [field], value: secrets[field] })
        }
        try {
          const ok = ops.length === 0 || await form.mutate(ops, revision)
          setStatus({ ok, text: ok ? t('saved') : t('refused') })
          if (ok) {
            setSecrets({ tavilyApiKey: '', braveApiKey: '' })
            setCleared({ tavilyApiKey: false, braveApiKey: false })
          }
        } catch (error) {
          setStatus({ ok: false, text: t('failed', { message: error instanceof Error ? error.message : String(error) }) })
        } finally {
          setSaving(false)
        }
      }

      const reset = async () => {
        if (!form.state.writable || saving || !window.confirm(t('resetConfirm'))) return
        setSaving(true)
        setStatus(null)
        try {
          const ok = await form.mutate([...FIELDS, ...SECRET_FIELDS].map(field => ({ op: 'unset', path: [field] })), revision)
          setStatus({ ok, text: ok ? t('saved') : t('refused') })
        } catch (error) {
          setStatus({ ok: false, text: t('failed', { message: error instanceof Error ? error.message : String(error) }) })
        } finally {
          setSaving(false)
        }
      }

      return h(React.Fragment, null,
        h('style', null, `
          .wst-form{display:flex;flex-direction:column;gap:20px;color:var(--dsw-alias-label-primary)}
          .wst-group{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
          .wst-group h4{grid-column:1/-1;margin:0;font-size:14px;font-weight:600}.wst-wide{grid-column:1/-1}
          .wst-field{display:flex;min-width:0;flex-direction:column;gap:6px}.wst-label{font-size:13px;font-weight:500}.wst-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
          .wst-input{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit}.wst-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
          .wst-check{display:flex;align-items:flex-start;gap:8px;font-size:13px}.wst-actions{display:flex;align-items:center;gap:10px}.wst-button{height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.wst-button-primary{border-color:var(--dsw-alias-brand-primary)}.wst-button:disabled{cursor:not-allowed;opacity:.55}.wst-status{margin:0;font-size:13px}.wst-error{color:var(--dsw-alias-state-error-primary)}.wst-success{color:var(--dsw-alias-state-success-primary)}
          @media(max-width:720px){.wst-group{grid-template-columns:1fr}}
        `),
        h('form', { className: 'wst-form', onSubmit: save },
          h('section', { className: 'wst-group' },
            h('h4', null, t('credentials')),
            h('div', { className: 'wst-wide' }, h(TextField, { label: t('tavilyBaseURL'), name: 'tavilyBaseURL', value: draft.tavilyBaseURL, onChange: value => set('tavilyBaseURL', value) })),
            h(TextField, { label: t('tavilyApiKey'), name: 'tavilyApiKey', type: 'password', value: secrets.tavilyApiKey, onChange: value => setSecret('tavilyApiKey', value), hint: t('secretHint') }),
            h('label', { className: 'wst-check' }, h('input', { type: 'checkbox', checked: cleared.tavilyApiKey, onChange: event => setClear('tavilyApiKey', event.target.checked) }), h('span', null, t('clearTavilyApiKey'))),
            h('div', { className: 'wst-wide' }, h(TextField, { label: t('braveBaseURL'), name: 'braveBaseURL', value: draft.braveBaseURL, onChange: value => set('braveBaseURL', value) })),
            h(TextField, { label: t('braveApiKey'), name: 'braveApiKey', type: 'password', value: secrets.braveApiKey, onChange: value => setSecret('braveApiKey', value), hint: t('secretHint') }),
            h('label', { className: 'wst-check' }, h('input', { type: 'checkbox', checked: cleared.braveApiKey, onChange: event => setClear('braveApiKey', event.target.checked) }), h('span', null, t('clearBraveApiKey'))),
          ),
          h('section', { className: 'wst-group' },
            h('h4', null, t('limits')),
            numberField('timeoutMs', 1, 2147483647), numberField('maxResults', 1, 20),
            numberField('maxResponseBytes', 1, Number.MAX_SAFE_INTEGER), numberField('maxSnippetChars', 100, 10000),
          ),
          !form.state.writable ? h('p', { className: 'wst-status wst-error', role: 'status' }, t('readOnly')) : null,
          status ? h('p', { className: `wst-status ${status.ok ? 'wst-success' : 'wst-error'}`, role: 'status' }, status.text) : null,
          h('div', { className: 'wst-actions' },
            h('button', { className: 'wst-button wst-button-primary', type: 'submit', disabled: saving || !form.state.writable }, saving ? t('saving') : t('save')),
            h('button', { className: 'wst-button', type: 'button', disabled: saving || !form.state.writable, onClick: reset }, t('reset')),
          ),
        ),
      )
    }

    function SearchToolsConfig({ view, form, t }) {
      if (view === 'summary') return h('span', null, t('summary'))
      if (!form || form.state.status === 'loading') return h('p', { role: 'status' }, t('loading'))
      if (form.state.status !== 'ready' || !form.state.value) return h('p', { role: 'status' }, t('unavailable'))
      return h(SearchToolsConfigPage, { form, t })
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries))
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: '@ayui124/dsh-web-search-tools#web-search-tools',
          locale: NS,
        }, SearchToolsConfig))
      },
    }
  },
})
