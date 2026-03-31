/**
 * errorHandler.ts – Error sanitization and user-safe error formatting.
 *
 * Security: Never expose sensitive information (tokens, Chat IDs, file paths) to users.
 */

/**
 * Sanitize error message for user display.
 * Removes sensitive information and provides user-friendly generic messages.
 *
 * @param err The error to sanitize
 * @param context Optional context for logging purposes (not shown to user)
 * @returns User-safe error message
 */
export function sanitizeError(err: unknown, context?: string): string {
  let message = 'An unexpected error occurred';

  if (err instanceof Error) {
    const originalMessage = err.message;

    // Known safe error patterns
    if (originalMessage.includes('Conflict')) {
      return 'Another instance of Telegram Bridge is active. Please stop the other instance first.';
    }
    if (originalMessage.includes('timeout')) {
      return 'Network timeout. Please check your internet connection and try again.';
    }
    if (originalMessage.includes('ECONNREFUSED')) {
      return 'Connection refused. The service may be temporarily unavailable.';
    }
    if (originalMessage.includes('ENOTFOUND')) {
      return 'Unable to resolve hostname. Please check your network connection.';
    }
    if (originalMessage.includes('ETIMEDOUT')) {
      return 'Connection timed out. Please check your internet connection.';
    }
    if (originalMessage.includes('Unauthorized') || originalMessage.includes('401')) {
      return 'Authentication failed. Please check your bot token and try again.';
    }
    if (originalMessage.includes('Forbidden') || originalMessage.includes('403')) {
      return 'Access denied. The bot may not have permission for this operation.';
    }
    if (originalMessage.includes('Not Found') || originalMessage.includes('404')) {
      return 'Resource not found. Please verify your configuration.';
    }
    if (/HTTP [5]\d\d/.test(originalMessage)) {
      return 'Telegram API server error. Please try again later.';
    }
    if (originalMessage.includes('invalid JSON')) {
      return 'Invalid response from server. Please try again.';
    }
    if (originalMessage.includes('Chat not found')) {
      return 'Chat not found. Please verify the Chat ID.';
    }

    // Sanitize message: remove anything that looks like a token, chat ID, or file path
    let sanitized = originalMessage;
    
    // Remove bot tokens (pattern: numbers:alphanumeric)
    sanitized = sanitized.replace(/\d{9,}:[A-Za-z0-9_-]{35,}/g, '[REDACTED_TOKEN]');
    
    // Remove chat IDs (pattern: large numbers)
    sanitized = sanitized.replace(/\b-?\d{9,}\b/g, '[CHAT_ID]');
    
    // Remove file paths (both Unix and Windows)
    sanitized = sanitized.replace(/\/[\w./-]+/g, '[PATH]');
    sanitized = sanitized.replace(/[A-Z]:\\[\w\\.\\-]+/g, '[PATH]');
    
    // Remove home directory references
    sanitized = sanitized.replace(/~\/[\w./-]+/g, '[PATH]');
    
    // If sanitized message is too different or empty, use generic message
    if (!sanitized || sanitized.length < 10 || sanitized === originalMessage.replace(/[a-zA-Z]/g, '')) {
      message = 'An error occurred during the operation';
    } else {
      message = sanitized;
    }
  } else if (typeof err === 'string') {
    // Already a string - sanitize it
    let sanitized = err;
    sanitized = sanitized.replace(/\d{9,}:[A-Za-z0-9_-]{35,}/g, '[REDACTED_TOKEN]');
    sanitized = sanitized.replace(/\b-?\d{9,}\b/g, '[CHAT_ID]');
    sanitized = sanitized.replace(/\/[\w./-]+/g, '[PATH]');
    sanitized = sanitized.replace(/[A-Z]:\\[\w\\.\\-]+/g, '[PATH]');
    message = sanitized;
  }

  return message;
}

/**
 * Format error for logging (includes more details, but still sanitizes tokens).
 *
 * @param err The error to format
 * @param context Optional context string
 * @returns Formatted log message
 */
export function formatErrorForLog(err: unknown, context?: string): string {
  const prefix = context ? `[${context}] ` : '';
  
  if (err instanceof Error) {
    let message = err.message;
    
    // Sanitize tokens but keep other details for debugging
    message = message.replace(/\d{9,}:[A-Za-z0-9_-]{35,}/g, '[REDACTED_TOKEN]');
    
    // Include error name and message
    return `${prefix}${err.name}: ${message}`;
  }
  
  return `${prefix}${String(err)}`;
}

/**
 * Check if error is a transient/retryable network error.
 *
 * @param err The error to check
 * @returns true if error is retryable
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  
  const msg = err.message.toLowerCase();
  return (
    /http [5]\d\d/.test(msg) ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused')
  );
}

/**
 * Validate that a string is a properly formatted Telegram bot token.
 * Does NOT verify the token with Telegram API.
 *
 * @param token The token to validate
 * @returns true if format is valid
 */
export function isValidTokenFormat(token: string): boolean {
  return /^\d{9,}:[A-Za-z0-9_-]{35,}$/.test(token);
}

/**
 * Validate that a string is a valid Telegram Chat ID format.
 * Accepts both positive (user) and negative (group/channel) IDs.
 *
 * @param chatId The Chat ID to validate
 * @returns true if format is valid
 */
export function isValidChatIdFormat(chatId: string): boolean {
  return /^-?\d{5,}$/.test(chatId);
}
