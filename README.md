# Tavily & Brave Web Search Tools

为 DeepSeek Harness Agent 提供一个统一网络搜索工具：`search_web`。

插件根据密钥配置自动选择提供商：

1. 配置了 `tavilyApiKey` 且不在冷却期时使用 Tavily。
2. 没有 Tavily Key、但配置了 `braveApiKey` 时使用 Brave Search。
3. 两个 Key 都配置时优先 Tavily。
4. Tavily 返回 HTTP 432 或 433 时，立即用 Brave 重试，并在冷却期内跳过 Tavily。
5. 两个 Key 都未配置时，工具返回明确的配置错误。

工具返回统一、受限的结构：`provider`、`query`、可选 `answer`、`results[]` 和 `truncated`。每条结果最多包含标题、URL、摘要、发布时间和相关度分数；`provider` 会说明本次实际使用了 Tavily 还是 Brave。

## 配置

安装后，在主界面的“插件 → 已安装”中打开本插件，再点击 `dsh-web-search-tools` 行的“配置”：

- `disableBuiltInSearch`：默认开启，阻止 Agent 看到或调用 DeepSeek Harness 内置的 `web_search`；不影响 `web_fetch`。
- `tavilyApiKey`：Tavily API Key（Secret 字段；优先使用）。
- `braveApiKey`：Brave Search API subscription token（Secret 字段；Tavily 未配置时使用）。
- `tavilyBaseURL`：默认 `https://api.tavily.com`。
- `braveBaseURL`：默认 `https://api.search.brave.com/res/v1`。
- `timeoutMs`：单次请求超时，默认 30 秒。
- `tavilyQuotaCooldownMs`：Tavily 返回 HTTP 432/433 后的冷却时长，默认 600000 毫秒（10 分钟）。
- `maxResults`：每次最多返回 1–20 条结果，默认 10。
- `maxResponseBytes`：提供商 JSON 响应大小上限，默认 2 MiB。
- `maxSnippetChars`：每条摘要保留字符上限，默认 2000。

Secret 配置为 volatile，修改后后续请求会重新选择提供商，无需为密钥切换重启插件。

### Tavily 配额回退

Tavily 返回 HTTP 432 或 433 时会被视为使用次数或配额不足。若配置了 Brave Key，当前请求立即改用 Brave；后续请求在 `tavilyQuotaCooldownMs` 内直接使用 Brave，冷却结束后再尝试 Tavily。冷却状态仅保存在当前 Host 进程内，重载插件或重启 Host 后会清除。

如果没有配置 Brave Key，首次 432/433 会返回 Tavily 错误和明确的回退配置提示；冷却期内不会继续请求 Tavily。

### DeepSeek 内置搜索限制

开启 `disableBuiltInSearch` 后，插件通过 Agent 范围的 Tool 限制隐藏并拒绝调用内置 `web_search`，避免在未配置 DeepSeek 搜索凭据时被模型选中并报错。该开关不会禁用 `web_fetch`，也不会卸载共享 Web 服务。

关联的 DeepSeek 内置插件包为：

- `@deepseek-ai/dsh-tool-web`：注册模型侧 `web_search` 和 `web_fetch` 工具；本插件只限制其中的 `web_search`。
- `@deepseek-ai/dsh-web-search-deepseek`：DeepSeek 搜索提供商。
- `@deepseek-ai/dsh-web-deepseek-api`：DeepSeek 搜索 API 适配器。

## `search_web` 参数

- `query`：必填搜索词。
- `max_results`：可选，1 到配置的 `maxResults`。
- `freshness`：可选，`day`、`week`、`month` 或 `year`。

`freshness` 会自动映射为 Tavily 的 `time_range` 或 Brave 的 `pd`、`pw`、`pm`、`py`。为保证同一个工具在两个提供商下行为一致，不暴露只适用于单个提供商的参数。

## 安全与输出控制

- 请求遵从 Agent 的取消信号，并叠加插件超时。
- Tavily 凭据通过 `Authorization: Bearer` 发送；Brave 凭据通过 `X-Subscription-Token` 发送。
- 成功和失败响应都受字节上限约束；错误只提取有限长度的公开错误信息和 request id。
- 仅保留 HTTP(S) 结果 URL；摘要会清理简单 HTML、合并空白并截断。
- 不返回提供商原始响应，也不会把 API Key 写入工具参数、错误或结果。

API 参数参考：[Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) 和 [Brave Search API](https://api.search.brave.com/app/documentation/web-search/get-started)。
