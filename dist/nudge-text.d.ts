import type { NudgeDecision, CompressibleRange, ProtectedRange } from "./types.js";
import type { Prompts } from "./prompts.js";
export type NudgeVoice = "gentle" | "emergency";
export interface NudgePromptSections {
    efficiencyNote?: string | null;
    emergencyHeader?: string | null;
    t2Guidance?: string | null;
    t3Guidance?: string | null;
}
export interface RenderedNudge {
    voice: NudgeVoice;
    text: string;
}
export declare function formatRanges(compressible: CompressibleRange[], protectedRanges: ProtectedRange[]): string;
export declare function renderNudgeText(decision: NudgeDecision, prompts?: Prompts, sections?: NudgePromptSections): RenderedNudge;
//# sourceMappingURL=nudge-text.d.ts.map