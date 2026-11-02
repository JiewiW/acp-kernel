import type { CompressionState, CoreMessage } from "./types.js";
export interface HideConsumedResult {
    messages: CoreMessage[];
    hidden: number;
    /** Padded refs of the orphan compress call/result messages hidden by this
     *  pass (orphans beyond the keep window). Consumed by boundary resolution to
     *  snap a range endpoint onto a hidden-but-intact orphan (#396). */
    hiddenOrphanRefs: string[];
}
export declare function hideConsumedCompressCalls(state: CompressionState, messages: CoreMessage[]): HideConsumedResult;
//# sourceMappingURL=hide-consumed.d.ts.map