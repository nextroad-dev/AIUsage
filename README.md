<p align="center">
  <img src="assets/images/icon.png" width="96" height="96" alt="AI Usage 图标" />
</p>

<h1 align="center">AI Usage</h1>

<p align="center">
  一眼看清你的 AI 订阅还剩多少：用量、剩余额度、重置时间，全都在手机上。
</p>

<p align="center">
  <a href="https://github.com/nextroad-dev/aiusage/releases/latest">下载最新版</a> ·
  <a href="#支持的服务">支持的服务</a> ·
  <a href="#隐私">隐私</a> ·
  <a href="https://afdian.com/a/nextroad">赞助</a>
</p>

---

同时用着 ChatGPT、Copilot、OpenRouter、Kimi……每家的额度规则都不一样：5 小时窗口、每周上限、按月重置、预付余额。AI Usage 把它们放在同一个地方，告诉你**哪个快用完了、什么时候恢复**，免得在关键时刻被限流。

## 功能

- **所有订阅一屏看完**：每个账号的每个额度窗口（5 小时、每周、每月、余额）用横条显示已用与剩余，附重置倒计时；最需要注意的账号排在最前面。
- **用完预测**：按你当前的消耗速度，估算什么时候会用完——如果早于重置就提前告诉你。
- **订阅与花费**：显示服务商返回的套餐到期 / 续费日；为每个账号填上月费，首页汇总你每月在 AI 订阅上花了多少。
- **及时提醒**：用量超过你设的阈值、窗口重置额度恢复、套餐快到期、登录失效时，发本地通知提醒你。
- **小组件**（iOS）：主屏和锁屏小组件，不打开应用也能看余量。
- **好用的细节**：中文 / English（可跟随系统）、浅色 / 深色、7 种主题色、流畅的动画与触觉反馈，并尊重系统的「减弱动态效果」。

## 下载与安装

前往 [Releases](https://github.com/nextroad-dev/aiusage/releases/latest) 下载最新版本。

### Android

下载 `AIUsage-*.apk`，在手机上打开安装（首次需要允许「安装未知来源应用」）。

### iOS

下载 `AIUsage-*-unsigned.ipa`。这是**未签名**的安装包，需要用 [Sideloadly](https://sideloadly.io/) 或 [AltStore](https://altstore.io/) 配合你的 Apple ID 签名后安装：

1. 在电脑上安装 Sideloadly（Windows 还需要安装官网版 iTunes），用数据线连接 iPhone。
2. 把 IPA 拖进 Sideloadly，填入 Apple ID，点击 Start。
3. 在 iPhone「设置 → 通用 → VPN 与设备管理」中信任该开发者。
4. iOS 16 及以上需打开「设置 → 隐私与安全性 → 开发者模式」。

> 使用免费 Apple ID 签名时：应用 7 天后需要重新签名（数据会保留）；免费账号不支持 App Group，主屏小组件不会显示数据，其他功能正常。

## 支持的服务

| 服务 | 连接方式 | 显示内容 |
|---|---|---|
| ChatGPT / Codex | 浏览器登录（备用：设备码） | 5 小时窗口、每周窗口、额度余额、套餐有效期 |
| GitHub Copilot | 个人访问令牌（Token） | Premium 请求、Chat、代码补全用量 |
| OpenRouter | 浏览器登录 / API Key | 额度余额、Key 限额、今日 / 本周 / 本月花费 |
| Cline | API Key | 额度余额（含组织余额） |
| Kimi Code | API Key | 5 小时窗口、每月额度 |
| Kimi 开放平台 | API Key | 可用余额 |
| MiniMax Token Plan | API Key | 5 小时窗口 |
| GLM Coding Plan（z.ai） | API Key | Token 用量 |
| DeepSeek | API Key | 可用余额 |
| Poe | API Key | 积分余额 |
| Runway | API Key | API 积分余额（不含网页订阅积分） |
| Command Code | API Key | 5 小时 / 每周窗口与各类积分（实验性接口） |
| OpenCode Go | API Key | Go 订阅额度 |

- **浏览器登录**：在系统浏览器里完成授权，自动回到应用，无需复制任何验证码。
- **Codex 设备码登录**需要先在 ChatGPT「设置 → 安全」中开启设备码登录。
- **OpenRouter** 浏览器授权会生成一个属于你的 API Key；查看整个账户余额需要 Management Key。
- **暂不支持**：Claude / Claude Code（Anthropic 条款不允许第三方读取用量）、Cursor、OpenCode Zen（暂无可靠的余额接口）。

> 部分服务的用量接口并非官方公开 API，服务商调整后可能暂时失效；遇到问题欢迎提 [Issue](https://github.com/nextroad-dev/aiusage/issues)。

## 隐私

- **没有服务器**：应用直接向各服务商请求你的用量，数据不经过任何第三方。
- **凭据只存在本机**：API Key 和登录令牌保存在系统钥匙串（iOS Keychain / Android Keystore）中，不会上传。
- **用量历史只存在本机**：保存在应用的本地数据库里，可在「设置 → 数据」一键全部删除。
- **无广告、无统计**：不收集任何使用数据。
- 浏览器登录使用本机 `127.0.0.1` 临时回调，只在登录过程中短暂开启，授权完成后立即关闭。

## 常见问题

**为什么数据不是实时的？**
打开应用时会自动刷新，也可以点右上角的刷新按钮。后台刷新由系统调度，频率取决于你使用应用的习惯。

**「按当前速度约 X 后用完」准吗？**
它按本周期内的平均消耗速度线性估算，适合判断「今天会不会被限流」，不代表精确时间。

**为什么提示「当前版本不包含浏览器登录」？**
你在 Expo Go 或旧版本中运行。此时 Codex 会改用设备码登录，OpenRouter 改用 API Key；安装最新版即可使用浏览器登录。

## 参与开发

基于 React Native + Expo，Windows 上即可开发：

```bash
npm install
npm run check         # 类型检查 + lint + 测试
npx expo start        # 启动开发服务器
```

- Expo Go 可以运行本应用，但浏览器登录回调、主屏小组件和后台刷新需要原生构建。
- `tools/probe` 可用真实账号验证服务商接口（`node tools/probe/probe.mjs list`）。
- 推送 `v*` 标签（如 `v1.0.3`）会通过 GitHub Actions 自动构建 Android APK 与未签名 iOS IPA，并发布到 Releases。

## 赞助

AI Usage 免费且没有广告。如果它对你有帮助，欢迎在 [爱发电](https://afdian.com/a/nextroad) 支持开发 ❤️
