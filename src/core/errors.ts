export class AuthExpiredError extends Error {
  constructor(message = 'credential expired or rejected') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

export class RateLimitedError extends Error {
  constructor(
    public readonly retryAfterMs?: number,
    message = 'rate limited',
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export class TimeoutError extends Error {
  constructor(message = 'request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
