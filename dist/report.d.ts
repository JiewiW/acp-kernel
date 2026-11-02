import type { CompressionState, CoreMessage } from "./types.js";
/** Host-declared surface facts for status reports. The kernel never resolves
 *  packs — which pack is active is host policy (billion-context #730); the
 *  kernel only renders what the host declares about the active surface. */
export interface StatusReportMeta {
    pack?: string;
    packVersion?: string;
    host?: string;
}
export interface StatusReportOptions {
    scope?: "compressed" | "uncompressed";
    view?: "ranges" | "messages";
    tool?: string;
    sort?: "size" | "time" | "tool" | "age";
    limit?: number;
    meta?: StatusReportMeta;
    /** 用户消息原文保留条数（0 = 方案 A 全部保留；N>0 = 方案 B）。不传则不显示该行。 */
    userVerbatimKeep?: number;
}
export declare function buildStatusReport(state: CompressionState, messages: CoreMessage[], countTokens: (t: string) => number, options?: StatusReportOptions): string;
export declare function buildRecap(state: CompressionState, blockId?: string): string;
//# sourceMappingURL=report.d.ts.map