import type { Config, CoreMessage } from "./types.js";
/** Tools that are ALWAYS protected, regardless of user config. These are ACP's
 *  own metadata tools whose records must remain in context: compress calls
 *  carry the summaries that decompress/search rely on, and the system prompt
 *  treats past compress calls as load-bearing metadata. acp_rule calls record
 *  persistent user rules that are re-injected every turn — compressing them
 *  away would silently lose what the rules state. Letting any of these be
 *  compressed away breaks decompress and the "summary is historical" contract. */
export declare const ALWAYS_PROTECTED_TOOLS: readonly ["compress", "acp_rule"];
/** Tool results that must NEVER participate in the soft-protected recent zone
 *  (preserveRecentMessages / preserveRecentTokens / last user message).
 *
 *  These tools return large content (restored blocks, search hits, file bodies,
 *  command output). If such a result lands in the last-N window it becomes
 *  un-compressible: the model cannot reclaim that context, and it never appears
 *  in the compressible-ranges recommendation list. Excluding these tools from
 *  the protected zone lets the model compress them again immediately, while
 *  still leaving them visible (the host's preserveRecent is about not
 *  compressing the active working set, not about which tool results are in
 *  scope).
 *
 *  - `decompress`: large restored content as an inline tool result.
 *  - `search_context`: large result lists (10 ranked hits with previews).
 *  - `read`: file/image contents — the largest common source of context bloat.
 *  - `bash`: command output (build/test/logs) — frequently large and spent.
 *
 *  Note: this only affects the recent-zone computation. Such messages remain
 *  fully visible and compressible like any ordinary message. */
export declare const NEVER_PRESERVE_RECENT_TOOLS: readonly ["decompress", "search_context", "read", "bash"];
/** True for tool-call / tool-result messages whose toolName matches one of
 *  the recent-zone exclusion patterns — i.e. tool results (like decompress)
 *  that should be excluded from the soft-protected recent zone.
 *
 *  `patterns` defaults to NEVER_PRESERVE_RECENT_TOOLS when omitted/undefined
 *  (the built-in list stays the default behavior); an explicit array —
 *  including `[]` — replaces it verbatim. Patterns use the same glob-suffix
 *  matching as protectedTools; exact names behave exactly as before.
 *
 *  `preservePatterns` (config.preserveRecentTools) is then SUBTRACTED from
 *  that effective list (glob-suffix matching against the list entries), so
 *  `preserveRecentTools: ["read"]` protects fresh read results without
 *  restating the built-in list (upstream billion-context #1198/#1277).
 *  Unset or empty = no subtraction. */
export declare function isNeverPreserveRecent(msg: CoreMessage, patterns?: readonly string[], preservePatterns?: readonly string[]): boolean;
/** Match a tool name against a pattern: an exact name or a trailing-`*` prefix
 *  glob. CASE-INSENSITIVE on both sides — client hosts disagree on tool-name
 *  casing (opencode `read` vs Claude/ZCode `Read`), so every knob built on this
 *  matcher must treat them as equal (billion-context#1725). Monotonic: only adds
 *  matches, never removes one that held under exact matching. */
export declare function matchToolPattern(toolName: string, pattern: string): boolean;
export declare function isMessageProtected(msg: CoreMessage, config: Pick<Config, "protectedTools" | "isToolProtected">): boolean;
/** Build the set of toolCallIds whose tool-call is protected. Use this to also
 *  protect tool-results that lack a toolName (common when the host projects a
 *  tool-result with only toolCallId). Without it, the result half of a
 *  protected tool exchange leaks into compressible ranges. */
export declare function collectProtectedToolCallIds(messages: CoreMessage[], config: Pick<Config, "protectedTools" | "isToolProtected">): Set<string>;
/** Like isMessageProtected, but also matches tool-results by toolCallId against
 *  the protected call set. Use when you have the full message list available. */
export declare function isMessageProtectedWithPairing(msg: CoreMessage, config: Pick<Config, "protectedTools" | "isToolProtected">, protectedCallIds: Set<string>): boolean;
/** "Latest only" protection set: for each protectedLatestTools pattern, the
 *  LAST tool-call matching it (in message order) plus its paired result. Older
 *  instances of the same tool stay compressible. Use for cumulative-snapshot
 *  tools (e.g. todo_list) where only the newest result is the source of truth
 *  and every older result is strictly redundant.
 *
 *  `callIds` holds the latest calls' toolCallIds (pairing covers the result
 *  half, including results projected without a toolName); `msgIds` holds
 *  latest calls that lack a toolCallId (pairing impossible — protect by id). */
export interface LatestProtected {
    callIds: Set<string>;
    msgIds: Set<string>;
}
export declare function collectLatestProtected(messages: CoreMessage[], config: Pick<Config, "protectedLatestTools">): LatestProtected;
/** True when msg is a latest-protected tool-call, or the tool-result paired to
 *  one (by toolCallId). */
export declare function isMessageLatestProtected(msg: CoreMessage, latest: LatestProtected): boolean;
export declare function hasMediaPayload(msg: CoreMessage): boolean;
//# sourceMappingURL=protected.d.ts.map