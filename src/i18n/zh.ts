// English source text -> Chinese. Keep in sync with t('...') calls and the dynamic strings that
// are translated at render time (registry notes, meter labels, service messages).
// A test enforces coverage.
export const zh: Record<string, string> = {
  // Codex Reset public data
  'Global reset radar': '全局重置雷达',
  "See how likely OpenAI is to reset everyone's Codex limits early. Data comes from codex-reset.com, an independent site; you confirm before anything is requested.":
    '查看 OpenAI 为所有人提前重置 Codex 额度的可能性。数据来自独立网站 codex-reset.com，发起任何请求前都会先征得你的同意。',
  'Turn on': '开启',
  'Turn off global reset radar': '关闭全局重置雷达',
  'Chance of a global reset in the next 24 hours': '未来 24 小时发生全局重置的可能性',
  Low: '较低',
  Possible: '有可能',
  High: '较高',
  '48 hours: {percent}': '48 小时：{percent}',
  Now: '现在',
  '▲ Your weekly reset': '▲ 你的周额度重置',
  'Your weekly reset is later →': '你的周额度重置更晚 →',
  'Your weekly quota resets on its own in {time}.': '你的周额度将在 {time}后自行重置。',
  'Your weekly quota is {used}% used and resets on its own in {time}.':
    '你的周额度已用 {used}%，将在 {time}后自行重置。',
  'Last 30 days': '近 30 天',
  '{confirmed} confirmed · {signals} signals': '已确认 {confirmed} 天 · 信号 {signals} 天',
  'Last 30 days: {confirmed} days with a confirmed reset, {signals} with an unconfirmed signal':
    '近 30 天：{confirmed} 天有已确认重置，{signals} 天有未确认信号',
  'Average interval': '平均间隔',
  'about {n} days': '约 {n} 天',
  'History and service status': '历史与服务状态',
  'Outdated data': '数据已过期',
  'Global reset {percent}%': '全局重置 {percent}%',
  'Global reset signal': '全局重置信号',
  'Global reset signal reported, not confirmed': '已报告全局重置信号，尚未确认',
  'Global reset chance in 24 hours: {percent}%': '24 小时内全局重置的可能性：{percent}%',
  // compact meter rows
  Due: '待重置',
  'Plan ends · {left}': '方案到期 · {left}',
  'About the data source': '了解数据来源',
  'Enable Codex Reset?': '开启 Codex Reset？',
  'Forecasts, global events and service status are fetched directly from codex-reset.com, an independent service, not OpenAI. Your API keys, ChatGPT access tokens, account IDs and personal usage are never sent to this site. Predictions do not guarantee your personal quota will recover. Allow public requests while this switch is on, including background refresh when available?':
    '预测、全局事件和服务状态直接从 codex-reset.com 获取，它是独立第三方服务，并非 OpenAI。你的 API Key、ChatGPT 登录令牌、账户 ID 和个人用量都不会发送给该网站。预测不保证你的个人额度恢复。是否同意在开关开启期间请求这些公共数据，包括系统允许的后台刷新？',
  'Agree and enable': '同意并开启',
  'Could not save the public data setting': '公共数据设置未能保存',
  'Try changing the switch again.': '请重新操作开关。',
  'View status report': '查看故障报告',
  'Today {time}': '今天 {time}',
  'Yesterday {time}': '昨天 {time}',
  Probability: '概率',
  Unknown: '未知',
  'Low confidence': '低置信度',
  'Medium confidence': '中等置信度',
  'High confidence': '高置信度',
  'Confidence unknown': '置信度未知',
  'Low-confidence forecast: treat these odds with caution.': '预测置信度较低，请谨慎参考这些概率。',
  'Last confirmed global reset': '上次已确认的全局重置',
  'Official signal reported': '来源报告了官方信号',
  'A signal is not a confirmed reset.': '信号不代表重置已确认发生。',
  'Independent prediction, not an OpenAI quota API. A global reset does not guarantee your personal quota will recover.':
    '独立第三方预测，并非 OpenAI 官方额度接口。全局重置不保证你的个人额度恢复。',
  'Unconfirmed signals and other announcements are not confirmed global resets.':
    '未确认信号和其他公告不代表已确认的全局重置。',
  'Confirmed reset': '已确认重置',
  'Unconfirmed reset signal': '未确认重置信号',
  'Usage boost announcement': '额度提升公告',
  'Unlock announcement': '功能开放公告',
  'Credits / banked reset announcement': '积分 / 储备重置公告',
  'Other announcement': '其他公告',
  'No confirmed resets reported.': '暂无已确认的重置记录。',
  'View announcement': '查看公告',
  'Show less': '收起',
  'Codex operational': 'Codex 运行正常',
  'Codex service incident reported': '来源报告了 Codex 服务故障',
  'Codex status unknown': 'Codex 状态未知',
  'A platform incident is different from exhausted personal quota.':
    '平台服务故障与个人额度耗尽是不同的问题。',
  'Ongoing incident': '故障处理中',
  'Status unknown': '状态未知',
  Resolved: '已恢复',
  'No public data available.': '暂无可用的公共数据。',
  'Source updated {time}': '来源更新时间：{time}',
  'Outdated data — showing the last available copy.': '数据已过期，当前显示最后可用的缓存。',
  'Codex Reset is rate limited. Retry later.': 'Codex Reset 请求受限，请稍后重试。',
  'Codex Reset request timed out.': 'Codex Reset 请求超时。',
  'Codex Reset returned unrecognized data.': 'Codex Reset 返回的数据无法识别。',
  'Codex Reset data unavailable. This does not indicate a Codex outage.':
    'Codex Reset 数据暂不可用，这不代表 Codex 服务故障。',
  // units / relative time
  used: '已用',
  balance: '余额',
  'of {limit}': '共 {limit}',
  'just now': '刚刚',
  '{n}m ago': '{n} 分钟前',
  '{n}h ago': '{n} 小时前',
  '{n}d ago': '{n} 天前',
  '{n}d': '{n}天',
  '{n}h': '{n}小时',
  'Updated {ago}': '{ago}更新',
  'Resets in {time}': '{time}后重置',
  'Reset due': '已到重置时间',

  // navigation / titles
  Usage: '用量',
  Settings: '设置',
  'Add account': '添加账号',
  Add: '添加',
  Accounts: '账号',

  // overview
  'Add your first account': '添加第一个账号',
  'Open this account to sign in again.': '请打开此账号重新登录。',
  'Tap refresh to load usage.': '点击刷新以加载用量。',
  Refresh: '刷新',
  General: '通用',
  On: '开启',
  Account: '账号',
  Background: '后台',
  'Accounts, credentials and usage history live only on this device. Nothing is sent to any server of ours.':
    '账号、凭据和用量历史只保存在这台设备上，不会发送到我们的任何服务器。',
  // API relays
  'API relay': '中转站',
  'Updated 1 account': '已刷新 1 个账号',
  'Updated {n} accounts': '已刷新 {n} 个账号',
  '1 account could not be refreshed': '1 个账号刷新失败',
  '{n} accounts could not be refreshed': '{n} 个账号刷新失败',
  'Refresh took too long. Some accounts may update a little later.':
    '刷新超时，部分账号可能稍后才会更新。',
  Dismiss: '关闭',
  Subscriptions: '订阅套餐',
  'Open platforms': '开放平台',
  Relays: '中转站',
  Other: '其他',
  'New v{version}': '新版本 v{version}',
  'New version {version} available': '有新版本 {version}',
  'Dismiss this version': '不再提示此版本',
  'Tip the author': '打赏作者',
  Afdian: '爱发电',
  Close: '关闭',
  // pay-as-you-go API accounts are all "<brand> Open Platform" / "<品牌> 开放平台"
  'OpenAI Open Platform': 'OpenAI 开放平台',
  'Anthropic Open Platform': 'Anthropic 开放平台',
  'Kimi Open Platform': 'Kimi 开放平台',
  'DeepSeek Open Platform': 'DeepSeek 开放平台',
  'Runway Open Platform': 'Runway 开放平台',
  "Needs an Admin API key (sk-admin-…) from platform.openai.com > Settings > Admin keys. Shows the organization's spend this month and today.":
    '需要 Admin API Key（sk-admin-…），在 platform.openai.com 的 Settings > Admin keys 中创建。显示组织本月与今日的花费。',
  "Needs an Admin API key (sk-ant-admin…) from platform.claude.com > Settings > Admin keys. Shows the organization's spend this month and today.":
    '需要 Admin API Key（sk-ant-admin…），在 platform.claude.com 的 Settings > Admin keys 中创建。显示组织本月与今日的花费。',
  'This key has no quota limit, so only spending can be shown: no remaining amount and no alerts. Set a quota for this key on the Tokens page of the relay site, then detect again.':
    '这个 Key 没有设置额度上限，只能显示已用金额：无法计算剩余额度，也无法在快用完时提醒你。请到中转站后台的「令牌」页面为该 Key 设置额度上限，然后重新识别。',
  'This key has no quota limit, so only spending can be shown: no remaining amount and no alerts. Set a quota limit for this key in the relay site, then detect again.':
    '这个 Key 没有设置额度上限，只能显示已用金额：无法计算剩余额度，也无法在快用完时提醒你。请到中转站后台为该 Key 设置额度上限，然后重新识别。',
  'Price currency': '月费货币',
  'New API, Sub2API, One API and other OpenAI-compatible relays: enter the site address and key, the rest is detected.':
    '支持 New API、Sub2API、One API 及其他 OpenAI 兼容中转站：只需填写站点地址和 Key，其余自动识别。',
  'Site address + API key': '站点地址 + API Key',
  'Works with New API, Sub2API, One API and other OpenAI-compatible relays. Only the address and key are needed; the software, site name and balance are detected.':
    '支持 New API、Sub2API、One API 及其他 OpenAI 兼容中转站。只需填写地址和 Key，程序类型、站点名称和余额会自动识别。',
  'Site address': '站点地址',
  'Stored in the device Keychain and sent only to this address.':
    '保存在设备钥匙串中，只会发送到这个地址。',
  Detect: '智能识别',
  Detected: '识别结果',
  'Enter a valid address, e.g. https://api.example.com':
    '请输入有效地址，例如 https://api.example.com',
  'Could not reach this address.': '无法连接这个地址。',
  'Use https://. Plain http:// is only allowed for addresses on your own network.':
    '请使用 https://。http:// 仅允许用于本机或局域网地址。',
  'Unrecognised software': '未识别的程序',
  Used: '已使用',
  Total: '总额度',
  Unlimited: '不限额',
  'This site does not expose a balance for this key, so it cannot be tracked.':
    '该站点没有开放这个 Key 的余额查询，暂时无法追踪。',
  'The key was rejected.': 'Key 被拒绝。',
  'Key is valid': 'Key 有效',
  'Key could not be checked': '无法验证 Key',
  'OpenAI compatible': '兼容 OpenAI',
  'Key quota': 'Key 额度',
  'Key usage': 'Key 用量',
  'Theme color': '主题色',
  Blue: '蓝色',
  Indigo: '靛蓝',
  Violet: '紫色',
  Pink: '粉色',
  Orange: '橙色',
  Green: '绿色',
  Teal: '青色',
  'Support AI Usage': '支持 AI Usage',
  'AI Usage is free and has no ads. If it helps you, consider supporting development.':
    'AI Usage 免费且没有广告。如果它对你有帮助，欢迎支持开发。',
  'Support on Afdian': '去爱发电支持',
  'Search providers': '搜索提供商',
  'No provider matches "{query}".': '没有找到与“{query}”匹配的提供商。',
  'Browser sign-in is not in this build, so a sign-in code is used instead. Install the current development build to sign in through the browser.':
    '当前版本不包含浏览器登录，已改用登录码登录。安装最新的开发版即可使用浏览器登录。',
  'Browser sign-in is not in this build. Use an API key, or install the current development build to sign in through the browser.':
    '当前版本不包含浏览器登录。请使用 API Key，或安装最新的开发版以使用浏览器登录。',
  Details: '详情',
  'No usage data.': '暂无用量数据。',

  // status badges
  Manual: '手动',
  'Not loaded yet': '尚未加载',
  'Login expired': '登录已失效',
  Unsupported: '不支持',
  Error: '出错',
  'Error · data from {ago}': '出错 · 数据来自 {ago}',

  // add flow
  'Manual (automatic support coming)': '手动（自动采集待支持）',
  'Manual only': '仅手动',
  'API key': 'API Key',
  'Sign in': '登录',
  'Track by hand for now': '暂时手动记录',
  'No usable data source': '没有可用的数据来源',
  'Unknown provider.': '未知的服务商。',
  'Automatic collection for this provider is not available yet. You can track it by hand and it will switch over later.':
    '此服务商暂不支持自动采集。可先手动记录，之后会切换为自动。',
  Name: '名称',
  Region: '区域',
  'Check and add': '检查并添加',
  'Could not add this account': '无法添加此账号',
  'Could not save the account. Please try again.': '无法保存账号，请重试。',
  Found: '已发现',
  Plan: '套餐',
  Custom: '自定义',
  'Plan name': '套餐名称',
  'Monthly price': '每月价格',
  'Limit ({unit})': '额度（{unit}）',
  Optional: '可选',
  'Current window started (minutes ago)': '当前窗口开始于（几分钟前）',
  'Resets every week on': '每周重置于',
  'Resets on day of month': '每月重置日',
  Sun: '日',
  Mon: '一',
  Tue: '二',
  Wed: '三',
  Thu: '四',
  Fri: '五',
  Sat: '六',

  // detail
  'Loading…': '加载中…',
  'This account no longer exists.': '此账号已不存在。',
  'Entered by hand': '手动录入',
  Meters: '计量项',
  '7 d': '7 天',
  'Record usage': '记录用量',
  'Set used (%)': '设置已用（%）',
  'Set used amount': '设置已用量',
  Save: '保存',
  'Refresh now': '立即刷新',
  'Edit plan': '编辑套餐',
  Rename: '重命名',
  'Remove account': '删除账号',
  'Remove this account?': '删除此账号？',
  Remove: '删除',
  Cancel: '取消',

  // language & appearance
  Language: '语言',
  Appearance: '外观',
  'Language & appearance': '语言与外观',
  'Follow system': '跟随系统',
  Light: '浅色',
  Dark: '深色',
  Chinese: '中文',
  English: '英文',
  Manage: '管理',

  // settings
  Data: '数据',
  'Delete all data': '删除所有数据',
  'Delete all data?': '删除所有数据？',
  'This removes every account, stored credential and usage history from this device. It cannot be undone.':
    '这会从本机删除所有账号、凭据和用量历史，且无法撤销。',
  'Delete everything': '全部删除',
  'Some data could not be deleted': '部分数据未能删除',
  'The remaining accounts are still listed. Try again, or remove them one by one.':
    '未删除的账号仍会显示。请重试，或逐个删除。',
  About: '关于',
  'Version {version}': '版本 {version}',

  // regions
  International: '国际',
  China: '中国',

  // meter labels (providers / templates)
  '5-hour window': '5 小时窗口',
  Weekly: '每周',
  Monthly: '每月',
  Tokens: 'Token',
  'Credits balance': '额度余额',
  'Key spend limit': 'Key 花费上限',
  'Spend: today': '花费：今天',
  'Spend: this week': '花费：本周',
  'Spend: this month': '花费：本月',
  'Points balance': '积分余额',
  'Available balance': '可用余额',
  'API credit balance': 'API 额度余额',

  // provider notes
  'No public usage endpoint for personal subscriptions.': '个人订阅没有公开的用量接口。',
  'Usage token lives in the desktop CLI; not reachable from iOS.':
    '用量令牌保存在桌面 CLI 中，iOS 无法读取。',
  'Credentials live in the Kiro CLI; not reachable from iOS yet.':
    '凭据保存在 Kiro CLI 中，iOS 暂时无法读取。',
  'Quota is stored in a local IDE file; no remote endpoint.':
    '额度保存在本机 IDE 文件中，没有远程接口。',
  'No official API.': '没有官方 API。',
  'Automatic data covers the API organization only; web subscription credits are manual.':
    '自动数据只覆盖 API 组织；网页订阅的积分需手动记录。',
  'No verified usage endpoint yet. Enter limits from your dashboard; manual windows use your reset anchors, not exact rolling usage.':
    '暂无已验证的用量接口。请从控制台填入额度；手动窗口以你设置的重置时间为准，而非精确滚动用量。',
  'No verified balance endpoint yet. Track monthly spend by hand; this is not your remaining credit balance.':
    '暂无已验证的余额接口。请手动记录每月花费；这不是剩余额度。',

  // alerts & background
  Alerts: '提醒',
  'Usage alerts': '用量提醒',
  'Notify when usage reaches': '用量达到以下比例时通知',
  'Remind me before a reset': '重置前提醒',
  'Allow notifications': '允许通知',
  'Background refresh': '后台刷新',
  'iOS decides when this runs, so alerts can arrive late. Opening the app always checks too.':
    '何时运行由 iOS 决定，提醒可能延迟。打开 App 时也会检查。',
  Default: '默认',
  Off: '关闭',
  '{name}: sign in again': '{name}：请重新登录',
  'The saved credential was rejected, so usage can no longer be updated.':
    '保存的凭据被拒绝，用量无法继续更新。',
  '{name}: {meter} at {pct}': '{name}：{meter} 已达 {pct}',
  'Resets in {time}.': '{time}后重置。',
  'Open the app to see details.': '打开 App 查看详情。',
  '{name}: {meter} resets soon': '{name}：{meter} 即将重置',
  '{pct} unused, resets in {time}.': '还有 {pct} 未用，{time}后重置。',

  // OAuth/API-key only and historical compatibility
  OAuth: 'OAuth',
  'Historical account (read-only)': '历史账号（只读）',
  'Connect with OAuth or an API key. Only providers with usage collection are listed.':
    '使用 OAuth 或 API Key 连接。仅列出已实现用量采集的服务商。',
  'This provider has no supported OAuth or API-key usage connection.':
    '此服务商尚无支持的 OAuth 或 API Key 用量连接。',
  'Only OAuth or API-key credentials are supported.': '仅支持 OAuth 或 API Key 凭据。',
  'Monthly credits remaining': '月度额度剩余',
  'Purchased credits remaining': '购买额度剩余',
  'Free credits remaining': '赠送额度剩余',
  'Sign in with browser': '使用浏览器登录',
  'Sign in to ChatGPT in the browser; you come back here automatically.':
    '在浏览器中登录 ChatGPT，完成后会自动返回此处。',
  'Authorize in the browser and you come back here automatically. OpenRouter creates an API key stored in this device’s Keychain.':
    '在浏览器中授权，完成后会自动返回此处。OpenRouter 将创建 API Key，仅保存在本机钥匙串。',
  'Waiting for the browser…': '等待浏览器完成…',
  'Browser sign-in is not in this build. Install the current development build.':
    '此版本不包含浏览器登录，请安装最新的开发构建。',
  'Could not start the local sign-in listener. Close other apps and try again.':
    '无法启动本机登录监听，请关闭占用端口的应用后重试。',
  'The sign-in session expired. Start again.': '登录会话已过期，请重新开始。',
  'The authorization was rejected or expired. Start again.': '授权被拒绝或已过期，请重新开始。',
  'Could not complete authorization. Start again.': '无法完成授权，请重新开始。',

  // device sign-in
  'The code expired. Start again.': '验证码已过期，请重新开始。',
  'Sign-in was declined.': '登录被拒绝。',
  'Sign-in was cancelled.': '登录已取消。',
  'Open the page below and enter this code:': '打开下面的页面并输入此验证码：',
  'Sign-in code': '登录验证码',
  'Open sign-in page': '打开登录页面',
  'Waiting for approval…': '等待授权…',
  Token: '令牌',
  'GitHub token': 'GitHub 令牌',
  'GitHub sign-in is not configured in this build. Paste a personal access token instead.':
    '此版本未配置 GitHub 登录。请改为粘贴个人访问令牌。',
  'Device-code sign-in is not enabled for this ChatGPT account.':
    '此 ChatGPT 账号未启用设备码登录。',
  'Session window': '会话窗口',
  'Premium requests': '高级请求',
  Chat: '聊天',
  Completions: '补全',

  // web sign-in
  'No signed-in session found yet. Finish signing in on the page, then try again.':
    '还没有检测到登录状态。请先在页面中完成登录，然后再试一次。',
  'That text does not contain the expected session cookie.':
    '这段文字里没有找到所需的会话 Cookie。',
  'Provider sign-in page': '服务商登录页面',
  'This preview build cannot read protected cookies. If sign-in is not detected, paste the cookie instead.':
    '此预览版本无法读取受保护的 Cookie。如果检测不到登录，请改为粘贴 Cookie。',
  Cookie: 'Cookie',
  'Copy the Cookie header (or the session cookie value) from your desktop browser’s developer tools while signed in.':
    '登录状态下，从电脑浏览器的开发者工具中复制 Cookie 请求头（或会话 Cookie 的值）。',
  'Back to sign-in page': '返回登录页面',
  'I’ve signed in': '我已登录',
  'Paste a cookie instead': '改为粘贴 Cookie',
  'On-demand': '按需用量',

  // service messages
  'The credential was rejected. Re-enter or re-authorize this account.':
    '凭据被拒绝。请重新输入或重新授权此账号。',
  'The service is rate limiting requests. Will retry later.': '服务正在限流，稍后会重试。',
  'The request timed out.': '请求超时。',
  'Could not reach the service.': '无法连接到服务。',
  'Automatic collection is not available for this provider.': '此服务商暂不支持自动采集。',
  'The key was accepted but the response was not recognized. The service may have changed, or this key type has no usage data.':
    'Key 有效，但无法识别返回内容。服务可能已改版，或此类 Key 没有用量数据。',
  'The response was not recognized. The service may have changed.':
    '无法识别返回内容，服务可能已改版。',

  // concise copy (band layout): short, user-facing wording
  Remaining: '剩余',
  'Open in the browser': '在浏览器中打开',
  'No accounts yet': '还没有账号',
  'Tell me when a login expires': '登录失效时提醒我',
  'Open iOS Settings': '打开系统设置',
  'Open system settings': '打开系统设置',
  'Notifications are off. Turn them on in system settings.': '通知已关闭，请在系统设置中开启。',
  'Local storage is unavailable. Restart the app.': '本地存储不可用，请重启 App。',
  'This removes every account, credential and usage history from this device.':
    '将删除本机上的所有账号、凭据与用量历史。',
  'Notifications are off. Turn them on in iOS Settings.': '通知已关闭，请在系统设置中开启。',
  'Allow notifications to get alerts.': '开启通知以接收提醒。',
  'Background refresh is restricted on this device.': '此设备的后台刷新受限。',
  'Its credentials and usage history are deleted.': '其凭据与用量历史会一并删除。',
  'The credential was rejected. Remove and add the account again.':
    '凭据已失效，请删除后重新添加。',
  'Stored in the device Keychain. Prefer a read-only key.':
    '仅保存在本机钥匙串，建议使用只读 Key。',

  // provider notes (kept to one short line each)
  'Balance needs a management key; other keys show their own usage.':
    '余额需要管理 Key；其他 Key 仅显示自身用量。',
  'API organization only, not web subscription credits.': '仅覆盖 API 组织，不含网页订阅额度。',
  'Experimental endpoint used by the official CLI; it may change.':
    '官方 CLI 使用的实验接口，可能变更。',
  'Needs an OpenCode Go subscription; shows Go quota only.':
    '需要 OpenCode Go 订阅，仅显示 Go 用量。',
  'Balance is not available yet.': '暂不支持查看余额。',
  'Anthropic terms block third-party usage collection.': 'Anthropic 条款不允许第三方读取用量。',
  'Cookie sign-in removed; existing accounts are read-only.':
    '已移除 Cookie 登录，已有账号仅可查看。',
  'No usage connection yet.': '暂不支持自动采集。',
  'Shows your Cline credits and, with ClinePass, the 5-hour, weekly and monthly limits. Create an API key at app.cline.bot under Settings > API Keys.':
    '显示 Cline 额度余额；订阅了 ClinePass 时还会显示 5 小时、每周和每月用量。请在 app.cline.bot 的 Settings > API Keys 中创建 API Key。',
  // subscriptions, forecasts, reset notices, widget
  '{name}: plan ends or renews {date}': '{name}：套餐将于 {date} 到期或续费',
  'Within a day. Check your subscription if you do not plan to keep it.':
    '不到 1 天。如不打算继续，请检查订阅。',
  'In {n} days. Check your subscription if you do not plan to keep it.':
    '还有 {n} 天。如不打算继续，请检查订阅。',
  '{name}: {meter} has reset': '{name}：{meter}已重置',
  'The quota is available again.': '额度已恢复，可以继续使用。',
  'Subscriptions per month': '每月订阅合计',
  'Next plan end: {name} · {date}': '最近到期：{name} · {date}',
  'Tell me when a window resets': '窗口重置时通知我',
  'Only for windows that were used up.': '仅限额度已用完的窗口。',
  'Remind me before a plan ends': '套餐到期前提醒我',
  '{n} days before': '提前 {n} 天',
  Subscription: '订阅',
  'Used for the monthly total on the overview.': '用于概览页的每月合计。',
  Currency: '货币',
  'Runs out in {time} at this pace': '按当前速度约 {time}后用完',
  'within a day': '不到 1 天',
  '{n} days left': '剩 {n} 天',
  'Plan until {date} · {left}': '套餐有效至 {date} · {left}',
  'Open AI Usage to add an account.': '打开 AI Usage 添加账号。',
  Resets: '重置',
  '5h': '5小时',
  Day: '日',
  Week: '周',
  Month: '月',
};
