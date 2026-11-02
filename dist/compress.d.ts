import { createInitialState } from "./state.js";
import type { ApplyRetrieveResult } from "./ccr.js";
import type { MessageContentStore } from "./content-store.js";
import type { RenderStrategy } from "./render-refs.js";
import { type PipelineNode } from "./pipeline.js";
import type { ApplyCompressionResult, CompressionBlock, CompressionState, Config, CoreMessage, MessageProvenance, ProcessTurnResult, StatusReport } from "./types.js";
export interface Ports {
    countTokens?: (text: string) => number;
}
export interface CompressionCore {
    processTurn(input: ProcessTurnInput): ProcessTurnResult;
    /** Kernel primitive behind acp_retrieve: resolve a ref to its stored
     *  original plus the wire-safe injection pair (see ccr.ts). */
    retrieve(store: MessageContentStore, ref: string): ApplyRetrieveResult;
    applyCompression(input: ApplyCompressionInput): ApplyCompressionResult;
    defaultNodes(): PipelineNode[];
    decompress(blockId: string, state: CompressionState): CompressionBlock | undefined;
    search(query: string, state: CompressionState): CompressionBlock[];
    status(state: CompressionState, tokenCount: number, config: Config): StatusReport;
}
export interface ProcessTurnInput {
    messages: CoreMessage[];
    state: CompressionState;
    config: Config;
    tokenCount: number;
    /**
     * Which messages get an <acp> ref tag injected into their text
     * (the render-refs pipeline node). Refs are ALWAYS assigned regardless
     * (assign-refs node runs unconditionally).
     *   - "all" (default): tag every mapped message — in-process hosts
     *     like pai-acp want tags for the LLM to reference compress ranges.
     *   - "text-only": tag only user/assistant text; leave tool-call args
     *     and tool-result content pristine — proxy hosts where structured
     *     content must not be polluted.
     *   - "none": leave all text untouched — hosts that read the ref map
     *     directly from result.state.messageRefs.
     */
    renderTags?: RenderStrategy;
    /** Per-session CCR content store (pass result.contentStore back here).
     *  Omit for pre-CCR sessions — an empty store is used. */
    contentStore?: MessageContentStore;
}
export interface ApplyCompressionInput {
    ranges: {
        startRef: string;
        endRef: string;
        summary: string;
        topic?: string;
        compressCallId?: string;
        summaryMaxChars?: number;
    }[];
    messages: CoreMessage[];
    state: CompressionState;
    config: Config;
    protectedMessageIds?: Set<string>;
}
export declare function createCore(ports?: Ports): CompressionCore;
/** 匹配前的归一化：全半角统一、引号统一、空白折叠、大小写统一。 */
export declare function normalizeQuoteText(text: string): string;
/**
 * 一条 user 消息「必须出现在摘要里」的片段。空数组 = 该条无硬约束。
 * 导出是为了让标定脚本与误报率复算构造「保真摘要」时用**同一份**口径。
 *
 * ⚠️ 2026-10-29 实测修正（根因②）：短消息**不再整条逐字**，改为**约束句**。
 * 旧口径对 ≤500 字符的消息要求整条出现在摘要里，于是
 * 「严格按照本计划书，执行任务。」与保真摘要「严格按照本计划书执行任务。」
 * 只差一个逗号就被报成违规 —— 68 条标注样本上造成 10 条误报。
 * 标点差异不该致命，所以判定改走**关键词覆盖率**（见 `quoteContainment`），
 * 本函数只负责回答「这条消息的约束句是哪些」。
 */
export declare function requiredQuoteFragments(text: string): string[];
/**
 * 无标签（`provenance === undefined`）→ **跳过检查**（fail-open）。
 *
 * 方向与 `prune.ts` 的 `isUserVerbatimProvenance` **相反**，别照抄：
 * 这里的失效后果是「少查一次」，后果无害（不拒绝压缩）且可见（日志里门不报），
 * 而那里的失效后果是「丢掉对用户消息的保护」，静默且违反 RL-4。
 * 判别口诀先问「没查」还是「没保」——前者放开，后者收紧（计划书 §2 高危 1）。
 */
export declare function isQuoteFidelitySource(provenance: MessageProvenance | undefined): boolean;
/** 长度档系数 w5 的输入（字符数 → 系数）。越长系数越低：长文本做不到逐字保留。 */
export declare function quoteLengthCoefficient(chars: number): number;
/**
 * 一条用户消息的重要性打分，值域 [0,1]。
 * `importance = w1·强标记密度 + w2·否定词数 + w3·数字/标识符密度 + w4·祈使/第二人称 + w5·长度档系数`
 * 每个分量先各自截到 [0,1] 再加权，避免某一项（比如密度）把总分顶穿。
 */
export declare function importanceOf(text: string): number;
export type QuoteTier = "strict" | "loose";
/**
 * 这条消息用哪条口径。**只输出档位，不输出通过与否。**
 *
 * 规则（实测 2026-10-29，68 条标注样本上 `importance` 对「是不是指令」**分不开**，
 * 指令组最小 0.14 < 无约束组最大 0.67，所以按 §6 兜底 **D-9C：指令一律走严档，
 * 不参与打分**）：
 *   1. **短消息（≤ L）→ 严档**。逐字既可行又便宜，不需要打分来省。
 *   2. **长消息 → 默认宽档**（整条逐字本来就放不下）。
 *   3. **长消息但硬约束密度超标 → 收回严档**（D-9D，自写长需求清单那种：
 *      全文几百字里「必须/不得」成排）。这时只要求**约束句**逐字，不要求整条。
 *
 * `importance` 因此只在第 3 条里起作用 —— 它分不开「是不是指令」，但分得开
 * 「长消息里约束密不密」，而后者恰好就是它该管的事。
 */
export declare function quoteTierOf(text: string): QuoteTier;
/**
 * 关键词集合 K：去掉语气成分后的 token 集。
 * 中文用 **2-gram**（无词典、无分词器，符合 RL-12），英文/数字按标识符切。
 */
export declare function quoteKeywordsOf(text: string): Set<string>;
/** 覆盖率 `|K ∩ Tokens(summary)| / |K|`。K 为空视为 1（没有可保的东西）。 */
export declare function quoteCoverageOf(keywords: ReadonlySet<string>, summaryTokens: ReadonlySet<string>): number;
/**
 * 材料外面那句用户说明：前 {@link QUOTE_OUTER_MAX_LINES} 个不像排版行的行，
 * 截断到 {@link QUOTE_OUTER_MAX_CHARS} 字符。
 *
 * 取多行而不是只取第一行：真实任务卡常把「原话」放在第二、三行
 * （实测 S050 的「严格按照本计划书，执行任务。」就在第二行），只取首行会整条漏掉。
 */
export declare function quoteOuterSentenceOf(text: string): string;
/** 能指认"这是哪份材料"的标识 token：路径、文件名、错误码、版本号。取不到就是空。 */
export declare function quoteIdentityTokensOf(text: string): string[];
/**
 * 含硬约束的句子 —— 宽档只看这些句子，不看整条。
 *
 * 与 `emphasisSentencesOf` 的区别：那个用 `QUOTE_EMPHASIS_MARKERS`，里面 `先`/`再`/
 * `一定`/`别` 是中文高频词，会把大量普通叙述判成"必需"——这正是旧口径误报的来源。
 * 这里只认 `QUOTE_STRONG_MARKERS` 与 `QUOTE_NEGATION_MARKERS`（即 w1/w2 的那批词），
 * 语义是：**一条消息若一句硬约束都没有，门就不该查它**。
 *
 * ⚠️ 2026-10-29 实测修正（根因①）：只认强标记会漏掉**祈使句**与**格式约束**：
 *   - 「审阅 e2e-workspace/spec-v1.md」——祈使 + 宾语，无强标记词；
 *   - 「只回复两个字」「只输出一行：FILES=<...>」——格式约束，marker 是「只」；
 *   - 「你是测试执行者。…完成后只输出一行：PROBE_ISSUES=<...>」。
 * 这三类在 68 条标注样本上造成 **7 条结构性漏报**（门压根不查，θ 救不了）。
 *
 * 修正：约束句 = 强标记 ∪ 否定 ∪ **祈使动词** ∪ **格式约束**。
 * 祈使动词只在**句首**认（否则「你说的那个方案」这类叙述句会被误判）；
 * 格式约束靠「只/仅 + 数量词/单位」与 `<占位符>` 认。
 */
export declare function constraintSentencesOf(text: string): string[];
/**
 * 单条用户消息的判定：返回缺失片段，空数组 = 通过。
 *
 * ⚠️ 2026-10-29 实测修正（根因②）：口径从「整条逐字」改为「**约束句逐字 + 关键词覆盖**」。
 *
 * 旧口径对 ≤500 字符的消息要求整条逐字出现在摘要里，于是保真摘要
 * 「严格按照本计划书执行任务。」与原文「严格按照本计划书，执行任务。」
 * 只差一个逗号就被判违规 —— 68 条标注样本上造成 10 条误报（漏报样例的
 * `faithful` 版本本该通过）。标点差异不该致命，所以：
 *
 *   - **约束句逐字命中 → 直接通过**（保留现有强口径，不动）；
 *   - 否则算**该约束句的关键词覆盖率**，≥ θ 才算这条约束保住了。
 *
 * 逐条约束句分别算，不合并 —— 合并会让「丢了一条、其余全在」被平均掉，
 * 这正是漏报样例 M02（丢掉「不要解释，直接调用」）要抓的情形。
 */
export declare function missingQuoteFragmentsOf(text: string, provenance: MessageProvenance | undefined, normalizedSummary: string, summaryTokens: ReadonlySet<string>): string[];
/**
 * 纯函数：返回范围内每条用户发言缺失的必需片段。导出是为了让单测与误报率
 * 统计走**同一份**判定逻辑，而不是各自实现一套。
 */
export declare function quoteFidelityViolations(messages: readonly CoreMessage[], ids: readonly string[], summary: string): {
    messageId: string;
    missing: string[];
}[];
export { createInitialState };
//# sourceMappingURL=compress.d.ts.map