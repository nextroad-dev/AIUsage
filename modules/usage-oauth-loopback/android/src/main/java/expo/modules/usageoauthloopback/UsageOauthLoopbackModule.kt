package expo.modules.usageoauthloopback

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android side of the one-shot 127.0.0.1 callback listener (see ios/UsageOauthLoopbackModule.swift).
 *
 * The browser runs on this device, so the provider's loopback redirect reaches the listener, which
 * answers with a redirect to `usage://oauth/<provider>`. Android delivers that link to the app,
 * where the JavaScript sign-in session validates it and exchanges the code. Nothing is exchanged
 * or stored here.
 *
 * `start` resolves with `{ port }` or `{ error }`; the JavaScript side owns port fallback and
 * always calls `stop` (also on cancel, timeout and unmount).
 */
class UsageOauthLoopbackModule : Module() {
  private val lock = Any()
  private var server: LoopbackServer? = null

  override fun definition() = ModuleDefinition {
    Name("UsageOauthLoopback")

    AsyncFunction("start") { provider: String, port: Int, state: String ->
      if ((provider != "codex" && provider != "openrouter") || port !in 1..65535 ||
        !LoopbackServer.isValidState(state)
      ) {
        return@AsyncFunction mapOf("error" to "invalid-request")
      }
      synchronized(lock) {
        server?.stop()
        server = null
      }
      val next = LoopbackServer(provider, state)
      val bound = next.start(port) ?: return@AsyncFunction mapOf("error" to "port-unavailable")
      synchronized(lock) { server = next }
      mapOf("port" to bound)
    }

    AsyncFunction("stop") {
      synchronized(lock) {
        server?.stop()
        server = null
      }
    }

    OnDestroy {
      synchronized(lock) {
        server?.stop()
        server = null
      }
    }
  }
}
