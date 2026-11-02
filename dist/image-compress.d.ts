import type { Config, CompressionState, ImageBillingMode, ImageCompressionConfig, ImageFormat, ImageShrinkRecord } from "./types.js";
/**
 * Image pre-compression (#353, filed from billion-context#1095 analysis):
 * screenshot-like tool-result images are downscaled ONCE at arrival before
 * entering the wire; non-screenshot originals pass through untouched; the
 * lossy step is backstopped by the image_full restore channel.
 *
 * Kernel scope (pure, zero native deps): routing decision + recipe, billing-
 * aware token estimation (canonical copy — moved from billion-context
 * src/image-tokens.ts), image_full contract (arg parsing, sticky-restore
 * state machine, result strings, system-note fragment), shrink records and
 * stats counters on session state.
 *
 * Host scope (NOT here): executing the recipe with a real encoder
 * (deterministic resize fit-inside withoutEnlargement → flatten →
 * webp{quality} / jpeg{quality, mozjpeg} / png{compressionLevel:9}, keeping
 * the smaller of original vs encoded), sidecar file I/O under the #1097
 * store, wire-body substitution across protocols, plugin-manifest
 * registration, logging.
 *
 * Determinism is load-bearing: the downsampled bytes become the standing
 * wire content after arrival-time substitution; a non-deterministic recipe
 * would invalidate the provider prefix cache mid-session (same invariant as
 * #1097's placeholder determinism).
 */
export declare const DEFAULT_IMAGE_COMPRESSION_CONFIG: Required<ImageCompressionConfig>;
/** Sub-field merge over defaults; hosts layer global → provider → model
 *  exactly like absorb (three levels). */
export declare function resolveImageCompressionConfig(config: Config): Required<ImageCompressionConfig>;
/** Pixels-mode fallback when dimensions cannot be parsed header-only: the
 *  worst-case high-detail bill. */
export declare const PIXEL_IMAGE_FALLBACK_TOKENS = 16384;
export interface ImageDimensions {
    width: number;
    height: number;
}
/** Header-only dimension parse: reads just enough leading bytes for container
 *  headers. Supports PNG / GIF / BMP / WebP (VP8X, VP8L, VP8 lossy) / JPEG
 *  (SOF segment scan). Unknown formats or truncated headers → undefined. */
export declare function parseImageDimensions(bytes: Uint8Array): ImageDimensions | undefined;
/** Base64 convenience entry: decodes only the leading slice — enough for
 *  container headers (PNG/GIF/BMP/WebP within 64 chars; JPEG SOF within ~350K
 *  chars of EXIF bloat). Node-targeted (Buffer). */
export declare function parseImageDimensionsFromBase64(b64: string): ImageDimensions | undefined;
/** OpenAI high-detail tile model: scale so the short side is at least 768
 *  (providers bill small images enlarged), cap the long side at 2048, then
 *  85 + 170 per 512×512 tile. Bounds ≈ [765, 2805]. */
export declare function pixelTileEstimate(width: number, height: number): number;
/** One image attachment's metadata as seen by the routing decision. */
export interface ImageMeta {
    mediaType: string;
    /** Length of the base64 payload (characters). */
    base64Length: number;
    width?: number;
    height?: number;
    /** Upstream billing mode for this image. Default "bytes" (conservative). */
    billing?: ImageBillingMode;
    /** Optional base64 payload; only its leading decode budget is read, and
     *  only when width/height are missing in pixels mode. */
    base64?: string;
}
/** Billing-aware estimate of an image's token cost. Pixels mode uses the tile
 *  model on real dimensions (header-parsed from the payload head when absent);
 *  bytes mode counts ceil(base64len/4). Unknown dims in pixels mode fall back
 *  to PIXEL_IMAGE_FALLBACK_TOKENS. */
export declare function estimateImageTokens(meta: ImageMeta): number;
/** Pluggable screenshot classifier. v1 ships the heuristic below; a trained
 *  router slots in here later without pipeline changes. */
export interface ScreenshotClassifier {
    readonly name: string;
    isScreenshotLike(meta: ImageMeta): boolean;
}
export interface HeuristicClassifierOptions {
    /** Low end of the long/short aspect band. Default 1.4. */
    aspectRatioMin?: number;
    /** High end of the long/short aspect band. Default 2.6. */
    aspectRatioMax?: number;
    /** Short-side floor (px): below it even band-shaped images pass — small
     *  crops would be upscaled by the tile model and billed larger. Default 720. */
    minShortSide?: number;
}
/** v1 heuristic: long/short aspect ratio within [1.4, 2.6] AND short side ≥
 *  720 px. Missing dimensions → false (conservative: never route what cannot
 *  be classified). Known limitation: 3:2 photos (ratio 1.5) false-positive as
 *  screenshots until a trained router slots into the classifier interface. */
export declare function createHeuristicClassifier(options?: HeuristicClassifierOptions): ScreenshotClassifier;
export declare const DEFAULT_SCREENSHOT_CLASSIFIER: ScreenshotClassifier;
export type ImageRouteReason = "disabled" | "not-an-image" | "below-min-tokens" | "not-screenshot-like" | "downsample";
/** Downsample parameters the host executes with its own encoder (sharp etc.). */
export interface DownsampleRecipe {
    /** Longest side (px) after resize. */
    maxDimension: number;
    quality: number;
    format: ImageFormat;
}
export interface ImageRoutingDecision {
    action: "pass" | "downsample";
    reason: ImageRouteReason;
    /** Token estimate of the ORIGINAL payload (host log lines). */
    estimatedTokens: number;
    recipe?: DownsampleRecipe;
}
/** Pure + deterministic: same input + config → identical decision, always.
 *  The host executes the returned recipe exactly once, at arrival time. */
export declare function decideImageRoute(meta: ImageMeta, config: Config, classifier?: ScreenshotClassifier): ImageRoutingDecision;
/** Failure-prefix convention (mirrors absorb's marker style): any resultText
 *  starting with this marks a rejected call. */
export declare const IMAGE_FULL_FAILURE_MARKER = "[image_full FAILED:";
/** Byte-stable system-prompt fragment; count = images downscaled so far in
 *  this session. Hosts inject it while the feature is enabled and shrinks
 *  exist. */
export declare function buildImageFullSystemNote(count: number): string;
/** Content-store entry-kind contract for image originals (#1097 store layout:
 *  binary sidecar entries under the same mNNNNN key scheme, append-once,
 *  drop-on-fold). The kernel owns this shape; file I/O stays host-side. */
export interface ImageStoreEntry {
    kind: "image";
    ref: string;
    rawMessageId: string;
    mediaType: string;
    originalBytes: number;
    createdAt: number;
}
export interface ParsedImageFull {
    ref: string;
    callId?: string;
}
/** Lenient arg parser mirroring parseAbsorbInput: accepts object or JSON-
 *  string payloads, key aliases (ref/messageId/of), trims whitespace. */
export declare function parseImageFullInput(input: unknown, callId?: string, onWarn?: (message: string) => void): ParsedImageFull | null;
/** Append one shrink record and bump cumulative stats. Pure: returns new state. */
export declare function recordImageShrink(state: CompressionState, record: ImageShrinkRecord): CompressionState;
export declare function isImageFullRestored(state: CompressionState, ref: string): boolean;
export declare function imageShrinksForRef(state: CompressionState, ref: string): ImageShrinkRecord[];
export interface ImageFullInput {
    ref: string;
    state: CompressionState;
    config: Config;
}
export interface ImageFullOutcome {
    state: CompressionState;
    ok: boolean;
    resultText: string;
}
/** Sticky-restore state machine. Success marks the ref restored for the rest
 *  of the session (idempotent re-calls report "already restored"). Failure
 *  modes return ok:false with an [image_full FAILED: ...] resultText. Pure:
 *  returns new state. */
export declare function applyImageFull(input: ImageFullInput): ImageFullOutcome;
/** Drop ref-keyed image_full state after a compaction reset (native-compaction
 *  archive, fork recovery, session restart). Refs are re-issued from m00001
 *  after a state reset, so stale entries would misattribute. Cumulative stats
 *  survive — they remain valid aggregates. Hosts MUST call this on every
 *  state reset. */
export declare function resetImageFullState(state: CompressionState): CompressionState;
//# sourceMappingURL=image-compress.d.ts.map