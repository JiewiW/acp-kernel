import type { CompressionState, CoreMessage, MessageProvenance } from "./types.js";
export declare const SUMMARY_HEADER = "[Compressed conversation section]";
/**
 * The transient visible id of an active block's rendered summary message.
 * This is a VIEW-ONLY representation: it must never be persisted into
 * `effectiveMessageIds`/`directMessageIds` (the durable coverage is the
 * block's raw message ids).
 */
export declare function summaryMessageId(blockId: string): string;
export declare function isSummaryMessageId(id: string): boolean;
/**
 * Base id of a message id: everything before the first `#`. Sub-id
 * projections (`base#callId`, `base#r0`, …) are alternate renderings of the
 * same original message, so coverage is decided per original message — id
 * comparisons normalize to the base (issue #231).
 */
export declare function baseIdOf(id: string): string;
/**
 * True when `id` falls under any covered original message, regardless of
 * which projection form the block recorded and which the current view emits.
 * `coveredBases` must be the set of `baseIdOf(c)` over the covered ids,
 * built once per pass (O(1) per message instead of a scan). The exact
 * membership test is subsumed: a covered id's own base is in the set.
 */
export declare function isCovered(id: string, coveredBases: Set<string>): boolean;
/**
 * True when a message is a rendered block summary (the exact shape prune
 * emits). The id prefix alone is not sufficient — a host-authored message
 * that happens to carry a reserved id must not be treated as a rendered
 * summary (it would be silently dropped from ranges or deleted by rebuild).
 */
export declare function isRenderedSummaryMessage(message: Pick<CoreMessage, "id" | "role" | "contentType">): boolean;
export interface PruneOptions {
    injectSummaries?: boolean;
    /** 用户消息原文保留条数（方案 A=0 / 方案 B=N>0）。缺省按 0 处理 = 全部保留。 */
    userVerbatimKeep?: number;
}
/**
 * 是否算「用户原文」，受 RL-4 保护。
 *
 * ⚠️ **`provenance === undefined` 必须返回 true（继续保护）**。这个分支省不得：
 * 老宿主与老持久化数据没有来源标签，省掉它等于一夜之间把这些宿主上对用户消息
 * 的原文保护全部撤掉，且**不报错、不可见**——违反 RL-4 的正是这种静默失效。
 *
 * 注意方向与保真门相反：那里无标签是「跳过检查」（少查一次，无害且可见），
 * 这里是「继续保护」。判别口诀：先问这层失效是「没查」还是「没保」——
 * 前者放开，后者收紧。详见计划书 §2 高危 1。
 */
export declare function isUserVerbatimProvenance(provenance: MessageProvenance | undefined): boolean;
/** 受原文保护的 user 消息 id 集合。
 *  keep = 0（方案 A）→ 全部用户发言；keep = N > 0（方案 B）→ 最近 N 条。
 *  只认 `user-turn` / `user-material` / 无标签：宿主注入行（AGENTS.md、技能目录、
 *  运行时上下文、检查点）同样是 role === "user"，但它们被压缩掉正是我们想要的，
 *  保护它们会让「受保护原文」里塞满注入文本（实测旧口径误判率 92.9%）。
 *  预先算成 id 集合是必需的：protectedFn 对每条消息各调用一次，
 *  若在谓词内部用 indexOf 定位角色下标会退化成 O(n²)。 */
export declare function collectUserVerbatimIds(messages: CoreMessage[], keep: number): Set<string>;
export declare function prune(messages: CoreMessage[], state: CompressionState, options?: PruneOptions): CoreMessage[];
//# sourceMappingURL=prune.d.ts.map