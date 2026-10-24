# Tavily & Brave Web Search Tools

为 DeepSeek Harness Agent 提供一个统一网络搜索工具：`search_web`。

插件根据密钥配置自动选择提供商：

1. 配置了 `tavilyApiKey` 时使用 Tavily。
2. 没有 Tavily Key、但配置了 `braveApiKey` 时使用 Brave Search。
3. 两个 Key 都配置时优先 Tavily。
4. 两个 Key 都未配置时，工具返回明确的配置错误。

工具返回统一、受限的结构：`provider`、`query`、可选 `answer`、`results[]` 和 `truncated`。每条结果最多包含标题、URL、摘要、发布时间和相关度分数；`provider` 会说明本次实际使用了 Tavily 还是 Brave。

## 配置

安装后，在主界面的“插件 → 已安装”中打开本插件，再点击 `dsh-web-search-tools` 行的“配置”：

- `tavilyApiKey`：Tavily API Key（Secret 字段；优先使用）。
- `braveApiKey`：Brave Search API subscription token（Secret 字段；Tavily 未配置时使用）。
- `tavilyBaseURL`：默认 `https://api.tavily.com`。
- `braveBaseURL`：默认 `https://api.search.brave.com/res/v1`。
- `timeoutMs`：单次请求超时，默认 30 秒。
- `maxResults`：每次最多返回 1–20 条结果，默认 10。
- `maxResponseBytes`：提供商 JSON 响应大小上限，默认 2 MiB。
- `maxSnippetChars`：每条摘要保留字符上限，默认 2000。

Secret 配置为 volatile，修改后后续请求会重新选择提供商，无需为密钥切换重启插件。

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
