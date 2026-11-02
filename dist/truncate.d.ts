/** At most maxUnits code units; never ends on a stranded high surrogate. */
export declare function clampPrefix(text: string, maxUnits: number): string;
/** A [start, end) window with both edges snapped off surrogate pairs. */
export declare function clampWindow(text: string, start: number, end: number): string;
//# sourceMappingURL=truncate.d.ts.map