# AI Usage

一款查看各家 AI 订阅用量的 iOS / Android 应用（React Native + Expo）：已用多少、还剩多少、什么时候重置，一眼看清。

连接方式**只支持 OAuth 与 API Key**。手动记录与 Cookie 登录已移除；以前添加的手动 / Cookie 账号保留只读历史，不会被自动删除。

## 功能

- **用量一览**：每个账号的各个窗口（5 小时、每周、每月、额度余额等）以横条显示已用与剩余，并显示重置倒计时；余额为 0 的附加额度自动隐藏。
- **用完预测**：按当前消耗速度估算何时用完，早于重置时提示。
- **订阅管理**：显示服务商返回的套餐到期 / 续费日；可为每个账号填写月费，概览页汇总每月订阅支出。
- **提醒**：用量超过阈值、窗口重置（额度恢复）、套餐即将到期、登录失效时发送本地通知。
- **小组件**（iOS）：主屏与锁屏小组件显示最需要关注的账号。
- **体验**：中英双语（可跟随系统）、浅色 / 深色、全局动画与触觉反馈，尊重系统的「减弱动态效果」。

## 支持的服务商

ChatGPT / Codex、GitHub Copilot、Kimi Code、Kimi 开放平台余额、OpenRouter、MiniMax、GLM Coding Plan（z.ai）、Runway（API 组织）、Poe、DeepSeek、Command Code、Cline、OpenCode Go。

- **Codex 与 OpenRouter** 通过系统浏览器登录，授权后自动回到应用，无需输入或复制验证码。这依赖本机 `127.0.0.1` 一次性回调模块（`modules/usage-oauth-loopback`，iOS 与 Android 原生构建均包含）。在 Expo Go 或不含该模块的旧版本上会自动改用替代方式：Codex 使用设备码登录，OpenRouter 使用 API Key，并在页面上说明原因。
- **OpenRouter** 授权后生成一个由你掌控的 API Key 并存入钥匙串；查看整个账户余额需要 Management Key，普通 Key 只显示自身用量。
- **Cline** 使用 app.cline.bot → Settings → API Keys 中创建的 API Key，显示额度余额（有活跃组织时显示组织余额）。
- **Command Code** 使用官方 CLI 的实验性个人接口，不臆测月度上限。
- **OpenCode Go** 显示订阅额度，不是 Zen 钱包余额；**OpenCode Zen** 在找到可靠的 API Key / OAuth 余额接口前暂不支持。
- 服务商代码与测试样例不能代替真实账号验证；可用 `tools/probe` 对真实账号检查接口。

## 开发（Windows 即可）

```bash
npm install
npm run check         # 类型检查 + lint + 测试
npx expo start        # 启动开发服务器
```

Expo Go 可以运行本应用，但不含原生扩展：浏览器登录回调、主屏小组件与后台刷新需要原生构建。

`tools/probe` 用于对真实账号验证服务商接口（见 `node tools/probe/probe.mjs list`）。

## 打包

两个 GitHub Actions 工作流都可以在 Actions 页面点 *Run workflow* 手动触发（在运行页面底部下载产物），或推送 `v*` 标签（如 `v1.0.1`）自动触发：标签构建会自动发布到 [Releases](https://github.com/nextroad-dev/aiusage/releases)，同时附上 APK 和 IPA。

### iOS 无签名 IPA（无需 Apple 开发者账号）

`.github/workflows/ios-unsigned.yml` 在 GitHub 的 macOS 机器上编译不签名的 release `.ipa`，产物名为 `AIUsage-unsigned-ipa`。

安装时需要重新签名，例如用 Sideloadly 或 AltStore 配合免费 Apple ID。免费签名 7 天后过期，需要重签；免费账号不能使用 App Group，所以侧载版的主屏小组件不会显示数据。

### Android APK

`.github/workflows/android-apk.yml` 在 GitHub 的 Linux 机器上编译 release `.apk`，产物名为 `AIUsage-android-apk`。它使用 Expo 模板的调试密钥签名，可以直接安装（需允许安装未知来源应用），但不适合上架 Google Play。Android 版同样支持浏览器登录，但没有主屏小组件。

## 赞助

如果这个应用对你有帮助，欢迎在 [爱发电](https://afdian.com/a/nextroad) 支持开发。
