/**
 * rateLimit.ts – Simple rate limiting for Telegram messages
 *
 * Tracks message timestamps per Chat ID and enforces limits.
 */

import { RATE_LIMIT_MESSAGES_PER_MIN, RATE_LIMIT_WINDOW_MS } from './constants';

/**
 * Simple rate limiter using sliding window
 */
export class RateLimiter {
  private readonly timestamps = new Map<string, number[]>();

  /**
   * Check if a request is allowed for the given key.
   * Returns true if allowed, false if rate limit exceeded.
   *
   * @param key The identifier to rate limit (e.g., Chat ID)
   * @returns true if request is allowed, false if rate limited
   */
  check(key: string): boolean {
    const now = Date.now();
    const keyTimestamps = this.timestamps.get(key) || [];

    // Remove timestamps outside the window
    const validTimestamps = keyTimestamps.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );

    // Check if limit exceeded
    if (validTimestamps.length >= RATE_LIMIT_MESSAGES_PER_MIN) {
      // Update map even though rejected (keep valid timestamps)
      this.timestamps.set(key, validTimestamps);
      return false;
    }

    // Allow request and record timestamp
    validTimestamps.push(now);
    this.timestamps.set(key, validTimestamps);
    return true;
  }

  /**
   * Get remaining requests for a key
   * @param key The identifier to check
   * @returns Number of requests remaining in current window
   */
  getRemaining(key: string): number {
    const now = Date.now();
    const keyTimestamps = this.timestamps.get(key) || [];
    const validTimestamps = keyTimestamps.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );
    return Math.max(0, RATE_LIMIT_MESSAGES_PER_MIN - validTimestamps.length);
  }

  /**
   * Get time until next request is allowed (in milliseconds)
   * Returns 0 if requests are currently allowed
   *
   * @param key The identifier to check
   * @returns Milliseconds until next request allowed
   */
  getRetryAfter(key: string): number {
    const now = Date.now();
    const keyTimestamps = this.timestamps.get(key) || [];
    
    if (keyTimestamps.length < RATE_LIMIT_MESSAGES_PER_MIN) {
      return 0; // Currently allowed
    }

    // Find oldest timestamp in window
    const oldestInWindow = keyTimestamps
      .filter(ts => now - ts < RATE_LIMIT_WINDOW_MS)
      .sort((a, b) => a - b)[0];

    if (!oldestInWindow) return 0;

    const retryAfter = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow);
    return Math.max(0, retryAfter);
  }

  /**
   * Clear all rate limit data (useful for testing)
   */
  clear(): void {
    this.timestamps.clear();
  }

  /**
   * Clear rate limit data for a specific key
   * @param key The identifier to clear
   */
  clearKey(key: string): void {
    this.timestamps.delete(key);
  }
}
