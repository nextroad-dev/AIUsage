import Foundation
import Network

enum LoopbackStartResult {
  case success(UInt16)
  case failure
}

/**
 * One-shot HTTP listener bound to 127.0.0.1 that hands the provider's redirect to the app scheme.
 *
 * Security properties:
 * - Loopback only (`requiredLocalEndpoint`), so nothing on the local network can reach it.
 * - Only a well-formed `GET /auth/callback` with a matching Host and the session's `state` reaches
 *   the redirect step; any other request is answered with an error and does not consume the
 *   session, so the real callback can still arrive.
 * - The response is a 302 to `usage://oauth/<provider>`; the code is passed through as-is with
 *   URLComponents, never interpolated into a header string or an HTML page.
 * - First accepted callback ends the session: the listener stops and later requests are refused.
 */
final class LoopbackServer {
  private static let requestHeadTerminator = Data("\r\n\r\n".utf8)
  private static let maxRequestBytes = 16 * 1024
  private static let readyTimeoutSeconds: TimeInterval = 3
  private static let connectionIdleSeconds: TimeInterval = 20
  private static let maximumLifetimeSeconds: TimeInterval = 1800

  private let queue = DispatchQueue(label: "com.nextroad-dev.aiusage.oauth-loopback.server")
  private let provider: String
  private let expectedState: String
  private var listener: NWListener?
  private var connections: [ObjectIdentifier: NWConnection] = [:]
  private var boundPort: UInt16 = 0
  private var finished = false
  private var reported = false
  private var lifetime: DispatchWorkItem?

  init(provider: String, expectedState: String) {
    self.provider = provider
    self.expectedState = expectedState
  }

  /// The JavaScript side sends 32 random bytes as base64url; anything else is refused up front.
  static func isValidState(_ state: String) -> Bool {
    (16...256).contains(state.count)
      && state.unicodeScalars.allSatisfy {
        ($0.isASCII && CharacterSet.alphanumerics.contains($0)) || $0 == "-" || $0 == "_"
      }
  }

  func start(port: UInt16, completion: @escaping (LoopbackStartResult) -> Void) {
    queue.async {
      let parameters = NWParameters.tcp
      parameters.allowLocalEndpointReuse = true
      // Restrict the bind to 127.0.0.1: the browser on this device reaches it, the network cannot.
      parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
        host: .ipv4(.loopback),
        port: NWEndpoint.Port(rawValue: port) ?? .any
      )

      let listener: NWListener
      do {
        listener = try NWListener(using: parameters)
      } catch {
        completion(.failure)
        return
      }

      self.listener = listener
      listener.newConnectionHandler = { [weak self] connection in
        self?.accept(connection)
      }
      listener.stateUpdateHandler = { [weak self] state in
        guard let self, !self.reported, !self.finished else { return }
        switch state {
        case .ready:
          self.reported = true
          self.boundPort = listener.port?.rawValue ?? port
          self.scheduleLifetime()
          completion(.success(self.boundPort))
        case .failed:
          self.reported = true
          self.finishFlow()
          completion(.failure)
        default:
          break
        }
      }
      listener.start(queue: self.queue)

      // A listener can also stay in `.waiting` when the address is not usable; never hang on it.
      self.queue.asyncAfter(deadline: .now() + Self.readyTimeoutSeconds) { [weak self] in
        guard let self, !self.reported, !self.finished else { return }
        self.reported = true
        self.finishFlow()
        completion(.failure)
      }
    }
  }

  /// Stops accepting and releases every open connection. Safe to call more than once.
  func stop() {
    queue.async {
      self.finishFlow()
      for connection in self.connections.values {
        connection.cancel()
      }
      self.connections.removeAll()
    }
  }

  // MARK: - Session lifecycle

  private func finishFlow() {
    guard !finished else { return }
    finished = true
    lifetime?.cancel()
    lifetime = nil
    listener?.cancel()
    listener = nil
  }

  private func scheduleLifetime() {
    let item = DispatchWorkItem { [weak self] in self?.stop() }
    lifetime = item
    queue.asyncAfter(deadline: .now() + Self.maximumLifetimeSeconds, execute: item)
  }

  private func accept(_ connection: NWConnection) {
    guard !finished else {
      connection.cancel()
      return
    }
    connections[ObjectIdentifier(connection)] = connection
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.release(connection)
      default:
        break
      }
    }
    connection.start(queue: queue)
    read(connection, buffer: Data())
    queue.asyncAfter(deadline: .now() + Self.connectionIdleSeconds) { [weak self] in
      self?.release(connection)
    }
  }

  private func release(_ connection: NWConnection) {
    connections.removeValue(forKey: ObjectIdentifier(connection))
    connection.cancel()
  }

  // MARK: - HTTP

  private func read(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: Self.maxRequestBytes) {
      [weak self] data, _, isComplete, error in
      guard let self else { return }
      var accumulated = buffer
      if let data, !data.isEmpty {
        accumulated.append(data)
      }
      if let terminator = accumulated.range(of: Self.requestHeadTerminator) {
        self.handle(connection, head: accumulated.subdata(in: 0..<terminator.lowerBound))
        return
      }
      if accumulated.count > Self.maxRequestBytes || isComplete || error != nil {
        self.respond(connection, status: 400, location: nil)
        return
      }
      self.read(connection, buffer: accumulated)
    }
  }

  private func handle(_ connection: NWConnection, head: Data) {
    guard let text = String(data: head, encoding: .utf8) else {
      respond(connection, status: 400, location: nil)
      return
    }
    let lines = text.components(separatedBy: "\r\n")
    let requestLine = (lines.first ?? "").components(separatedBy: " ").filter { !$0.isEmpty }
    guard requestLine.count >= 2, requestLine[0] == "GET" else {
      respond(connection, status: 405, location: nil)
      return
    }
    guard let target = URLComponents(string: requestLine[1]), target.path == "/auth/callback" else {
      respond(connection, status: 404, location: nil)
      return
    }
    guard hostMatchesListener(lines) else {
      respond(connection, status: 400, location: nil)
      return
    }

    let items = target.queryItems ?? []
    let code = singleValue(items, "code")
    let state = singleValue(items, "state")
    let error = singleValue(items, "error")
    // Anything without this session's state, or without a code or error, is ignored rather than
    // consumed: the real callback must still be able to finish the sign-in.
    guard state == expectedState, error != nil || code != nil else {
      respond(connection, status: 400, location: nil)
      return
    }

    var redirect = URLComponents()
    redirect.scheme = "usage"
    redirect.host = "oauth"
    redirect.path = "/" + provider
    var query: [URLQueryItem] = []
    if let code {
      query.append(URLQueryItem(name: "code", value: code))
    }
    if let state {
      query.append(URLQueryItem(name: "state", value: state))
    }
    if let error {
      query.append(URLQueryItem(name: "error", value: error))
      if let description = singleValue(items, "error_description") {
        query.append(URLQueryItem(name: "error_description", value: description))
      }
    }
    redirect.queryItems = query
    guard let location = redirect.string else {
      respond(connection, status: 400, location: nil)
      return
    }

    finishFlow()
    respond(connection, status: 302, location: location)
  }

  private func hostMatchesListener(_ lines: [String]) -> Bool {
    let prefix = "host:"
    guard
      let header = lines.dropFirst().first(where: { $0.lowercased().hasPrefix(prefix) }),
      boundPort != 0
    else {
      return false
    }
    let value = header.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces).lowercased()
    return value == "127.0.0.1:\(boundPort)" || value == "localhost:\(boundPort)"
  }

  /// Exactly one value for the parameter; repeated parameters are treated as invalid.
  private func singleValue(_ items: [URLQueryItem], _ name: String) -> String? {
    let values = items.filter { $0.name == name }.map { $0.value ?? "" }
    return values.count == 1 ? values[0] : nil
  }

  private func respond(_ connection: NWConnection, status: Int, location: String?) {
    var head = "HTTP/1.1 \(status) \(statusText(status))\r\n"
    head += "Cache-Control: no-store\r\n"
    head += "Connection: close\r\n"
    if let location {
      head += "Location: \(location)\r\n"
      head += "Content-Length: 0\r\n\r\n"
      send(connection, Data(head.utf8))
      return
    }
    let body = "Invalid callback request."
    head += "Content-Type: text/plain; charset=utf-8\r\n"
    head += "Content-Length: \(body.utf8.count)\r\n\r\n"
    var payload = Data(head.utf8)
    payload.append(Data(body.utf8))
    send(connection, payload)
  }

  private func send(_ connection: NWConnection, _ payload: Data) {
    connection.send(content: payload, completion: .contentProcessed { _ in })
    // Keep reading until the peer closes so the response is not reset by unread request data.
    drain(connection)
  }

  private func drain(_ connection: NWConnection) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: Self.maxRequestBytes) {
      [weak self] _, _, isComplete, error in
      guard let self else { return }
      if isComplete || error != nil {
        self.release(connection)
        return
      }
      self.drain(connection)
    }
  }

  private func statusText(_ status: Int) -> String {
    switch status {
    case 302: return "Found"
    case 404: return "Not Found"
    case 405: return "Method Not Allowed"
    default: return "Bad Request"
    }
  }
}
