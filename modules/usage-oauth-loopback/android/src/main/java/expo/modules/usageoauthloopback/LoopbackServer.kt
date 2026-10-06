package expo.modules.usageoauthloopback

import android.net.Uri
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * One-shot HTTP listener bound to 127.0.0.1 that hands the provider's redirect to the app scheme.
 * Mirrors ios/LoopbackServer.swift:
 * - Loopback only, so nothing on the local network can reach it.
 * - Only a well-formed `GET /auth/callback` with a matching Host reaches the redirect step; any
 *   other request is answered with an error and does not consume the session.
 * - The response is a 302 to `usage://oauth/<provider>`; parameters are re-encoded with
 *   Uri.Builder, never interpolated into a header string or a page.
 * - The first accepted callback ends the session: the listener closes and later requests fail.
 */
class LoopbackServer(private val provider: String) {
  private val finished = AtomicBoolean(false)
  private var socket: ServerSocket? = null
  private var boundPort = 0

  /** Binds the port and starts accepting; returns the bound port, or null if it is unusable. */
  fun start(port: Int): Int? {
    val server =
      try {
        ServerSocket().apply {
          reuseAddress = true
          bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
        }
      } catch (_: Exception) {
        return null
      }
    socket = server
    boundPort = server.localPort
    thread(isDaemon = true, name = "oauth-loopback-accept") { acceptLoop(server) }
    // never outlive a forgotten sign-in
    thread(isDaemon = true, name = "oauth-loopback-lifetime") {
      try {
        Thread.sleep(MAX_LIFETIME_MS)
      } catch (_: InterruptedException) {
        return@thread
      }
      stop()
    }
    return boundPort
  }

  /** Stops accepting. Safe to call more than once. */
  fun stop() {
    finished.set(true)
    closeSocket()
  }

  @Synchronized
  private fun closeSocket() {
    try {
      socket?.close()
    } catch (_: Exception) {
      // already closed
    }
    socket = null
  }

  private fun acceptLoop(server: ServerSocket) {
    while (!finished.get()) {
      val client =
        try {
          server.accept()
        } catch (_: Exception) {
          return // closed by stop()
        }
      thread(isDaemon = true, name = "oauth-loopback-conn") { handle(client) }
    }
  }

  private fun handle(client: Socket) {
    client.use { c ->
      try {
        c.soTimeout = CONNECTION_IDLE_MS
        val head = readHead(c) ?: return respond(c, 400, null)
        val lines = head.split("\r\n")
        val requestLine = lines.firstOrNull()?.split(" ")?.filter { it.isNotEmpty() } ?: emptyList()
        if (requestLine.size < 2 || requestLine[0] != "GET") return respond(c, 405, null)
        val target = Uri.parse("http://127.0.0.1" + requestLine[1])
        if (target.path != "/auth/callback") return respond(c, 404, null)
        if (!hostMatches(lines)) return respond(c, 400, null)

        val code = single(target, "code")
        val state = single(target, "state")
        val error = single(target, "error")
        // Anything without a complete code/state signal is ignored rather than consumed: the real
        // callback must still be able to finish the sign-in.
        if (error == null && (code == null || state == null)) return respond(c, 400, null)

        val redirect = Uri.Builder().scheme("usage").authority("oauth").path("/$provider")
        code?.let { redirect.appendQueryParameter("code", it) }
        state?.let { redirect.appendQueryParameter("state", it) }
        error?.let {
          redirect.appendQueryParameter("error", it)
          single(target, "error_description")?.let { d ->
            redirect.appendQueryParameter("error_description", d)
          }
        }
        // only the first well-formed callback is forwarded, even when two arrive at once
        if (!finished.compareAndSet(false, true)) return respond(c, 400, null)
        closeSocket()
        respond(c, 302, redirect.build().toString())
      } catch (_: Exception) {
        // a broken or idle connection never affects the session
      }
    }
  }

  private fun readHead(c: Socket): String? {
    val input = c.getInputStream()
    val buffer = ByteArrayOutputStream()
    val chunk = ByteArray(1024)
    while (buffer.size() <= MAX_REQUEST_BYTES) {
      val n = input.read(chunk)
      if (n < 0) return null
      buffer.write(chunk, 0, n)
      val text = buffer.toString(Charsets.UTF_8.name())
      val end = text.indexOf("\r\n\r\n")
      if (end >= 0) return text.substring(0, end)
    }
    return null
  }

  private fun hostMatches(lines: List<String>): Boolean {
    if (boundPort == 0) return false
    val header =
      lines.drop(1).firstOrNull { it.lowercase().startsWith("host:") } ?: return false
    val value = header.substring("host:".length).trim().lowercase()
    return value == "127.0.0.1:$boundPort" || value == "localhost:$boundPort"
  }

  /** Exactly one value for the parameter; repeated parameters are treated as invalid. */
  private fun single(uri: Uri, name: String): String? {
    val values = uri.getQueryParameters(name)
    return if (values.size == 1) values[0] else null
  }

  private fun respond(c: Socket, status: Int, location: String?) {
    val reason =
      when (status) {
        302 -> "Found"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        else -> "Bad Request"
      }
    val head = StringBuilder("HTTP/1.1 $status $reason\r\nCache-Control: no-store\r\nConnection: close\r\n")
    val body = if (location == null) "Invalid callback request." else ""
    if (location != null) head.append("Location: ").append(location).append("\r\n")
    else head.append("Content-Type: text/plain; charset=utf-8\r\n")
    head.append("Content-Length: ").append(body.toByteArray(Charsets.UTF_8).size).append("\r\n\r\n")
    val out = c.getOutputStream()
    out.write(head.toString().toByteArray(Charsets.UTF_8))
    out.write(body.toByteArray(Charsets.UTF_8))
    out.flush()
  }

  private companion object {
    const val MAX_REQUEST_BYTES = 16 * 1024
    const val CONNECTION_IDLE_MS = 20_000
    const val MAX_LIFETIME_MS = 30L * 60 * 1000
  }
}
