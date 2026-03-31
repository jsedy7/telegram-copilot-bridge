/**
 * Text formatting utilities for Telegram messages.
 * Provides escape functions for different Telegram parse modes.
 */

export type TelegramParseMode = 'plain' | 'Markdown' | 'MarkdownV2' | 'HTML';

/**
 * Escape text for HTML parse mode.
 * Only < > & need to be escaped.
 */
export function escapeHTML(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Escape text for legacy Markdown parse mode.
 * Special characters _ * [ ] ( ) need to be escaped, but only when not part of valid formatting.
 * This is a simple implementation that doesn't parse - use with caution or prefer HTML/MarkdownV2.
 */
export function escapeMarkdown(text: string): string {
	// For legacy Markdown, we escape characters that are not already part of valid formatting.
	// This is a conservative approach - we escape [ ] ( ) but leave * _ alone
	// since detecting valid formatting requires parsing.
	return text
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]')
		.replace(/\(/g, '\\(')
		.replace(/\)/g, '\\)');
}

/**
 * Escape text for MarkdownV2 parse mode.
 * All special characters must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * except when they are part of valid formatting entities.
 * 
 * This implementation escapes everything - if you want to preserve formatting,
 * you'll need to parse the text and only escape literal characters.
 */
export function escapeMarkdownV2(text: string): string {
	const specialChars = '_*[]()~`>#+-=|{}.!';
	let escaped = text;
	
	for (const char of specialChars) {
		escaped = escaped.replace(new RegExp('\\' + char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '\\' + char);
	}
	
	return escaped;
}

/**
 * Apply the appropriate escaping based on parse mode.
 * For 'plain', returns text as-is (no escaping needed).
 */
export function formatForTelegram(text: string, parseMode: TelegramParseMode): string {
	switch (parseMode) {
		case 'HTML':
			return escapeHTML(text);
		case 'Markdown':
			return escapeMarkdown(text);
		case 'MarkdownV2':
			return escapeMarkdownV2(text);
		case 'plain':
		default:
			return text;
	}
}

/**
 * Get the Telegram API parse_mode parameter value, or undefined for plain text.
 */
export function getTelegramParseMode(mode: TelegramParseMode): 'HTML' | 'Markdown' | 'MarkdownV2' | undefined {
	if (mode === 'plain') {
		return undefined;
	}
	return mode;
}
