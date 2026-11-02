import type { BiliMessage } from "./bili-message.js";
export type GooglePart = {
    text?: string;
    thought?: boolean;
    thoughtSignature?: string;
    functionCall?: {
        name: string;
        args?: unknown;
        id?: string;
    };
    functionResponse?: {
        name: string;
        response?: unknown;
        id?: string;
        parts?: GooglePart[];
    };
    inlineData?: {
        mimeType: string;
        data: string;
    };
    fileData?: {
        fileUri: string;
        mimeType?: string;
    };
    [k: string]: unknown;
};
export type GoogleContent = {
    role?: string;
    parts: GooglePart[];
};
export type GoogleFunctionDeclaration = {
    name: string;
    description?: string;
    parameters?: unknown;
    parametersJsonSchema?: unknown;
    response?: unknown;
    [k: string]: unknown;
};
export type GoogleTool = {
    functionDeclarations?: GoogleFunctionDeclaration[];
    [k: string]: unknown;
};
export type GoogleSystemInstruction = {
    parts?: GooglePart[];
    role?: string;
};
export type GoogleRequestBody = {
    contents: GoogleContent[];
    systemInstruction?: GoogleSystemInstruction;
    tools?: GoogleTool[];
    toolConfig?: unknown;
    generationConfig?: Record<string, unknown>;
    cachedContent?: string;
    [k: string]: unknown;
};
export type GoogleFlat = {
    msgs: BiliMessage[];
    systemText: string;
};
/** Hoist the system dimension out of the fold space. `systemInstruction` is
 *  host runtime state exactly like the openai codec's leading system prefix
 *  (see openaiToCore): its content varies across restarts, so keeping it
 *  inside the id space made every downstream fingerprint spanning it
 *  unstable, and a compress range that covered it deleted the model's system
 *  prompt from the rebuilt wire. The adapter re-injects it as
 *  `systemInstruction` at egress. */
export declare function googleSystemText(body: GoogleRequestBody): string;
/** Map a Gemini request body onto the kernel's message space. Mirrors
 *  openaiToCore's role handling: `content.role === "model"` is the assistant
 *  side, everything else the user side. A user content's functionResponse
 *  parts expand into `role:"tool"` cores emitted BEFORE that content's own
 *  user core — the client appends a second functionResponse to the previous
 *  user content instead of opening a new one, so those parts belong to the
 *  tool pair, not to the user text they sit next to. */
export declare function googleToCore(body: GoogleRequestBody): GoogleFlat;
/** Rebuild Gemini `contents` from kernel messages. Runs of same-side cores
 *  are merged into ONE content (Gemini rejects non-alternating roles): an
 *  assistant run becomes a single `{"role":"model"}` content whose parts are
 *  ordered reasoning, text, tool-call; a user-side run (user + tool-result)
 *  becomes a single `{"role":"user"}` content whose functionResponse parts
 *  lead. Mid-conversation system cores (host-synthetic; Gemini has no system
 *  role inside contents) ride on the user side as a text part. */
export declare function coreToGoogle(messages: BiliMessage[]): GoogleContent[];
/** Text-protocol/fallback system injection. `contents` has no top-level
 *  system slot, so the prompt becomes the first part of the leading user
 *  content, or a new leading user content when none is there. The adapter and
 *  the server inject the real system via `systemInstruction` instead (see the
 *  proxy's createGoogleAdapter) — this exists for the path where no system
 *  channel is wanted. */
export declare function injectGoogleSystem(contents: GoogleContent[], parts: string[]): GoogleContent[];
/** Extract the conversation dimension for Gemini: a client-provided session
 *  header if present (omp sends none for this protocol), else a content
 *  fingerprint of the first user content. See conversationSignalAnthropic for
 *  the full rationale. */
export declare function conversationSignalGoogle(body: GoogleRequestBody, headerValue?: string): string;
//# sourceMappingURL=google.d.ts.map