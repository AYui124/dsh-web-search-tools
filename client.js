window.__ModuleLoader__.load({
  id: '@ayui124/dsh-web-search-tools',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'web-search-tools'
    const FIELDS = [
      'disableBuiltInSearch', 'tavilyApiKeyEnv', 'braveApiKeyEnv', 'tavilyBaseURL', 'braveBaseURL',
      'timeoutMs', 'tavilyQuotaCooldownMs', 'maxResults', 'maxResponseBytes', 'maxSnippetChars',
    ]
    const defaults = {
      disableBuiltInSearch: true,
      tavilyApiKeyEnv: 'TAVILY_API_KEY',
      braveApiKeyEnv: 'BRAVE_SEARCH_API_KEY',
      tavilyBaseURL: 'https://api.tavily.com',
      braveBaseURL: 'https://api.search.brave.com/res/v1',
      timeoutMs: 30000,
      tavilyQuotaCooldownMs: 600000,
      maxResults: 10,
      maxResponseBytes: 2097152,
      maxSnippetChars: 2000,
    }
    const BUILT_IN_SEARCH_PACKAGES = [
      '@deepseek-ai/dsh-tool-web',
      '@deepseek-ai/dsh-web-search-deepseek',
      '@deepseek-ai/dsh-web-deepseek-api',
    ]
    const dictionaries = {
      en: {
        summary: 'Configure one auto-routed search tool. Tavily is preferred when both provider credentials are saved.',
        loading: 'Loading web search settings…', unavailable: 'This configuration is unavailable.', readOnly: 'This configuration is read-only.',
        builtInSearch: 'Built-in DeepSeek search', disableBuiltInSearch: 'Prevent agents from calling the built-in web_search tool', disableBuiltInSearchHint: 'Recommended when no DeepSeek search credential is configured. The built-in web_fetch tool remains available.', affectedPlugins: 'Associated built-in packages:',
        credentials: 'Search providers', limits: 'Request and output limits', tavilyBaseURL: 'Tavily base URL', braveBaseURL: 'Brave base URL',
        tavilyApiKeyEnv: 'Tavily credential reference', braveApiKeyEnv: 'Brave credential reference', credentialRefHint: 'The secret is stored by DSH Credentials, never in cordis.patch.yml.',
        tavilyApiKey: 'Tavily API key', braveApiKey: 'Brave subscription token', secretHint: 'Leave blank to keep the credential unchanged.',
        credentialConfigured: 'Credential configured', credentialMissing: 'Credential not configured', credentialReadOnly: 'Credential storage is read-only.',
        saveCredential: 'Save credential', clearCredential: 'Clear credential', credentialSaved: 'Credential saved.', credentialCleared: 'Credential cleared.', saveReferenceFirst: 'Save the credential reference before changing its secret.',
        timeoutMs: 'Request timeout (ms)', tavilyQuotaCooldownMs: 'Tavily quota cooldown (ms)', maxResults: 'Maximum results per call', maxResponseBytes: 'Maximum response bytes', maxSnippetChars: 'Maximum characters per snippet',
        save: 'Save settings', saving: 'Saving…', saved: 'Settings saved.', refused: 'The Host refused this change. Refresh and try again.',
        failed: 'Could not save: {message}', invalidCredentialRef: 'Credential references must match ^[A-Za-z_][A-Za-z0-9_]*$.', duplicateCredentialRefs: 'Tavily and Brave credential references must be different.', reset: 'Restore defaults', resetConfirm: 'Restore all non-secret fields to their composed defaults?',
      },
      zh: {
        summary: '配置一个自动路由的搜索工具；两个凭据都保存时优先使用 Tavily。',
        loading: '正在加载网络搜索设置…', unavailable: '此配置当前不可用。', readOnly: '此配置为只读。',
        builtInSearch: 'DeepSeek 内置搜索', disableBuiltInSearch: '阻止 Agent 调用内置 web_search 工具', disableBuiltInSearchHint: '未配置 DeepSeek 搜索凭据时建议开启；内置 web_fetch 工具仍然可用。', affectedPlugins: '关联的内置插件：',
        credentials: '搜索提供商', limits: '请求与输出限制', tavilyBaseURL: 'Tavily 基础 URL', braveBaseURL: 'Brave 基础 URL',
        tavilyApiKeyEnv: 'Tavily 凭据引用', braveApiKeyEnv: 'Brave 凭据引用', credentialRefHint: '密钥由 DSH Credentials 保存，绝不会写入 cordis.patch.yml。',
        tavilyApiKey: 'Tavily API Key', braveApiKey: 'Brave Subscription Token', secretHint: '留空将保持 Credentials 中的密钥不变。',
        credentialConfigured: '凭据已配置', credentialMissing: '凭据未配置', credentialReadOnly: '凭据存储为只读。',
        saveCredential: '保存凭据', clearCredential: '清除凭据', credentialSaved: '凭据已保存。', credentialCleared: '凭据已清除。', saveReferenceFirst: '请先保存凭据引用，再修改对应密钥。',
        timeoutMs: '请求超时（毫秒）', tavilyQuotaCooldownMs: 'Tavily 配额冷却时间（毫秒）', maxResults: '单次最大结果数', maxResponseBytes: '最大响应字节数', maxSnippetChars: '每条摘要最大字符数',
        save: '保存配置', saving: '保存中…', saved: '配置已保存。', refused: 'Host 拒绝了本次修改，请刷新后重试。',
        failed: '保存失败：{message}', invalidCredentialRef: '凭据引用必须匹配 ^[A-Za-z_][A-Za-z0-9_]*$。', duplicateCredentialRefs: 'Tavily 与 Brave 的凭据引用必须不同。', reset: '恢复默认值', resetConfirm: '确定让所有非密钥字段恢复为组合默认值吗？',
      },
    }

    function TextField({ label, name, value, onChange, type = 'text', hint, min, max, disabled = false }) {
      return h('label', { className: 'wst-field' },
        h('span', { className: 'wst-label' }, label),
        h('input', { className: 'wst-input', name, type, value, min, max, disabled, onChange: event => onChange(event.target.value), autoComplete: type === 'password' ? 'new-password' : 'off' }),
        hint ? h('span', { className: 'wst-hint' }, hint) : null,
      )
    }

    const acceptedValues = value => Object.fromEntries(FIELDS.map(field => [field, value?.[field] ?? defaults[field]]))
    const emptyCredential = () => ({ configured: false, writable: true, source: '' })
    const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
    const remoteError = (response, fallback) => response?.error?.message ?? response?.error?.detail ?? fallback
    const requireRemote = async (operation, fallback) => {
      const response = await operation
      if (!response.ok) throw new Error(remoteError(response, fallback))
      return response.value
    }

    function SearchToolsConfigPage({ ctx, form, t }) {
      const revision = form.state.revision
      const accepted = acceptedValues(form.state.value)
      const [draft, setDraft] = React.useState(accepted)
      const [secrets, setSecrets] = React.useState({ tavily: '', brave: '' })
      const [credentialInfo, setCredentialInfo] = React.useState({ tavily: emptyCredential(), brave: emptyCredential() })
      const [credentialSaving, setCredentialSaving] = React.useState({ tavily: false, brave: false })
      const [credentialStatus, setCredentialStatus] = React.useState({ tavily: null, brave: null })
      const [status, setStatus] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const tavilyRef = draft.tavilyApiKeyEnv.trim() || defaults.tavilyApiKeyEnv
      const braveRef = draft.braveApiKeyEnv.trim() || defaults.braveApiKeyEnv

      const refreshCredentials = React.useCallback(async (expectedTavily = tavilyRef, expectedBrave = braveRef) => {
        const response = await ctx.remote.credentials.describe([expectedTavily, expectedBrave])
        if (!response.ok || expectedTavily !== (draft.tavilyApiKeyEnv.trim() || defaults.tavilyApiKeyEnv) || expectedBrave !== (draft.braveApiKeyEnv.trim() || defaults.braveApiKeyEnv)) return
        const info = response.value
        setCredentialInfo({
          tavily: { configured: info[expectedTavily]?.configured ?? false, writable: info[expectedTavily]?.writable ?? true, source: info[expectedTavily]?.source ?? '' },
          brave: { configured: info[expectedBrave]?.configured ?? false, writable: info[expectedBrave]?.writable ?? true, source: info[expectedBrave]?.source ?? '' },
        })
      }, [ctx, draft.tavilyApiKeyEnv, draft.braveApiKeyEnv])

      React.useEffect(() => {
        setDraft(acceptedValues(form.state.value))
        setSecrets({ tavily: '', brave: '' })
        setCredentialStatus({ tavily: null, brave: null })
      }, [revision])

      React.useEffect(() => {
        let active = true
        const refs = [tavilyRef, braveRef]
        const read = () => ctx.remote.credentials.describe(refs).then(response => {
          if (!active || !response.ok) return
          const info = response.value
          setCredentialInfo({
            tavily: { configured: info[tavilyRef]?.configured ?? false, writable: info[tavilyRef]?.writable ?? true, source: info[tavilyRef]?.source ?? '' },
            brave: { configured: info[braveRef]?.configured ?? false, writable: info[braveRef]?.writable ?? true, source: info[braveRef]?.source ?? '' },
          })
        })
        read()
        const off = ctx.remote.$on('credentials/reference-updated', changed => {
          if (changed === tavilyRef || changed === braveRef) read()
        })
        return () => { active = false; off() }
      }, [ctx, tavilyRef, braveRef, revision])

      const set = (field, value) => setDraft(current => ({ ...current, [field]: value }))
      const setSecret = (provider, value) => {
        setSecrets(current => ({ ...current, [provider]: value }))
        setCredentialStatus(current => ({ ...current, [provider]: null }))
      }
      const numberField = (name, min, max) => h(TextField, {
        label: t(name), name, type: 'number', min, max, value: String(draft[name]),
        onChange: value => set(name, Math.max(min, Math.min(max, Number(value) || min))),
      })
      const credentialHint = provider => {
        const info = credentialInfo[provider]
        return `${t('secretHint')} ${info.configured ? t('credentialConfigured') : t('credentialMissing')}${info.source ? ` (${info.source})` : ''}`
      }

      const validateRefs = () => {
        if (!CREDENTIAL_REF_PATTERN.test(tavilyRef) || !CREDENTIAL_REF_PATTERN.test(braveRef)) throw new Error(t('invalidCredentialRef'))
        if (tavilyRef === braveRef) throw new Error(t('duplicateCredentialRefs'))
      }

      const save = async event => {
        event.preventDefault()
        if (!form.state.writable || saving) return
        setSaving(true)
        setStatus(null)
        const ops = FIELDS.filter(field => draft[field] !== accepted[field]).map(field => ({ op: 'set', path: [field], value: draft[field] }))
        try {
          validateRefs()
          const ok = ops.length === 0 || await form.mutate(ops, revision)
          if (!ok) throw new Error(t('refused'))
          setStatus({ ok: true, text: t('saved') })
        } catch (error) {
          setStatus({ ok: false, text: t('failed', { message: error instanceof Error ? error.message : String(error) }) })
        } finally {
          setSaving(false)
        }
      }

      const mutateCredential = async (provider, action) => {
        if (credentialSaving[provider] || !credentialInfo[provider].writable) return
        const ref = provider === 'tavily' ? tavilyRef : braveRef
        const acceptedRef = provider === 'tavily'
          ? (accepted.tavilyApiKeyEnv.trim() || defaults.tavilyApiKeyEnv)
          : (accepted.braveApiKeyEnv.trim() || defaults.braveApiKeyEnv)
        setCredentialSaving(current => ({ ...current, [provider]: true }))
        setCredentialStatus(current => ({ ...current, [provider]: null }))
        try {
          validateRefs()
          if (ref !== acceptedRef) throw new Error(t('saveReferenceFirst'))
          if (action === 'set') {
            const value = secrets[provider].trim()
            if (value.length === 0) return
            await requireRemote(ctx.remote.credentials.set(ref, value), `Could not save the ${provider} credential.`)
          } else {
            await requireRemote(ctx.remote.credentials.unset(ref), `Could not clear the ${provider} credential.`)
          }
          await refreshCredentials(tavilyRef, braveRef)
          setSecrets(current => ({ ...current, [provider]: '' }))
          setCredentialStatus(current => ({ ...current, [provider]: { ok: true, text: t(action === 'set' ? 'credentialSaved' : 'credentialCleared') } }))
        } catch (error) {
          setCredentialStatus(current => ({ ...current, [provider]: { ok: false, text: t('failed', { message: error instanceof Error ? error.message : String(error) }) } }))
        } finally {
          setCredentialSaving(current => ({ ...current, [provider]: false }))
        }
      }

      const reset = async () => {
        if (!form.state.writable || saving || !window.confirm(t('resetConfirm'))) return
        setSaving(true)
        setStatus(null)
        try {
          const ok = await form.mutate(FIELDS.map(field => ({ op: 'unset', path: [field] })), revision)
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
          .wst-check{display:flex;align-items:flex-start;gap:8px;font-size:13px}.wst-check-copy{display:flex;flex-direction:column;gap:4px}.wst-packages{grid-column:1/-1;margin:0;padding-left:20px;color:var(--dsw-alias-label-secondary);font:12px/20px ui-monospace,SFMono-Regular,Menlo,monospace}.wst-actions{display:flex;align-items:center;gap:10px}.wst-button{height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.wst-button-primary{border-color:var(--dsw-alias-brand-primary)}.wst-button:disabled{cursor:not-allowed;opacity:.55}.wst-status{margin:0;font-size:13px}.wst-error{color:var(--dsw-alias-state-error-primary)}.wst-success{color:var(--dsw-alias-state-success-primary)}
          @media(max-width:720px){.wst-group{grid-template-columns:1fr}}
        `),
        h('form', { className: 'wst-form', onSubmit: save },
          h('section', { className: 'wst-group' },
            h('h4', null, t('builtInSearch')),
            h('label', { className: 'wst-check wst-wide' },
              h('input', { type: 'checkbox', checked: draft.disableBuiltInSearch, onChange: event => set('disableBuiltInSearch', event.target.checked) }),
              h('span', { className: 'wst-check-copy' }, h('span', null, t('disableBuiltInSearch')), h('span', { className: 'wst-hint' }, t('disableBuiltInSearchHint'))),
            ),
            h('div', { className: 'wst-wide wst-hint' }, t('affectedPlugins')),
            h('ul', { className: 'wst-packages' }, ...BUILT_IN_SEARCH_PACKAGES.map(packageName => h('li', { key: packageName }, packageName))),
          ),
          h('section', { className: 'wst-group' },
            h('h4', null, t('credentials')),
            h('div', { className: 'wst-wide' }, h(TextField, { label: t('tavilyBaseURL'), name: 'tavilyBaseURL', value: draft.tavilyBaseURL, onChange: value => set('tavilyBaseURL', value) })),
            h(TextField, { label: t('tavilyApiKeyEnv'), name: 'tavilyApiKeyEnv', value: draft.tavilyApiKeyEnv, onChange: value => set('tavilyApiKeyEnv', value), hint: t('credentialRefHint') }),
            h(TextField, { label: t('tavilyApiKey'), name: 'tavilyApiKey', type: 'password', value: secrets.tavily, disabled: !credentialInfo.tavily.writable, onChange: value => setSecret('tavily', value), hint: credentialHint('tavily') }),
            h('div', { className: 'wst-actions wst-wide' },
              h('button', { className: 'wst-button wst-button-primary', type: 'button', disabled: credentialSaving.tavily || !credentialInfo.tavily.writable || secrets.tavily.trim().length === 0, onClick: () => mutateCredential('tavily', 'set') }, credentialSaving.tavily ? t('saving') : t('saveCredential')),
              h('button', { className: 'wst-button', type: 'button', disabled: credentialSaving.tavily || !credentialInfo.tavily.writable, onClick: () => mutateCredential('tavily', 'unset') }, t('clearCredential')),
              !credentialInfo.tavily.writable ? h('span', { className: 'wst-hint' }, t('credentialReadOnly')) : null,
            ),
            credentialStatus.tavily ? h('p', { className: `wst-status wst-wide ${credentialStatus.tavily.ok ? 'wst-success' : 'wst-error'}`, role: 'status' }, credentialStatus.tavily.text) : null,
            h('div', { className: 'wst-wide' }, h(TextField, { label: t('braveBaseURL'), name: 'braveBaseURL', value: draft.braveBaseURL, onChange: value => set('braveBaseURL', value) })),
            h(TextField, { label: t('braveApiKeyEnv'), name: 'braveApiKeyEnv', value: draft.braveApiKeyEnv, onChange: value => set('braveApiKeyEnv', value), hint: t('credentialRefHint') }),
            h(TextField, { label: t('braveApiKey'), name: 'braveApiKey', type: 'password', value: secrets.brave, disabled: !credentialInfo.brave.writable, onChange: value => setSecret('brave', value), hint: credentialHint('brave') }),
            h('div', { className: 'wst-actions wst-wide' },
              h('button', { className: 'wst-button wst-button-primary', type: 'button', disabled: credentialSaving.brave || !credentialInfo.brave.writable || secrets.brave.trim().length === 0, onClick: () => mutateCredential('brave', 'set') }, credentialSaving.brave ? t('saving') : t('saveCredential')),
              h('button', { className: 'wst-button', type: 'button', disabled: credentialSaving.brave || !credentialInfo.brave.writable, onClick: () => mutateCredential('brave', 'unset') }, t('clearCredential')),
              !credentialInfo.brave.writable ? h('span', { className: 'wst-hint' }, t('credentialReadOnly')) : null,
            ),
            credentialStatus.brave ? h('p', { className: `wst-status wst-wide ${credentialStatus.brave.ok ? 'wst-success' : 'wst-error'}`, role: 'status' }, credentialStatus.brave.text) : null,
          ),
          h('section', { className: 'wst-group' },
            h('h4', null, t('limits')),
            numberField('timeoutMs', 1, 2147483647), numberField('tavilyQuotaCooldownMs', 1, 2147483647),
            numberField('maxResults', 1, 20),
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

    function SearchToolsConfig({ ctx, view, form, t }) {
      if (view === 'summary') return h('span', null, t('summary'))
      if (!form || form.state.status === 'loading') return h('p', { role: 'status' }, t('loading'))
      if (form.state.status !== 'ready' || !form.state.value) return h('p', { role: 'status' }, t('unavailable'))
      return h(SearchToolsConfigPage, { ctx, form, t })
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries))
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: '@ayui124/dsh-web-search-tools#dsh-web-search-tools',
          locale: NS,
        }, props => h(SearchToolsConfig, { ...props, ctx })))
      },
    }
  },
})
