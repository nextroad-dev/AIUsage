import ExpoModulesCore

/**
 * Starts a short-lived 127.0.0.1 listener so a provider can redirect the browser back to the app.
 *
 * The browser runs on this device, so the provider's loopback redirect reaches the listener, which
 * answers with a redirect to `usage://oauth/<provider>`. The system authorization session
 * (`ASWebAuthenticationSession`) intercepts that URL and returns it to JavaScript, which validates
 * it and exchanges the code. Nothing is exchanged or stored here: the native side only forwards a
 * request that has the expected shape, so a stray or malformed request never consumes the session.
 *
 * `start` resolves with `{ port }` or `{ error }`; the JavaScript side owns port fallback and
 * always calls `stop` (also on cancel, timeout and unmount).
 */
public final class UsageOauthLoopbackModule: Module {
  private let serialQueue = DispatchQueue(label: "com.nextroad-dev.aiusage.oauth-loopback.module")
  private var server: LoopbackServer?

  public func definition() -> ModuleDefinition {
    Name("UsageOauthLoopback")

    AsyncFunction("start") { (provider: String, port: Int, state: String, promise: Promise) in
      guard (provider == "codex" || provider == "openrouter"), port > 0, port <= 65535,
        let candidate = UInt16(exactly: port), LoopbackServer.isValidState(state)
      else {
        promise.resolve(["error": "invalid-request"])
        return
      }
      self.serialQueue.async {
        self.server?.stop()
        self.server = nil
        let server = LoopbackServer(provider: provider, expectedState: state)
        self.server = server
        server.start(port: candidate) { result in
          switch result {
          case .success(let bound):
            promise.resolve(["port": Int(bound)])
          case .failure:
            self.serialQueue.async {
              if self.server === server {
                self.server = nil
              }
            }
            promise.resolve(["error": "port-unavailable"])
          }
        }
      }
    }

    AsyncFunction("stop") {
      self.serialQueue.sync {
        self.server?.stop()
        self.server = nil
      }
    }

    OnDestroy {
      self.serialQueue.sync {
        self.server?.stop()
        self.server = nil
      }
    }
  }
}
