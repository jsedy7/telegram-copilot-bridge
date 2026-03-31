/**
 * Application-wide constants for the Telegram Bridge extension
 */

// ============================================================
// Telegram API Limits
// ============================================================

/**
 * Maximum characters per Telegram message
 * @see https://limits.tginfo.me/en
 */
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4_096;

/**
 * Telegram Bot API server port
 */
export const TELEGRAM_API_PORT = 443;

/**
 * Telegram Bot API hostname
 */
export const TELEGRAM_API_HOST = 'api.telegram.org';

// ============================================================
// Retry & Resilience
// ============================================================

/**
 * Maximum number of retry attempts for transient failures
 */
export const MAX_RETRIES = 3;

/**
 * Delay in milliseconds between retry attempts (exponential backoff)
 */
export const RETRY_DELAYS_MS = [1_000, 2_000] as const;

/**
 * Long-polling timeout in seconds for getUpdates
 */
export const TELEGRAM_POLL_TIMEOUT_SEC = 25;

/**
 * HTTP status code threshold for server errors (5xx)
 */
export const HTTP_SERVER_ERROR_THRESHOLD = 500;

// ============================================================
// Security Limits (v0.2.0)
// ============================================================

/**
 * Maximum HTTP request body size in bytes (1 MB)
 */
export const MAX_REQUEST_BODY_SIZE = 1_048_576; // 1 MB

/**
 * Maximum total message length in bytes (100 KB)
 */
export const MAX_MESSAGE_LENGTH = 102_400; // 100 KB

/**
 * Rate limit: Maximum messages per minute per Chat ID
 */
export const RATE_LIMIT_MESSAGES_PER_MIN = 10;

/**
 * Rate limit: Time window in milliseconds
 */
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Setup mode timeout: Disable /chatid after first use (milliseconds)
 */
export const SETUP_MODE_TIMEOUT_MS = 300_000; // 5 minutes

// ============================================================
// Circuit Breaker (v0.2.0)
// ============================================================

/**
 * Circuit breaker: Failure threshold before opening circuit
 */
export const CIRCUIT_BREAKER_THRESHOLD = 5;

/**
 * Circuit breaker: Timeout in milliseconds before trying half-open state
 */
export const CIRCUIT_BREAKER_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Circuit breaker: Success threshold to close circuit
 */
export const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;

// ============================================================
// UI & Display
// ============================================================

/**
 * Status bar item priority (higher = more left)
 */
export const STATUS_BAR_PRIORITY = 100;

/**
 * Maximum preview length for tool invocation messages
 */
export const TOOL_PREVIEW_MAX_LENGTH = 100;

/**
 * Maximum preview length for status view
 */
export const STATUS_PREVIEW_MAX_LENGTH = 45;

/**
 * Truncated preview length (with ellipsis)
 */
export const STATUS_PREVIEW_TRUNCATE_LENGTH = 42;

/**
 * Time format: substring start for ISO timestamp (HH:mm:ss.SSS)
 */
export const TIME_FORMAT_START = 11;

/**
 * Time format: substring end for ISO timestamp
 */
export const TIME_FORMAT_END = 23;

// ============================================================
// Time Conversions
// ============================================================

/**
 * Milliseconds per second
 */
export const MS_PER_SECOND = 1_000;

/**
 * Seconds per minute
 */
export const SECONDS_PER_MINUTE = 60;

/**
 * Seconds per hour
 */
export const SECONDS_PER_HOUR = 3_600;

// ============================================================
// Default Values
// ============================================================

/**
 * Default extension version when not available
 */
export const DEFAULT_VERSION = '0.0.0';

/**
 * Default workspace folder index
 */
export const DEFAULT_WORKSPACE_INDEX = 0;

/**
 * Default initial offset for Telegram polling
 */
export const DEFAULT_POLL_OFFSET = 0;

// ============================================================
// MCP Server (v0.2.0)
// ============================================================

/**
 * MCP HTTP server listen address (localhost only)
 */
export const MCP_SERVER_HOST = '127.0.0.1';

/**
 * MCP HTTP server port range: minimum
 */
export const MCP_SERVER_PORT_MIN = 49152;

/**
 * MCP HTTP server port range: maximum
 */
export const MCP_SERVER_PORT_MAX = 65535;

/**
 * MCP port file path (relative to home directory)
 */
export const MCP_PORT_FILE_PATH = '.vscode-telegram-bridge/port';

/**
 * Shared secret length for MCP authentication (bytes)
 */
export const MCP_AUTH_SECRET_LENGTH = 32;
