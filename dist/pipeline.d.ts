import type { CompressionState, CoreMessage, NudgeDecision } from "./types.js";
export interface PipelineContext {
    readonly config: import("./types.js").Config;
    readonly tokenCount: number;
    readonly countTokens: (text: string) => number;
    /** Per-session CCR content store for this turn (ccr-store node updates it
     *  via effects.ccr; processTurn echoes it back in the result). */
    readonly contentStore: import("./content-store.js").MessageContentStore;
}
export interface NodeEffects {
    nudge?: NudgeDecision;
    recommendation?: import("./types.js").Recommendation;
    truncatedCount?: number;
    terminalEscape?: import("./types.js").TerminalEscapeSignal;
    truncationSkipped?: string;
    readonly [key: string]: unknown;
}
export interface NodeIO {
    messages: CoreMessage[];
    state: CompressionState;
    effects: NodeEffects;
}
export interface PipelineNode {
    readonly name: string;
    run(io: NodeIO, ctx: PipelineContext): NodeIO;
    enabled?: (io: NodeIO, ctx: PipelineContext) => boolean;
}
export declare function makeIO(messages: CoreMessage[], state: CompressionState, effects?: NodeEffects): NodeIO;
export declare function runPipeline(nodes: readonly PipelineNode[], initial: NodeIO, ctx: PipelineContext): NodeIO;
//# sourceMappingURL=pipeline.d.ts.map