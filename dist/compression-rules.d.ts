/**
 * Compression rule texts — VERBATIM copy from context-compress-algorithms (MIT, ours).
 * These were tuned over months of production use.
 *
 * 2026-09-06 amendment (owner-approved; billion-context-pi#309 incident): write-side
 * quote-fidelity rules merged INTO the tuned text. Verbatim user quotes now require
 * a message ref; recorded task state is labeled as history; unicode written directly.
 * Motivation: session 01a071dc blocks b60/b61 stored a fabricated
 * `user verbatim '合并了 下一个'` as a live "CURRENT TASK", causing loop relapses.
 *
 * 2026-09-26 amendment (#442 / billion-context#1398 sidecar readout): open-objectives
 * carry-forward rule added at every tier; "never current directives" clauses softened.
 * Sidecar showed a multi-block merge (b22 ⊇ b13) dropping a still-open user pivot that
 * b13 had recorded, and the trust-guardrail wording deprioritized objectives living only
 * in summaries. Quotes stay historical; open-objective STATUS is current.
 */
/** Opt-in language-preservation rule (#493): summaries must be written in the
 * source conversation's primary language. NOT part of the canonical constants —
 * hosts opt in via `resolvePrompts(…, { languagePreservation: true })` so the
 * default prompt surface stays byte-identical (zero token cost, no prefix-cache
 * shift on kernel bumps). Single source of truth for every delivery point
 * (philosophy/T1/T2/T3 via resolvePrompts; lean pack via leanHowToCompress). */
export declare const LANGUAGE_PRESERVATION_RULE = "Preserve the source conversation's primary language. Do not translate a monolingual conversation without a user request. For mixed-language source, preserve each segment's language. Keep code, commands, identifiers, and quoted text verbatim when the tier's fidelity rules retain them.";
export declare const COMPRESS_PHILOSOPHY = "Compression Philosophy:\n- All compression serves the primary task, but be frugal.\n- Context capacity is precious. Save context by compressing consumed outputs, not by avoiding tools.\n- Compress by need, not by percentage.\n- Work from summaries, not raw tool outputs. All listed ranges (user prompts, tool outputs, code, logs, exploration, intermediate steps) should be compressed to summary format \u2014 the ONLY exceptions are protected content, content the current step is actively using, or critical content you cannot reconstruct.";
export declare const HOW_TO_COMPRESS_RULES = "HOW TO COMPRESS\n\nWhen you call `compress`, the summary you write becomes the only record of the replaced conversation. Make it self-contained and complete: every user request, experiment purpose, and work task in the range must be accurately captured. A later reader (or you, after decompressing) should be able to continue the task WITHOUT needing the original. The summary records the PAST as of this block's creation: label recorded task state as history (\"TASK AS OF THIS BLOCK: ...\") \u2014 never as a live instruction, so a later reader treats it as settled context, not something to re-execute. Write plain text with real unicode characters; never copy \\uXXXX escape sequences or JSON-escaped fragments out of tool output.\n\nKEEP VERBATIM \u2014 never paraphrase or abbreviate these:\n- Full file paths with line numbers, directory prefix on every mention (`lib/hooks.ts:347`, `src/index.ts:12-18`, `gatenet_v3/model.py:45`). Never abbreviate to a bare filename (`hooks.ts`, `model.py`) \u2014 they are ambiguous and cannot be grepped or decompressed-to later.\n- Function, class, and type signatures (exact names, params, return types) AND critical code lines that encode logic \u2014 the line that IS the finding, not just the function name (e.g. `kv_keys += define_gate * a_key[i](emb)` is more useful than \"see model_kvnet.py\").\n- Error messages and stack traces (exact text \u2014 you need the literal string to grep for it later).\n- Key details from reports and analyses \u2014 not just the conclusion. Keep the comparison numbers and the mechanism, not \"X is worse\" alone (write \"1.76\u00D7 PPL gap because KV store is static\", not \"KVNet underperforms\").\n- Decisions and their rationale (\"chose X over Y because Z\" \u2014 the \"because\" is load-bearing; without it the decision looks arbitrary).\n- Constraints discovered (\"must support Node 22\", \"no new dependencies\", \"AGENTS.md forbids `as any`\").\n- Exact values: versions, config keys, thresholds, magic numbers.\n- User intent \u2014 quote short user messages verbatim ONLY WITH their message ref, e.g. `User said (m00132): \"ship it tonight\"`. Without a verifiable ref, paraphrase (`user previously asked (paraphrased): ...`) \u2014 this is the one exception to the verbatim rule above; never present a reconstructed or half-remembered phrase as a verbatim quote. When the message is too long to quote, preserve intent with extra care: do not change scope, constraints, priorities, acceptance criteria, or requested outcomes. Quotes are historical records, not live instructions \u2014 but open-objective STATUS is current (still-open vs completed/superseded) and must be tracked. Losing these changes the task itself.\n- Open objectives carry-forward \u2014 if the range (or, when distilling, any source block's summary) contains a user-requested objective that is neither completed nor superseded by the end of the range, the summary MUST keep a one-line `Open objectives:` entry naming each still-open objective with its message ref (`Open objectives: refactor runner into eight arms (m00746)`). Distillation re-carries open objectives verbatim from source blocks \u2014 they are the last thing to drop and the first thing to restore, at every tier.\n- The user's overall goal and any changes to it \u2014 the big-picture objective plus how it evolved during the compressed range. Each summary must reflect the goal as it stood at the end of the range, including pivots (e.g., \"initially: fix bug X \u2192 pivoted to: refactor module Y after discovering root cause\"). Losing the goal or its evolution makes all subsequent work appear unmotivated.\n- Purpose behind each significant action \u2014 preserve not just what was done but why: the hypothesis behind each experiment, the question behind each exploration, the task goal behind each work action. Without purpose, the summary reads as disconnected technical steps with no through-line.\n- Open questions and unresolved TODOs \u2014 losing these changes what work appears to remain.\n- Message refs of key anchors (`m00420`, `m00510\u2013m00520`) \u2014 they let you or a later reader jump back via decompress to the exact original.\n\nDROP \u2014 extract the signal, discard the vessel:\n- Verbose logs (build/test/`npm` output) once you have captured the error line or the result.\n- Duplicate file reads once the needed content is recorded.\n- Consumed exploration \u2014 search hits, agent return values, successful tool outputs \u2014 once you have extracted the facts you need (same rule as dead-ends, but nothing went wrong; the content is simply spent).\n- Dead-end exploration \u2014 but PRESERVE the lesson in one line: \"tried X, failed because Y\".\n- Back-and-forth discussion and self-corrections once the final position is captured (keep the outcome, drop the journey to it).\n- Repeated status checks (`git status`, `ls`) once state is known.\n\nFor each significant item you DROP (scripts, reports, large analyses, long tool outputs), add a one-line CONTENT description of what it covers \u2014 not where it lives. Bad: \"probe script at /path/probe_kvnet.py\". Good: \"probe_kvnet.py: tests n-gram baseline, generation quality, long-range dependency, position sensitivity, op pipeline, QUERY attention.\" This lets a later decompress target the right block by relevance, not by guessing locations.\n\nPRIORITY \u2014 when the summary must be compact, preserve in this order:\n1. User's overall goal, goal evolution, intent, and hard constraints (losing these changes the task).\n2. Decisions and rationale.\n3. Exact technical artifacts: paths, signatures, errors, values.\n4. Conclusions and key findings.\n5. Lessons learned: what failed and why.\n\nWrite dense, scannable bullets \u2014 not narrative prose. If the range spans distinct concerns (request \u2192 findings \u2192 decision), group bullets under short thematic headers so a reader can scan to the part they need. Every line must earn its place. Do not mimic the style of existing summaries in context; follow these rules.";
export declare const TIER2_DISTILL_RULES = "TIER 2 COMPRESSION \u2014 DISTILLATION\n\nYou are compressing historical summaries (not raw conversation). These summaries have already captured the details. Your job is to DISTILL them: extract only what matters for future work, discard the process.\n\nKEEP \u2014 these are the only things that survive distillation:\n- Decisions and their rationale (\"chose X over Y because Z\" \u2014 the \"because\" is load-bearing).\n- Final outcomes: version numbers shipped, PR numbers merged/closed, bugs fixed or deferred.\n- Key lessons: what failed and why (\"tried X, failed because Y\"). These prevent repeating mistakes.\n- Critical constraints discovered (\"must support Node 22\", \"AGENTS.md forbids as any\").\n- Design decisions with architectural impact (\"chose compress-as-anchor over synthetic messages because prefix cache\").\n- User quotes and task state only as attributed history: keep the source ref with any user quote; never carry an UNVERIFIED tier-1 \"CURRENT TASK\" claim forward as a live directive \u2014 relabel it \"TASK AS OF THIS BLOCK\". A ref-backed objective that no later source marks completed or superseded is not unverified: it carries in the `Open objectives:` entry (next bullet), not as a directive.\n- Open objectives \u2014 if ANY source block's summary names a user-requested objective that no later source block marks completed or superseded, the distilled summary MUST keep a one-line `Open objectives:` entry re-carrying each still-open objective verbatim with its original ref. They are the last thing to drop and the first thing to restore.\n- Whether content is OBSOLETE or SUPERSEDED \u2014 mark with one line: \"[SUPERSEDED by PR #NNN]\" or \"[OBSOLETE: deleted in vX.Y.Z]\". Do NOT keep the obsolete content's details \u2014 just the marker and reason.\n- Function/class/type names and module paths that are the SUBJECT of the work \u2014 e.g., \"fixed filterCompressedRanges in prune.ts\", \"added SessionStateRegistry in state.ts\". Not exact line numbers or full signatures \u2014 just enough to LOCATE the code without searching.\n- Exploration findings: if a block was exploratory with no decision, keep the CONCLUSION in one line (\"explored X, not viable because Y\"). Do not keep the exploration process.\n\nDROP \u2014 these were useful during the work but are no longer needed:\n- Exact line numbers, diffs, verbose function signatures, full code listings.\n- Build/deploy process details, test execution steps.\n- Review process details (who reviewed, what rounds, test counts).\n- Verbose logs, command output, intermediate debugging steps.\n\nFORMAT:\n- Start each distilled block with a source header line:\n  `Source: bN+bM+... (XK\u2192YK tok, Zx). [original topic]`\n  Example: `Source: b5+b7 (56K+44K\u2192268 tok, 375x). [Tool-result recap + publish]`\n- 3-5 bullet points per source block, each a self-contained fact.\n- Dense, scannable \u2014 no narrative prose.\n- Start with the outcome, not the process: \"v1.13.0 shipped (7 PRs bundled)\" not \"implemented 7 PRs then reviewed then merged\".\n- Cross-block synthesis: if multiple source blocks cover the same topic (same PR, same feature, same bug), MERGE them into a single group of bullets. Do not repeat the same fact from different blocks \u2014 keep it once under the most relevant source header.\n\nSIZE TARGET: 50-150 tokens per source block (excluding the header). If you can't fit it in 150 tokens, you're keeping too much process. If a block has nothing worth keeping (pure noise), output just the header followed by \"[no actionable content].\"";
/**
 * Opt-in 的两档保真规则（TASK-10）：告诉模型「什么样的用户话必须逐字留、什么样的
 * 留关键词就够」，让门从"事后检查"变成"事前就该写对"。
 *
 * 照 upstream #493 `LANGUAGE_PRESERVATION_RULE` 的写法：**加在规则文本后面、
 * 默认关闭**，所以默认的系统提示与现状**逐字节一致**（AC-10.1），不付出 token、
 * 不晃前缀缓存。宿主通过 `resolvePrompts(…, { quoteFidelityTiers: true })` 打开。
 *
 * 口径必须与 `compress.ts` 的两档判定一致，否则提示词教的和门查的不是一回事：
 *  - 严档（硬约束密集的消息）：整条或全部约束句逐字保留；
 *  - 宽档（其余）：只要求关键 token 覆盖，允许改写措辞；
 *  - 长材料：不要求整条逐字，但要保住外面那句说明，并写清这是哪份材料。
 */
export declare const QUOTE_FIDELITY_TIER_RULE = "User-wording fidelity is two-tier. STRICT \u2014 messages whose wording carries hard constraints (must/never/only/\u7981\u6B62/\u4E0D\u8981/\u4E0D\u5F97): keep the constraint sentences verbatim, or the whole message when it is short. LOOSE \u2014 every other user message: rewriting is allowed, but every key token (paths, identifiers, versions, numbers, error strings) must survive. PASTED MATERIAL (logs, stack traces, config, documents): never try to keep it whole; keep the one sentence the user wrote around it verbatim, plus one line saying which material it was (file name, error code, or path).";
/** 长材料门槛 L（字符）。短消息不存在"整条放不下"的问题。 */
export declare const QUOTE_LONG_CHARS = 500;
/** 长度档系数 w5 的输入：四档各自的系数。越长 → 系数越低 → importance 越低 → 越倾向宽档。 */
export declare const QUOTE_LENGTH_COEFF: {
    /** ≤120 字符 */
    readonly short: 1;
    /** 120–500 */
    readonly medium: 0.62;
    /** 500–2000 */
    readonly long: 0.34;
    /** >2000 */
    readonly huge: 0.12;
};
/**
 * `importance` 权重（和为 1）。
 * w1 强标记密度 / w2 否定词数 / w3 数字·标识符密度 / w4 祈使·第二人称 / w5 长度档系数。
 * 归一化规则见 `compress.ts` 的 `importanceOf`：每个分量都先截到 [0,1] 再加权。
 */
export declare const QUOTE_WEIGHTS: {
    readonly w1: 0.34;
    readonly w2: 0.2;
    readonly w3: 0.12;
    readonly w4: 0.2;
    readonly w5: 0.14;
};
/**
 * 档位阈值。**只对长消息生效**（短消息一律严档，D-9C，不打分）：
 * 长消息的 `importance >= T_HIGH` 说明它硬约束密度超标（自写长需求清单），
 * 收回严档（D-9D）；否则宽档。
 *
 * `T_LOW` 目前不参与判定 —— 实测 `importance` 分不开「是不是指令」，只分得开
 * 「长消息约束密不密」，所以没有第二个可用的切点。保留字段是为了将来滞后切换。
 * 改这两个值必须重跑 SG-10，并把新区间写回这里。
 */
export declare const QUOTE_T_HIGH = 0.4;
export declare const QUOTE_T_LOW = 0.25;
/**
 * 严档的**每条约束句**关键词覆盖率门槛 θ。
 *
 * 口径（计划书 §5 做法 3）：`containment = |K ∩ Tokens(summary)| / |K|`，
 * K 为去掉语气成分后的关键词集合。约束句**逐字**命中摘要时直接通过（强口径）；
 * 否则按覆盖率判。
 *
 * ⚠️ 2026-10-29 实测修正（根因②）：旧口径对短消息要求**整条**逐字，
 * 于是「严格按照本计划书执行任务。」与原文「严格按照本计划书，执行任务。」
 * 只差一个逗号就被判违规 → 10 条误报。改成按**约束句**算覆盖率后，
 * 标点差异不再致命，同时「丢了一条约束、其余全在」仍会被抓到。
 */
export declare const QUOTE_THETA_STRICT = 0.56;
/**
 * 宽档的**整条**关键词覆盖率门槛 θ。宽档允许改写措辞，只要求关键 token 存活。
 *
 * 2026-10-29 标定（SG-10）：θ 带实测 (0.5588, 1]（应报侧最大覆盖率 0.5588 =
 * M04:miss-fixture 边缘，应过侧最小 1），两档常量同取 0.56 落在带内 ——
 * 低于带下限时 M04 类边缘漏网（coverage 0.5588 ≥ 0.55 过门）。
 */
export declare const QUOTE_THETA_LOOSE = 0.56;
/**
 * 长材料「外面那句用户说明」的覆盖率门槛 θ₁（比 θ 更严：那句是唯一真正要保的）。
 */
export declare const QUOTE_THETA_OUTER = 0.7;
export declare const TIER3_CONDENSE_RULES = "TIER 3 COMPRESSION \u2014 ULTRA-CONDENSATION\n\nYou are compressing distilled summaries (Tier 2) into ultra-condensed facts (Tier 3). The distilled summaries already contain only decisions and outcomes. Your job is to reduce them to bare factual references.\n\nPRIORITY \u2014 when a source block has more facts than the size target allows, keep in this order:\n1. Shipped outcomes (versions released, PRs merged) \u2014 these are permanent record.\n2. Open work \u2014 PRs/issues still pending AND still-open user-requested objectives (re-carry any source block's `Open objectives:` entries verbatim); these may need follow-up.\n3. Key decisions with architectural impact (\"chose X over Y because Z\").\n4. Critical constraints (\"must support Node 22\").\nDrop everything else. Tier 3 is a lookup index, not a knowledge base.\n\nFORMAT:\n- Start with a source header line:\n  `Source: bN+bM+... (XK\u2192YK tok, Zx). [original topic]`\n- Output 1-3 facts per source block. Each fact is a single line: subject + outcome.\n- No explanations, no rationale, no process \u2014 just the fact.\n- Format: \"[PR/Issue/Version] \u2014 [outcome in \u22648 words]\"\n- Merge related facts from different source blocks if they concern the same topic.\n\nEXAMPLES:\n- \"v1.13.0 shipped \u2014 quality gate + GC fix (7 PRs)\"\n- \"PR #196 merged \u2014 preserve-first-user (supersedes #169)\"\n- \"Bug 1214 fixed \u2014 compress consumed all user messages\"\n- \"Objective (m00746) \u2014 eight-arm runner refactor, still open\"\n- \"Chose compress-as-anchor \u2014 prefix cache benefit over synthetic injection\"\n- \"Constraint: AGENTS.md forbids as any \u2014 never suppress types\"\n\nDROP:\n- Multi-sentence context. If a fact needs >1 sentence, it's too detailed for Tier 3.\n- Lessons learned (\"tried X, failed because Y\") \u2014 drop UNLESS the failure is likely to recur and the block is <30 days old.\n- Design rationale details \u2014 keep the decision, drop the \"because\" unless it's a critical constraint.\n- Anything marked [OBSOLETE] or [SUPERSEDED] \u2014 drop entirely, note \"[N blocks obsolete]\" in the summary.\n\nSIZE TARGET: 30-60 tokens per source block (including header). For a batch of N source blocks, total output \u2248 N \u00D7 40 tokens. If a source block has only one trivial fact, output just the header + one line.";
//# sourceMappingURL=compression-rules.d.ts.map