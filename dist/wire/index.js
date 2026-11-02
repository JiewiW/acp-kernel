// src/wire/util.ts
import { createHash } from "crypto";
function hashId(s) {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

// src/wire/message-id.ts
function deriveMessageId(role, contentType, text, options = {}) {
  const seed = `${role}|${contentType}|${options.toolCallId ?? ""}|${options.toolName ?? ""}|${text}`;
  return "h_" + hashId(seed);
}
var ClusterCounter = class {
  counts = /* @__PURE__ */ new Map();
  next(baseId) {
    const n = this.counts.get(baseId) ?? 0;
    this.counts.set(baseId, n + 1);
    return n === 0 ? baseId : `${baseId}_${n}`;
  }
};

// src/wire/anthropic.ts
function extractSystem(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}
function buildSystem(text, original) {
  if (Array.isArray(original) && original.length > 0) {
    const ccBlock = original.find((b) => b.cache_control);
    return [
      {
        type: "text",
        text,
        ...ccBlock ? { cache_control: ccBlock.cache_control } : {}
      }
    ];
  }
  return text;
}
function anthropicToCore(body) {
  const msgs = [];
  const cacheControls = /* @__PURE__ */ new Map();
  const clusters = new ClusterCounter();
  const toolNames = /* @__PURE__ */ new Map();
  for (const m of body.messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of blocks) {
      switch (b.type) {
        case "text": {
          const base = deriveMessageId(m.role, "text", b.text);
          const id = clusters.next(base);
          msgs.push({ id, role: m.role, contentType: "text", text: b.text });
          if (b.cache_control) cacheControls.set(id, b.cache_control);
          break;
        }
        case "tool_use": {
          const base = deriveMessageId(
            "assistant",
            "tool-call",
            safeStringify(b.input),
            {
              toolCallId: b.id,
              toolName: b.name
            }
          );
          const id = clusters.next(base);
          msgs.push({
            id,
            role: "assistant",
            contentType: "tool-call",
            toolName: b.name,
            toolCallId: b.id,
            text: safeStringify(b.input)
          });
          toolNames.set(b.id, b.name);
          if (b.cache_control) cacheControls.set(id, b.cache_control);
          break;
        }
        case "tool_result": {
          const hasNonText = Array.isArray(b.content) && b.content.some((c) => c.type !== "text");
          const text = typeof b.content === "string" ? b.content : b.content.map((c) => c.type === "text" ? c.text : "").join("\n");
          const base = deriveMessageId("tool", "tool-result", text, {
            toolCallId: b.tool_use_id
          });
          const id = clusters.next(base);
          const name = toolNames.get(b.tool_use_id);
          msgs.push({
            id,
            role: "tool",
            contentType: "tool-result",
            toolCallId: b.tool_use_id,
            text,
            ...name ? { toolName: name } : {},
            ...b.is_error === true ? { toolIsError: true } : {},
            ...hasNonText ? { rawAnthropicBlock: b } : {}
          });
          if (b.cache_control) cacheControls.set(id, b.cache_control);
          break;
        }
        case "thinking": {
          const base = deriveMessageId("assistant", "reasoning", b.thinking);
          msgs.push({
            id: clusters.next(base),
            role: "assistant",
            contentType: "reasoning",
            text: b.thinking,
            ...b.signature ? { thinkingSignature: b.signature } : {}
          });
          break;
        }
        case "image": {
          const base = deriveMessageId(m.role, "text", "[image]");
          msgs.push({
            id: clusters.next(base),
            role: m.role,
            contentType: "text",
            text: "[image]",
            rawAnthropicBlock: b
          });
          break;
        }
        case "redacted_thinking": {
          const base = deriveMessageId(m.role, "text", "[redacted_thinking]");
          msgs.push({
            id: clusters.next(base),
            role: m.role,
            contentType: "text",
            text: "[redacted_thinking]",
            rawAnthropicBlock: b
          });
          break;
        }
      }
    }
  }
  return { msgs, cacheControls };
}
function coreToAnthropic(messages, cacheControls) {
  const out = [];
  let current = null;
  const flush = () => {
    if (current && current.blocks.length > 0) {
      out.push({ role: current.role, content: current.blocks });
    }
    current = null;
  };
  const cc = (id) => {
    const v = cacheControls?.get(id);
    return v ? { cache_control: v } : {};
  };
  for (const m of messages) {
    const target = m.role === "assistant" ? "assistant" : "user";
    if (!current || current.role !== target) {
      flush();
      current = { role: target, blocks: [] };
    }
    switch (m.contentType) {
      case "text": {
        if (m.rawAnthropicBlock) {
          current.blocks.push(m.rawAnthropicBlock);
          break;
        }
        current.blocks.push({ type: "text", text: m.text ?? "", ...cc(m.id) });
        break;
      }
      case "tool-call":
        current.blocks.push({
          type: "tool_use",
          id: m.toolCallId ?? `call_${m.id}`,
          name: m.toolName ?? "unknown",
          input: safeParse(m.text),
          ...cc(m.id)
        });
        break;
      case "tool-result":
        if (m.rawAnthropicBlock) {
          current.blocks.push(m.rawAnthropicBlock);
          break;
        }
        current.blocks.push({
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: m.text ?? "",
          ...m.toolIsError ? { is_error: true } : {},
          ...cc(m.id)
        });
        break;
      case "reasoning":
        current.blocks.push({
          type: "thinking",
          thinking: m.text ?? "",
          ...m.thinkingSignature ? { signature: m.thinkingSignature } : {}
        });
        break;
    }
  }
  flush();
  return out;
}
function conversationSignalAnthropic(body, headerValue) {
  if (headerValue && headerValue.trim()) return headerValue.trim();
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const firstUser = msgs.find((m) => m?.role === "user");
  const seed = firstUser ? JSON.stringify(firstUser.content) : "default";
  return hashId(seed);
}
function safeStringify(v) {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return "{}";
  }
}
function safeParse(s) {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// src/wire/demoted-thinking.ts
var FORMS = [
  { open: "<think>\n", close: "\n</think>" },
  { open: "<thinking>\n", close: "\n</thinking>" },
  { open: "```thinking\n", close: "\n```" }
];
function splitDemotedThinking(content) {
  let rest = content;
  const parts = [];
  for (; ; ) {
    let matched = false;
    for (const form of FORMS) {
      if (!rest.startsWith(form.open)) continue;
      const end = rest.indexOf(form.close, form.open.length);
      if (end < 0) continue;
      const inner = rest.slice(form.open.length, end);
      if (inner.length === 0) continue;
      parts.push(inner);
      rest = rest.slice(end + form.close.length);
      if (rest.startsWith("\n")) rest = rest.slice(1);
      matched = true;
      break;
    }
    if (!matched) break;
  }
  if (parts.length === 0) return null;
  return { reasoning: parts.join("\n"), text: rest };
}

// src/wire/bili-message.ts
function toCoreMessages(msgs) {
  return msgs;
}
function parseDataUrl(url) {
  const m = /^data:([^;,]+)(?:;base64)?,(.+)$/i.exec(url);
  if (!m) return void 0;
  return { mediaType: m[1], base64: m[2] };
}

// src/wire/openai.ts
function openaiToCore(body) {
  const msgs = [];
  const systemParts = [];
  const clusters = new ClusterCounter();
  const toolNames = /* @__PURE__ */ new Map();
  for (const m of body.messages) {
    switch (m.role) {
      case "system":
      case "developer": {
        if (msgs.length === 0) {
          systemParts.push(stringContent(m.content));
          break;
        }
        const base = deriveMessageId(m.role, "text", stringContent(m.content));
        msgs.push({
          id: clusters.next(base),
          role: "system",
          contentType: "text",
          text: stringContent(m.content),
          originalRole: m.role
        });
        break;
      }
      case "user": {
        const text = stringContent(m.content);
        const nonText = allNonTextParts(m.content);
        const imgs = allImageParts(m.content);
        const firstImg = imgs[0];
        const firstUrl = firstImg ? firstImg.image_url.url : void 0;
        const firstParsed = firstUrl ? parseDataUrl(firstUrl) : void 0;
        const base = deriveMessageId("user", "text", text);
        msgs.push({
          id: clusters.next(base),
          role: "user",
          contentType: "text",
          text,
          // A lone string-URL image keeps the legacy singular sidecar
          // (byte-stable for pre-existing shapes). Any other mix —
          // multiple images, or any unknown part type such as a
          // DeepSeek Files API `{type:"file"}` ref — rides the plural
          // sidecar verbatim so coreToOpenai can re-emit it
          // (billion-context#1205: unknown parts were silently dropped).
          ...imgs.length === 1 && nonText.length === 1 ? {
            rawOpenaiContent: imgs[0],
            // data: URLs only — remote URLs ride rawOpenaiContent
            // verbatim (#187/#291)
            ...firstParsed ? {
              imageMediaType: firstParsed.mediaType,
              imageBase64: firstParsed.base64
            } : {}
          } : nonText.length > 0 ? { rawOpenaiContentParts: nonText } : {}
        });
        break;
      }
      case "assistant": {
        const rawReasoning = m.reasoning_content;
        const fieldPresent = typeof rawReasoning === "string";
        const fieldReasoning = fieldPresent ? rawReasoning : "";
        let reasoning = fieldReasoning;
        let text = stringContent(m.content);
        if (!reasoning) {
          const split = splitDemotedThinking(text);
          if (split) {
            reasoning = split.reasoning;
            text = split.text;
          }
        }
        const blankEcho = fieldPresent && reasoning.length === 0;
        if (reasoning) {
          const base = deriveMessageId("assistant", "reasoning", reasoning);
          msgs.push({
            id: clusters.next(base),
            role: "assistant",
            contentType: "reasoning",
            text: reasoning,
            reasoningContent: reasoning
          });
        }
        if (text) {
          const base = deriveMessageId("assistant", "text", text);
          msgs.push({
            id: clusters.next(base),
            role: "assistant",
            contentType: "text",
            text,
            ...blankEcho ? { reasoningPresent: true } : {}
          });
        }
        if (Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) {
            const base = deriveMessageId(
              "assistant",
              "tool-call",
              tc.function.arguments ?? "",
              {
                toolCallId: tc.id,
                toolName: tc.function.name
              }
            );
            msgs.push({
              id: clusters.next(base),
              role: "assistant",
              contentType: "tool-call",
              toolName: tc.function.name,
              toolCallId: tc.id,
              text: tc.function.arguments ?? "",
              ...blankEcho ? { reasoningPresent: true } : {}
            });
            toolNames.set(tc.id, tc.function.name);
          }
        }
        break;
      }
      case "tool": {
        const base = deriveMessageId(
          "tool",
          "tool-result",
          stringContent(m.content),
          {
            toolCallId: m.tool_call_id ?? ""
          }
        );
        const name = m.name || toolNames.get(m.tool_call_id ?? "");
        msgs.push({
          id: clusters.next(base),
          role: "tool",
          contentType: "tool-result",
          toolCallId: m.tool_call_id ?? "",
          text: stringContent(m.content),
          ...name ? { toolName: name } : {}
        });
        break;
      }
    }
  }
  return { msgs, systemText: systemParts.join("\n\n") };
}
function coreToOpenai(messages) {
  const out = [];
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const reasoning = pending.reasoning !== null && pending.reasoning.length > 0 ? pending.reasoning : void 0;
    const reasoningField = reasoning !== void 0 ? { reasoning_content: reasoning } : pending.reasoningPresent ? { reasoning_content: "" } : {};
    if (pending.toolCalls.length > 0) {
      out.push({
        role: "assistant",
        content: pending.text ?? null,
        tool_calls: pending.toolCalls,
        ...reasoningField
      });
    } else if (pending.text !== null) {
      out.push({ role: "assistant", content: pending.text, ...reasoningField });
    } else if (reasoning) {
      out.push({
        role: "assistant",
        content: null,
        reasoning_content: reasoning
      });
    }
    pending = null;
  };
  for (const m of messages) {
    if (m.role === "assistant") {
      if (!pending)
        pending = {
          text: null,
          toolCalls: [],
          reasoning: null,
          reasoningPresent: false
        };
      if (m.reasoningPresent) pending.reasoningPresent = true;
      if (m.contentType === "reasoning") {
        pending.reasoning = (pending.reasoning ?? "") + (m.reasoningContent ?? m.text ?? "");
      } else if (m.contentType === "text") {
        pending.text = (pending.text ?? "") + (m.text ?? "");
      } else if (m.contentType === "tool-call") {
        pending.toolCalls.push({
          id: m.toolCallId ?? `call_${m.id}`,
          type: "function",
          function: { name: m.toolName ?? "unknown", arguments: m.text ?? "" }
        });
      }
    } else {
      flush();
      if (m.role === "system") {
        out.push({
          role: m.originalRole === "developer" ? "developer" : "system",
          content: m.text ?? ""
        });
      } else if (m.role === "user") {
        if (m.rawOpenaiContent || m.imageBase64 || m.rawOpenaiContentParts) {
          const parts = [];
          if (m.text) parts.push({ type: "text", text: m.text });
          if (m.rawOpenaiContentParts && m.rawOpenaiContentParts.length > 0) {
            for (const part of m.rawOpenaiContentParts)
              parts.push(part);
          } else if (m.rawOpenaiContent) {
            parts.push(m.rawOpenaiContent);
          } else if (m.imageBase64 && m.imageMediaType) {
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${m.imageMediaType};base64,${m.imageBase64}`
              }
            });
          }
          out.push({ role: "user", content: parts });
        } else {
          out.push({ role: "user", content: m.text ?? "" });
        }
      } else if (m.role === "tool") {
        out.push({
          role: "tool",
          tool_call_id: m.toolCallId ?? "",
          content: m.text ?? ""
        });
      }
    }
  }
  flush();
  return out;
}
function injectOpenaiSystem(messages, parts) {
  if (parts.length === 0) return messages;
  const extra = parts.join("\n\n");
  if (messages.length > 0 && (messages[0]?.role === "system" || messages[0]?.role === "developer")) {
    const head = messages[0];
    const base = stringContent(head.content);
    const merged = base ? `${base}

---

${extra}` : extra;
    return [{ ...head, content: merged }, ...messages.slice(1)];
  }
  return [{ role: "system", content: extra }, ...messages];
}
function conversationSignalOpenai(body, headerValue) {
  if (headerValue && headerValue.trim()) return headerValue.trim();
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const firstUser = msgs.find((m) => m?.role === "user");
  const seed = firstUser ? stringContent(firstUser.content) : "default";
  return hashId(seed);
}
function stringContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(
      (p) => typeof p === "string" ? p : p.type === "text" ? p.text ?? "" : ""
    ).join("\n");
  }
  return "";
}
function allImageParts(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (typeof p !== "object" || p === null) continue;
    if (!("type" in p) || p.type !== "image_url" || !("image_url" in p))
      continue;
    const imagePart = p;
    const url = imagePart.image_url?.url;
    if (typeof url === "string") out.push(p);
  }
  return out;
}
function allNonTextParts(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (typeof p !== "object" || p === null) continue;
    if (p.type === "text") continue;
    out.push(p);
  }
  return out;
}

// src/wire/responses.ts
var OPAQUE_ITEM_TYPES = /* @__PURE__ */ new Set(["additional_tools", "mcp_list_tools"]);
function isOpaqueItem(item) {
  return OPAQUE_ITEM_TYPES.has(item.type);
}
var EASY_INPUT_ROLES = /* @__PURE__ */ new Set(["user", "assistant", "system", "developer"]);
function normalizeEasyInputItem(item) {
  if (typeof item.type === "string") return item;
  if (EASY_INPUT_ROLES.has(String(item.role))) {
    return {
      ...item,
      type: "message"
    };
  }
  return item;
}
function shouldDropAllReasoning() {
  return (process.env.ACP_REASONING_KEEP ?? "").trim().toLowerCase() === "none";
}
function partText(part) {
  if (part.type === "input_text" || part.type === "output_text") {
    return typeof part.text === "string" ? part.text : "";
  }
  return "";
}
function messageContent(content) {
  return typeof content === "string" ? content : content.map(partText).join("\n");
}
function userDisplayText(content, text) {
  if (typeof content === "string") return text;
  const hasImage = content.some((part) => part.type === "input_image");
  const hasTextPart = content.some(
    (part) => part.type === "input_text" || part.type === "output_text"
  );
  return !text || hasImage && !hasTextPart ? "[image]" : text;
}
function reasoningText(item) {
  const fromParts = (parts, type) => {
    if (!Array.isArray(parts)) return "";
    const texts = [];
    for (const part of parts) {
      if (part && typeof part === "object" && "type" in part && "text" in part) {
        const rec = part;
        if (rec.type === type && typeof rec.text === "string")
          texts.push(rec.text);
      }
    }
    return texts.join("\n");
  };
  const content = "content" in item ? item.content : void 0;
  const summary = "summary" in item ? item.summary : void 0;
  return fromParts(content, "reasoning_text") || fromParts(summary, "summary_text");
}
function responsesToCore(body) {
  const msgs = [];
  const systemParts = [];
  const preamble = [];
  const customToolCallIds = /* @__PURE__ */ new Set();
  const layout = [];
  let droppedReasoning = 0;
  const clusters = new ClusterCounter();
  const toolNames = /* @__PURE__ */ new Map();
  let idx = 0;
  if (typeof body.instructions === "string" && body.instructions.trim())
    systemParts.push(body.instructions);
  if (typeof body.input === "string") {
    const id = clusters.next(deriveMessageId("user", "text", body.input));
    msgs.push({ id, role: "user", contentType: "text", text: body.input });
    return {
      msgs,
      systemParts,
      preamble,
      customToolCallIds,
      layout,
      droppedReasoning,
      stringInput: { original: body.input, coreId: id }
    };
  }
  for (const raw of body.input) {
    const item = normalizeEasyInputItem(raw);
    let coreId;
    if (isOpaqueItem(item)) preamble.push(item);
    switch (item.type) {
      case "reasoning": {
        if (shouldDropAllReasoning()) {
          droppedReasoning++;
          continue;
        }
        const text = reasoningText(item);
        const rid = text.length > 0 ? text : "id" in item && typeof item.id === "string" ? item.id : hashId(JSON.stringify(item));
        coreId = clusters.next(deriveMessageId("assistant", "reasoning", rid));
        msgs.push({
          id: coreId,
          role: "assistant",
          contentType: "reasoning",
          text: rid,
          rawResponsesItem: item
        });
        break;
      }
      case "message": {
        const message = item;
        const text = messageContent(message.content);
        if (message.role === "system" || message.role === "developer") {
          systemParts.push(text);
          idx++;
          continue;
        } else if (message.role === "user" || message.role === "assistant" && text) {
          const role = message.role;
          let effText = text;
          if (role === "assistant") {
            const split = splitDemotedThinking(text);
            if (split) {
              msgs.push({
                id: clusters.next(
                  deriveMessageId("assistant", "reasoning", split.reasoning)
                ),
                role: "assistant",
                contentType: "reasoning",
                text: split.reasoning,
                rawResponsesItem: item
              });
              effText = split.text;
            }
          }
          const hasImage = Array.isArray(message.content) && message.content.some((part) => part.type === "input_image");
          if (effText || role === "user" && hasImage) {
            const displayText = role === "user" ? userDisplayText(message.content, effText) : effText;
            coreId = clusters.next(deriveMessageId(role, "text", displayText));
            const imageUrl = Array.isArray(message.content) ? message.content.find(
              (part) => part.type === "input_image" && typeof part.image_url === "string"
            )?.image_url : void 0;
            const image = typeof imageUrl === "string" ? parseDataUrl(imageUrl) : void 0;
            msgs.push({
              id: coreId,
              role,
              contentType: "text",
              text: displayText,
              rawResponsesItem: item,
              ...image ? { imageMediaType: image.mediaType, imageBase64: image.base64 } : {}
            });
          }
        }
        break;
      }
      case "function_call": {
        const call = item;
        coreId = clusters.next(
          deriveMessageId("assistant", "tool-call", call.arguments ?? "", {
            toolCallId: call.call_id,
            toolName: call.name
          })
        );
        msgs.push({
          id: coreId,
          role: "assistant",
          contentType: "tool-call",
          toolName: call.name,
          toolCallId: call.call_id,
          text: call.arguments ?? "",
          rawResponsesItem: item
        });
        toolNames.set(call.call_id, call.name);
        break;
      }
      case "function_call_output": {
        const output = item;
        const text = typeof output.output === "string" ? output.output : JSON.stringify(output.output);
        coreId = clusters.next(
          deriveMessageId("tool", "tool-result", text, {
            toolCallId: output.call_id
          })
        );
        const name = toolNames.get(output.call_id);
        msgs.push({
          id: coreId,
          role: "tool",
          contentType: "tool-result",
          toolCallId: output.call_id,
          text,
          ...name ? { toolName: name } : {},
          rawResponsesItem: item
        });
        break;
      }
      case "computer_call":
      case "computer_call_output":
      case "file_search_call":
      case "web_search_call":
      case "image_generation_call":
      case "code_interpreter_call":
      case "mcp_call": {
        const rid = typeof item.id === "string" ? String(item.id) : hashId(JSON.stringify(item));
        coreId = clusters.next(
          deriveMessageId("assistant", "responses-call", rid)
        );
        msgs.push({
          id: coreId,
          role: "assistant",
          contentType: "reasoning",
          text: rid,
          rawResponsesItem: item
        });
        break;
      }
      case "custom_tool_call": {
        const ctc = item;
        const callId = ctc.call_id ?? `call_${idx}`;
        customToolCallIds.add(callId);
        const argText = ctc.input ?? ctc.arguments ?? "";
        coreId = clusters.next(
          deriveMessageId("assistant", "tool-call", argText, {
            toolCallId: callId,
            toolName: ctc.name ?? "custom"
          })
        );
        msgs.push({
          id: coreId,
          role: "assistant",
          contentType: "tool-call",
          toolName: ctc.name ?? "custom",
          toolCallId: callId,
          text: argText,
          rawResponsesItem: item
        });
        toolNames.set(callId, ctc.name ?? "custom");
        break;
      }
      case "custom_tool_call_output": {
        const ctco = item;
        const callId = ctco.call_id ?? `call_${idx}`;
        customToolCallIds.add(callId);
        const outText = typeof ctco.output === "string" ? ctco.output : JSON.stringify(ctco.output ?? "");
        coreId = clusters.next(
          deriveMessageId("tool", "tool-result", outText, {
            toolCallId: callId
          })
        );
        const name = toolNames.get(callId);
        msgs.push({
          id: coreId,
          role: "tool",
          contentType: "tool-result",
          toolCallId: callId,
          text: outText,
          ...name ? { toolName: name } : {},
          rawResponsesItem: item
        });
        break;
      }
      default:
        if (!isOpaqueItem(item)) preamble.push(item);
        break;
    }
    layout.push({ original: item, coreId });
    idx++;
  }
  return {
    msgs,
    systemParts,
    preamble,
    customToolCallIds,
    layout,
    droppedReasoning
  };
}
function patchTextParts(parts, text) {
  const textIndexes = parts.flatMap(
    (part, index) => part.type === "input_text" || part.type === "output_text" ? [index] : []
  );
  if (textIndexes.length === 0) return [{ type: "input_text", text }, ...parts];
  const first = textIndexes[0];
  const remaining = new Set(textIndexes.slice(1));
  return parts.map((part, index) => {
    if (index === first) return { ...part, text };
    if (remaining.has(index)) return { ...part, text: "" };
    return part;
  });
}
function patchOriginalItem(original, source, next) {
  if (source.text === next.text && source.toolName === next.toolName && source.toolCallId === next.toolCallId && source.role === next.role && source.contentType === next.contentType)
    return original;
  if (original.type === "message") {
    const message = original;
    const content = typeof message.content === "string" ? next.text ?? "" : patchTextParts(message.content, next.text ?? "");
    return { ...message, content };
  }
  if (original.type === "function_call") {
    return {
      ...original,
      name: next.toolName ?? String(original.name ?? "unknown"),
      call_id: next.toolCallId ?? String(original.call_id ?? ""),
      arguments: next.text ?? ""
    };
  }
  if (original.type === "function_call_output") {
    return {
      ...original,
      call_id: next.toolCallId ?? String(original.call_id ?? ""),
      output: next.text ?? ""
    };
  }
  return original;
}
function patchResponsesInput(projection, messages) {
  if (projection.stringInput) {
    const original = projection.msgs.find(
      (message) => message.id === projection.stringInput?.coreId
    );
    const next = messages.find(
      (message) => message.id === projection.stringInput?.coreId
    );
    if (original && next && messages.length === 1 && next.role === "user" && next.contentType === "text") {
      return next.text === original.text ? projection.stringInput.original : next.text ?? "";
    }
    return coreToResponses(messages, projection.customToolCallIds);
  }
  const sourceById = new Map(
    projection.msgs.map((message) => [message.id, message])
  );
  const nextById = new Map(messages.map((message) => [message.id, message]));
  const slotById = /* @__PURE__ */ new Map();
  projection.layout.forEach((slot, index) => {
    if (slot.coreId) slotById.set(slot.coreId, index);
  });
  const insertions = /* @__PURE__ */ new Map();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (sourceById.has(message.id)) continue;
    let target = projection.layout.length;
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex++) {
      const slot = slotById.get(messages[nextIndex].id);
      if (slot !== void 0) {
        target = slot;
        break;
      }
    }
    const generated = coreToResponses([message], projection.customToolCallIds);
    if (generated.length > 0)
      insertions.set(target, [...insertions.get(target) ?? [], ...generated]);
  }
  const out = [];
  projection.layout.forEach((slot, index) => {
    out.push(...insertions.get(index) ?? []);
    if (!slot.coreId) {
      out.push(slot.original);
      return;
    }
    const source = sourceById.get(slot.coreId);
    const next = nextById.get(slot.coreId);
    if (source && next)
      out.push(patchOriginalItem(slot.original, source, next));
  });
  out.push(...insertions.get(projection.layout.length) ?? []);
  return out;
}
function coreToResponses(messages, customToolCallIds = /* @__PURE__ */ new Set()) {
  const out = [];
  for (const message of messages) {
    const biliMessage = message;
    const raw = biliMessage.rawResponsesItem;
    if (message.role === "system") {
      out.push({
        type: "message",
        role: "developer",
        content: message.text ?? ""
      });
    } else if (message.role === "user") {
      const rawMessage = raw?.type === "message" ? raw : void 0;
      if (rawMessage && userDisplayText(
        rawMessage.content,
        messageContent(rawMessage.content)
      ) === (message.text ?? ""))
        out.push(rawMessage);
      else
        out.push({
          type: "message",
          role: "user",
          content: message.text ?? ""
        });
    } else if (message.role === "assistant") {
      if (message.contentType === "text") {
        out.push({
          type: "message",
          role: "assistant",
          content: message.text ?? ""
        });
      } else if (message.contentType === "tool-call") {
        const callId = message.toolCallId ?? `call_${message.id}`;
        if (customToolCallIds.has(callId)) {
          out.push({
            type: "custom_tool_call",
            call_id: callId,
            name: message.toolName ?? "unknown",
            input: message.text ?? "",
            status: "completed"
          });
        } else {
          out.push({
            type: "function_call",
            call_id: callId,
            name: message.toolName ?? "unknown",
            arguments: message.text ?? ""
          });
        }
      } else if (message.contentType === "reasoning") {
        if (raw) out.push(raw);
      }
    } else if (message.role === "tool") {
      const callId = message.toolCallId ?? "";
      if (customToolCallIds.has(callId)) {
        out.push({
          type: "custom_tool_call_output",
          call_id: callId,
          output: message.text ?? ""
        });
      } else {
        out.push({
          type: "function_call_output",
          call_id: callId,
          output: message.text ?? ""
        });
      }
    }
  }
  return out;
}
function injectResponsesDeveloperMessage(input, content) {
  const items = typeof input === "string" ? [{ type: "message", role: "user", content: input }] : [...input];
  let index = 0;
  while (items[index]?.type === "additional_tools") index++;
  items.splice(index, 0, { type: "message", role: "developer", content });
  return items;
}
function conversationIdentityResponses(body, headerValue) {
  if (headerValue?.trim())
    return {
      value: headerValue.trim(),
      source: "header",
      clientProvided: true
    };
  if (typeof body.session_id === "string" && body.session_id.trim()) {
    return {
      value: body.session_id.trim(),
      source: "body-session",
      clientProvided: true
    };
  }
  const metadataSession = body.metadata?.session_id;
  if (typeof metadataSession === "string" && metadataSession.trim()) {
    return {
      value: metadataSession.trim(),
      source: "metadata-session",
      clientProvided: true
    };
  }
  if (typeof body.previous_response_id === "string" && body.previous_response_id.trim()) {
    return {
      value: body.previous_response_id.trim(),
      source: "previous-response",
      clientProvided: false
    };
  }
  return {
    value: hashId(JSON.stringify(body.input ?? [])),
    source: "content-fingerprint",
    clientProvided: false
  };
}
function conversationSignalResponses(body, headerValue) {
  return conversationIdentityResponses(body, headerValue).value;
}
function createSubagentNamespaces() {
  const anchors = /* @__PURE__ */ new Map();
  return {
    namespaceFor(identityValue, instructions) {
      if (typeof instructions !== "string" || instructions.trim().length === 0)
        return identityValue;
      const fp = hashId(instructions);
      const anchor = anchors.get(identityValue);
      if (anchor === void 0) {
        anchors.set(identityValue, fp);
        return identityValue;
      }
      return anchor === fp ? identityValue : `${identityValue}|sub:${fp}`;
    }
  };
}
var defaultNamespaces = createSubagentNamespaces();
function subagentNamespace(identityValue, instructions) {
  return defaultNamespaces.namespaceFor(identityValue, instructions);
}

// src/wire/google.ts
function googleSystemText(body) {
  const parts = body.systemInstruction?.parts;
  if (!Array.isArray(parts)) return "";
  const texts = [];
  for (const part of parts) {
    if (typeof part.text === "string" && part.text.length > 0)
      texts.push(part.text);
  }
  return texts.join("\n\n");
}
function googleToCore(body) {
  const msgs = [];
  const clusters = new ClusterCounter();
  const unmatchedCalls = /* @__PURE__ */ new Map();
  const contents = Array.isArray(body.contents) ? body.contents : [];
  for (const content of contents) {
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const isModel = content.role === "model";
    for (const part of parts) {
      const fr = part.functionResponse;
      if (!fr || typeof fr.name !== "string") continue;
      const text = jsonText(fr.response ?? {});
      const wireId = typeof fr.id === "string" ? fr.id : void 0;
      const queue = unmatchedCalls.get(fr.name);
      let paired;
      if (wireId) {
        const i = queue ? queue.indexOf(wireId) : -1;
        if (queue && i >= 0) queue.splice(i, 1);
      } else if (queue && queue.length > 0) {
        paired = queue.shift();
      }
      const base = deriveMessageId("tool", "tool-result", text, {
        toolCallId: wireId ?? paired ?? "",
        toolName: fr.name
      });
      const id = clusters.next(base);
      msgs.push({
        id,
        role: "tool",
        contentType: "tool-result",
        toolName: fr.name,
        // No wire id and nothing to pair with: the core's own id
        // stands in, so the response is still identifiable and stable.
        toolCallId: wireId ?? paired ?? id,
        text,
        rawGoogleParts: [part]
      });
    }
    for (const part of parts) {
      if (part.thought !== true || typeof part.text !== "string") continue;
      const base = deriveMessageId("assistant", "reasoning", part.text);
      msgs.push({
        id: clusters.next(base),
        role: "assistant",
        contentType: "reasoning",
        text: part.text,
        rawGoogleParts: [part],
        ...signatureField("googleThoughtSignature", part.thoughtSignature)
      });
    }
    const rest = parts.filter(isContentPart);
    if (rest.length > 0) {
      const text = textPartsOf(rest).map((p) => p.text ?? "").join("\n");
      const inline = inlineDataOf(rest);
      const base = deriveMessageId(
        isModel ? "assistant" : "user",
        "text",
        text
      );
      msgs.push({
        id: clusters.next(base),
        role: isModel ? "assistant" : "user",
        contentType: "text",
        text,
        ...inline ? { imageMediaType: inline.mimeType, imageBase64: inline.data } : {},
        rawGoogleParts: rest,
        ...signatureField(
          "googleThoughtSignature",
          textPartsOf(rest).find((p) => typeof p.thoughtSignature === "string")?.thoughtSignature
        )
      });
    }
    for (const part of parts) {
      const fc = part.functionCall;
      if (!fc || typeof fc.name !== "string") continue;
      const text = jsonText(fc.args ?? {});
      const wireId = typeof fc.id === "string" ? fc.id : void 0;
      const base = deriveMessageId("assistant", "tool-call", text, {
        toolCallId: wireId ?? "",
        toolName: fc.name
      });
      const id = clusters.next(base);
      const toolCallId = wireId ?? id;
      const queue = unmatchedCalls.get(fc.name);
      if (queue) queue.push(toolCallId);
      else unmatchedCalls.set(fc.name, [toolCallId]);
      msgs.push({
        id,
        role: "assistant",
        contentType: "tool-call",
        toolName: fc.name,
        toolCallId,
        text,
        rawGoogleParts: [part],
        ...signatureField("googleThoughtSignature", part.thoughtSignature)
      });
    }
  }
  return { msgs, systemText: googleSystemText(body) };
}
function coreToGoogle(messages) {
  const out = [];
  let model = null;
  let user = null;
  const flushModel = () => {
    if (!model) return;
    const parts = [...model.reasoning, ...model.text, ...model.calls];
    model = null;
    if (parts.length > 0) out.push({ role: "model", parts });
  };
  const flushUser = () => {
    if (!user) return;
    const parts = [...user.responses, ...user.content];
    user = null;
    if (parts.length > 0) out.push({ role: "user", parts });
  };
  for (const m of messages) {
    if (m.role === "assistant") {
      flushUser();
      if (!model) model = { reasoning: [], text: [], calls: [] };
      if (m.contentType === "reasoning") model.reasoning.push(reasoningPart(m));
      else if (m.contentType === "tool-call") model.calls.push(toolCallPart(m));
      else model.text.push(...contentParts(m));
    } else {
      flushModel();
      if (!user) user = { responses: [], content: [] };
      if (m.role === "tool" || m.contentType === "tool-result")
        user.responses.push(...toolResultParts(m));
      else user.content.push(...contentParts(m));
    }
  }
  flushModel();
  flushUser();
  return out;
}
function injectGoogleSystem(contents, parts) {
  if (parts.length === 0) return contents;
  const extra = parts.join("\n\n");
  const head = contents[0];
  if (head && head.role === "user")
    return [
      { ...head, parts: [{ text: extra }, ...head.parts] },
      ...contents.slice(1)
    ];
  return [{ role: "user", parts: [{ text: extra }] }, ...contents];
}
function conversationSignalGoogle(body, headerValue) {
  if (headerValue && headerValue.trim()) return headerValue.trim();
  const contents = Array.isArray(body.contents) ? body.contents : [];
  const firstUser = contents.find((c) => c.role !== "model");
  const parts = firstUser && Array.isArray(firstUser.parts) ? firstUser.parts : [];
  const seed = firstUser ? parts.map((p) => typeof p.text === "string" ? p.text : "").join("\n") : "default";
  return hashId(seed);
}
function reasoningPart(m) {
  const text = m.text ?? "";
  const head = rawParts(m)[0];
  if (head) return { ...head, text, thought: true };
  return {
    text,
    thought: true,
    ...signatureField("thoughtSignature", m.googleThoughtSignature)
  };
}
function toolCallPart(m) {
  const head = rawParts(m)[0];
  if (head && head.functionCall) return head;
  return {
    functionCall: {
      name: m.toolName ?? "unknown",
      args: jsonValue(m.text),
      ...m.toolCallId ? { id: m.toolCallId } : {}
    },
    ...signatureField("thoughtSignature", m.googleThoughtSignature)
  };
}
function toolResultParts(m) {
  const raw = rawParts(m);
  if (raw.length > 0 && raw.every((p) => p.functionResponse)) return raw;
  return [
    {
      functionResponse: {
        name: m.toolName ?? "unknown",
        response: jsonValue(m.text),
        ...m.toolCallId ? { id: m.toolCallId } : {}
      }
    }
  ];
}
function contentParts(m) {
  const text = m.text ?? "";
  const raw = rawParts(m);
  if (raw.length === 0) {
    const parts2 = text ? [
      {
        text,
        ...signatureField("thoughtSignature", m.googleThoughtSignature)
      }
    ] : [];
    if (m.imageBase64 && m.imageMediaType)
      parts2.push({
        inlineData: { mimeType: m.imageMediaType, data: m.imageBase64 }
      });
    return parts2;
  }
  const rawTexts = textPartsOf(raw);
  if (rawTexts.map((p) => p.text ?? "").join("\n") === text) return raw;
  const parts = text ? [
    {
      text,
      ...signatureField("thoughtSignature", m.googleThoughtSignature)
    }
  ] : [];
  for (const part of raw) {
    if (!rawTexts.includes(part)) parts.push(part);
  }
  return parts;
}
function rawParts(m) {
  const raw = m.rawGoogleParts;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === "object" && item !== null) out.push(item);
  }
  return out;
}
function textPartsOf(parts) {
  return parts.filter((p) => typeof p.text === "string" && p.thought !== true);
}
function isContentPart(part) {
  if (part.functionCall !== void 0 || part.functionResponse !== void 0)
    return false;
  if (part.thought === true && typeof part.text === "string") return false;
  return true;
}
function inlineDataOf(parts) {
  for (const part of parts) {
    const data = part.inlineData;
    if (data && typeof data.mimeType === "string" && typeof data.data === "string")
      return data;
  }
  return void 0;
}
function signatureField(key, signature) {
  return typeof signature === "string" ? { [key]: signature } : {};
}
function jsonText(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
function jsonValue(text) {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value === null ? {} : value;
  } catch {
    return { output: text };
  }
}

// src/wire/formats.ts
var WIRE_FORMATS = [
  "anthropic",
  "openai",
  "responses",
  "google"
];
function isWireFormat(value) {
  return typeof value === "string" && WIRE_FORMATS.includes(value);
}
function detectWireFormat(payload) {
  if (payload === null || typeof payload !== "object") return void 0;
  const p = payload;
  if (Array.isArray(p.contents)) return "google";
  if (Array.isArray(p.input)) return "responses";
  const messages = p.messages;
  if (!Array.isArray(messages)) return void 0;
  if ("system" in p || "anthropic_version" in p) return "anthropic";
  for (const m of messages) {
    if (m === null || typeof m !== "object") continue;
    const c = m.content;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b && typeof b === "object" && typeof b.type === "string") {
          if (b.type === "tool_use" || b.type === "tool_result" || b.type === "thinking")
            return "anthropic";
          if (b.type === "text" && "cache_control" in b) return "anthropic";
        }
      }
    }
    if (Array.isArray(m.tool_calls)) return "openai";
    if (m.role === "tool" && typeof m.tool_call_id === "string")
      return "openai";
    if (m.role === "system" || m.role === "developer") return "openai";
  }
  return "openai";
}

// src/wire/mirror.ts
function textBlocks(blocks) {
  const out = [];
  for (const b of blocks ?? []) if (b.type === "text") out.push(b.text);
  return out;
}
function joinText(blocks) {
  return textBlocks(blocks).join("\n");
}
function thinkingText(blocks) {
  return blocks?.filter((b) => b.type === "thinking" && b.thinking.trim().length > 0).map((b) => b.thinking).join("\n") ?? "";
}
function mirrorOpenaiMessages(view, systemText) {
  const messages = [
    { role: "system", content: systemText }
  ];
  for (const message of view) {
    if (message.role === "user") {
      const text = joinText(message.blocks);
      if (text) messages.push({ role: "user", content: text });
    } else if (message.role === "assistant") {
      const calls = (message.blocks ?? []).filter(
        (b) => b.type === "toolCall"
      );
      const reasoning = thinkingText(message.blocks);
      const text = joinText(message.blocks);
      if (calls.length > 0) {
        messages.push({
          role: "assistant",
          content: text,
          ...reasoning ? { reasoning_content: reasoning } : {},
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: {
              name: c.name ?? "",
              arguments: JSON.stringify(c.arguments ?? {})
            }
          }))
        });
      } else if (text || reasoning) {
        messages.push({
          role: "assistant",
          content: text,
          ...reasoning ? { reasoning_content: reasoning } : {}
        });
      }
    } else if (message.role === "toolResult") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        content: joinText(message.blocks)
      });
    } else {
      const text = message.text ?? "";
      if (text) messages.push({ role: "developer", content: text });
    }
  }
  return messages;
}
function mirrorAnthropicMessages(view) {
  const messages = [];
  for (const message of view) {
    if (message.role === "user") {
      const text = joinText(message.blocks);
      if (text)
        messages.push({ role: "user", content: [{ type: "text", text }] });
    } else if (message.role === "assistant") {
      const content = [];
      for (const b of message.blocks ?? []) {
        if (b.type === "thinking" && b.thinking.trim().length > 0) {
          content.push({
            type: "thinking",
            thinking: b.thinking,
            ...typeof b.signature === "string" && b.signature ? { signature: b.signature } : {}
          });
        } else if (b.type === "text" && b.text.trim().length > 0) {
          content.push({ type: "text", text: b.text });
        } else if (b.type === "toolCall") {
          let input = {};
          try {
            input = b.arguments && typeof b.arguments === "object" ? b.arguments : JSON.parse(JSON.stringify(b.arguments ?? {}));
          } catch {
            input = {};
          }
          content.push({
            type: "tool_use",
            id: b.id,
            name: b.name ?? "",
            input
          });
        }
      }
      if (content.length > 0) messages.push({ role: "assistant", content });
    } else if (message.role === "toolResult") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId ?? "",
            content: joinText(message.blocks)
          }
        ]
      });
    } else {
      const text = message.text ?? "";
      if (text)
        messages.push({ role: "user", content: [{ type: "text", text }] });
    }
  }
  return messages;
}
function mirrorResponsesInput(view) {
  const input = [];
  for (const message of view) {
    if (message.role === "user") {
      const text = joinText(message.blocks);
      if (text)
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }]
        });
    } else if (message.role === "assistant") {
      for (const b of message.blocks ?? []) {
        if (b.type === "thinking" && b.thinking.trim().length > 0) {
          input.push({
            type: "reasoning",
            summary: [{ type: "summary_text", text: b.thinking }]
          });
        } else if (b.type === "text" && b.text.trim().length > 0) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: b.text }]
          });
        } else if (b.type === "toolCall") {
          let args = "{}";
          try {
            args = JSON.stringify(b.arguments ?? {});
          } catch {
            args = "{}";
          }
          input.push({
            type: "function_call",
            call_id: b.id ?? "",
            name: b.name ?? "",
            arguments: args
          });
        }
      }
    } else if (message.role === "toolResult") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId ?? "",
        output: joinText(message.blocks)
      });
    } else {
      const text = message.text ?? "";
      if (text)
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }]
        });
    }
  }
  return input;
}
function mirrorOpenaiToCore(view, systemText) {
  const { msgs } = openaiToCore({
    model: "prime-fold",
    messages: mirrorOpenaiMessages(view, systemText)
  });
  return msgs;
}
function mirrorAnthropicToCore(view) {
  const { msgs } = anthropicToCore({
    model: "prime-fold",
    messages: mirrorAnthropicMessages(view)
  });
  return msgs;
}
function mirrorResponsesToCore(view, systemText) {
  const { msgs } = responsesToCore({
    model: "prime-fold",
    instructions: systemText,
    input: mirrorResponsesInput(view)
  });
  return msgs;
}

// src/wire/compress-detect.ts
import { createHash as createHash2 } from "crypto";
function compressToolArgs(call) {
  let args = call.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const a = args;
  if (call.name === "compress") {
    return Array.isArray(a.content) ? {
      content: a.content,
      topic: a.topic,
      summaryMaxChars: a.summaryMaxChars
    } : null;
  }
  if (call.name !== "write") return null;
  const path = typeof a.path === "string" ? a.path.split("?")[0].replace(/\/+$/, "") : "";
  if (path !== "xd://compress") return null;
  let inner = a.content;
  if (typeof inner === "string") {
    try {
      inner = JSON.parse(inner);
    } catch {
      return null;
    }
  }
  if (!inner || typeof inner !== "object") return null;
  if (Array.isArray(inner)) return { content: inner };
  const ia = inner;
  return Array.isArray(ia.content) ? {
    content: ia.content,
    topic: ia.topic,
    summaryMaxChars: ia.summaryMaxChars
  } : { content: [ia] };
}
function toolCallNames(msgs) {
  const names = /* @__PURE__ */ new Map();
  for (const m of msgs) {
    if (m.contentType === "tool-call" && m.toolCallId && m.toolName)
      names.set(m.toolCallId, m.toolName);
  }
  return names;
}
function toolResultTextsCore(msgs) {
  const results = /* @__PURE__ */ new Map();
  for (const m of msgs) {
    if (m.contentType !== "tool-result" || !m.toolCallId) continue;
    results.set(m.toolCallId, m.text ?? "");
  }
  return results;
}
function findCompressCallsCore(msg) {
  if (msg.contentType !== "tool-call" || !msg.toolName) return [];
  const args = compressToolArgs({ name: msg.toolName, arguments: msg.text });
  if (!args) return [];
  const content = args.content;
  if (!Array.isArray(content)) return [];
  const ranges = [];
  const callTopic = typeof args.topic === "string" ? args.topic : void 0;
  for (const item of content) {
    const r = item;
    if (typeof r.startId !== "string" || typeof r.endId !== "string" || typeof r.summary !== "string" || r.summary.length === 0)
      continue;
    ranges.push({
      startRef: r.startId,
      endRef: r.endId,
      summary: r.summary,
      topic: typeof r.topic === "string" ? r.topic : callTopic,
      summaryMaxChars: typeof args.summaryMaxChars === "number" ? args.summaryMaxChars : void 0,
      compressCallId: msg.toolCallId ?? ""
    });
  }
  return ranges.length > 0 ? [{ id: msg.toolCallId ?? "", ranges }] : [];
}
function corePieceKey(cm) {
  return `${cm.role}|${cm.contentType}|${cm.toolName ?? ""}|${(cm.text ?? "").slice(0, 4096)}`;
}
function spanFingerprintCore(coreMessages, startId, endId) {
  const find = (id) => coreMessages.find((cm) => cm.id === id);
  const first = find(startId);
  const last = find(endId);
  if (!first || !last) return "";
  return createHash2("sha1").update(`${corePieceKey(first)}\0${corePieceKey(last)}`).digest("hex").slice(0, 8);
}
function spanFingerprintCoreIdx(coreMessages, startIdx, endIdx) {
  const first = coreMessages[startIdx];
  const last = coreMessages[endIdx];
  if (!first || !last) return "";
  return createHash2("sha1").update(`${corePieceKey(first)}\0${corePieceKey(last)}`).digest("hex").slice(0, 8);
}
function boundaryRawCore(ref, byRef, blocks, coreMessages, pick) {
  const raw = byRef[ref];
  if (raw) return raw;
  const m = /^b(\d+)$/i.exec(ref.trim());
  if (!m) return "";
  const block = blocks.find((b) => b.blockId.toLowerCase() === `b${m[1]}`);
  if (!block) return "";
  const idx = (id) => coreMessages.findIndex((cm) => cm.id === (byRef[id] ?? id));
  let best = -1;
  for (const id of block.effectiveMessageIds) {
    const i = idx(id);
    if (i < 0) continue;
    if (best < 0 || (pick === "min" ? i < best : i > best)) best = i;
  }
  return best < 0 ? "" : coreMessages[best]?.id ?? "";
}
function boundaryIndexCore(ref, byRef, blocks, coreMessages, pick, fallbackIdx = -1) {
  const id = boundaryRawCore(ref, byRef, blocks, coreMessages, pick);
  if (id) {
    const i = coreMessages.findIndex((cm) => cm.id === id);
    if (i >= 0) return i;
  }
  return fallbackIdx >= 0 && fallbackIdx < coreMessages.length ? fallbackIdx : -1;
}
function refOfPieceCore(coreMessages, idx, byRef) {
  const id = coreMessages[idx]?.id;
  if (!id) return "";
  for (const [ref, mapped] of Object.entries(byRef))
    if (mapped === id) return ref;
  return "";
}
function staleRangeCore(r, rangeIndex, resultText, coreMessages, callIndex, byRef, blocks) {
  const pm = resultText.match(/\[pos=([0-9,-]+)\]/);
  const pair = pm ? pm[1].split(",")[rangeIndex] ?? "-" : "-";
  const hinted = pair !== "-";
  const [ps, pe] = pair === "-" ? ["", ""] : pair.split("-");
  const fbStart = ps && ps !== "" ? Number.parseInt(ps, 10) : -1;
  const fbEnd = pe && pe !== "" ? Number.parseInt(pe, 10) : -1;
  const startRaw = boundaryRawCore(
    r.startRef,
    byRef,
    blocks,
    coreMessages,
    "min"
  );
  const endRaw = boundaryRawCore(r.endRef, byRef, blocks, coreMessages, "max");
  const rawStartIdx = startRaw ? coreMessages.findIndex((cm) => cm.id === startRaw) : -1;
  const rawEndIdx = endRaw ? coreMessages.findIndex((cm) => cm.id === endRaw) : -1;
  const startIdx = rawStartIdx >= 0 ? rawStartIdx : fbStart >= 0 && fbStart < coreMessages.length ? fbStart : -1;
  const endIdx = rawEndIdx >= 0 ? rawEndIdx : fbEnd >= 0 && fbEnd < coreMessages.length ? fbEnd : -1;
  if (startIdx < 0 || endIdx < 0) {
    if (!/^b\d+$/i.test(r.startRef.trim()) && !/^b\d+$/i.test(r.endRef.trim()))
      return {
        reject: `unresolved ${r.startRef}..${r.endRef} -> ${startIdx}..${endIdx}`,
        ...hinted ? { hint: true } : {}
      };
    return {};
  }
  if (endIdx > callIndex)
    return {
      reject: `end idx ${endIdx} > callIndex ${callIndex}`,
      ...hinted ? { hint: true } : {}
    };
  const m = resultText.match(/\[fp=([0-9a-f,-]+)\]/);
  if (m) {
    const want = m[1].split(",")[rangeIndex];
    if (want !== void 0 && want !== "-") {
      const got = spanFingerprintCoreIdx(coreMessages, startIdx, endIdx);
      if (want !== got)
        return {
          reject: `fp ${r.startRef}..${r.endRef} want ${want} got ${got} @${startIdx}..${endIdx}`,
          ...hinted ? { hint: true } : {}
        };
    }
  }
  const remap = {};
  if (/^m\d+$/i.test(r.startRef.trim()) && rawStartIdx < 0) {
    const ref = refOfPieceCore(coreMessages, startIdx, byRef);
    if (!ref)
      return {
        reject: `recovered ${r.startRef} @${startIdx} has no ref (protected piece)`,
        ...hinted ? { hint: true } : {}
      };
    remap.startRef = ref;
  }
  if (/^m\d+$/i.test(r.endRef.trim()) && rawEndIdx < 0) {
    const ref = refOfPieceCore(coreMessages, endIdx, byRef);
    if (!ref)
      return {
        reject: `recovered ${r.endRef} @${endIdx} has no ref (protected piece)`,
        ...hinted ? { hint: true } : {}
      };
    remap.endRef = ref;
  }
  if (!remap.startRef && !remap.endRef) return {};
  return { remap, recovered: { pos: pair, startIdx, endIdx } };
}
function rangeFingerprintsCore(ranges, coreMessages, byRef, blocks) {
  return ranges.map((r) => {
    const start = boundaryRawCore(
      r.startRef,
      byRef,
      blocks,
      coreMessages,
      "min"
    );
    const end = start ? boundaryRawCore(r.endRef, byRef, blocks, coreMessages, "max") : "";
    if (start && end) {
      const fp = spanFingerprintCore(coreMessages, start, end);
      if (fp.length > 0) return fp;
    }
    return "-";
  });
}
function rangePositionsCore(ranges, coreMessages, byRef, blocks) {
  return ranges.map((r) => {
    const s = boundaryIndexCore(r.startRef, byRef, blocks, coreMessages, "min");
    const e = s >= 0 ? boundaryIndexCore(r.endRef, byRef, blocks, coreMessages, "max") : -1;
    return s >= 0 && e >= 0 ? `${s}-${e}` : "-";
  });
}

// src/wire/strip-images.ts
var IMAGE_PLACEHOLDER = "[image]";
function isObj(v) {
  return typeof v === "object" && v !== null;
}
function isImagePart(protocol, part) {
  if (!isObj(part)) return false;
  if (protocol === "responses") return part.type === "input_image";
  if (protocol === "openai") return part.type === "image_url";
  if (protocol === "google")
    return isObj(part.inlineData) || isObj(part.fileData);
  return part.type === "image";
}
function placeholderContent(protocol) {
  if (protocol === "google") return [{ text: IMAGE_PLACEHOLDER }];
  const type = protocol === "responses" ? "input_text" : "text";
  return [{ type, text: IMAGE_PLACEHOLDER }];
}
function isGoogleNestedImage(part) {
  if (!isObj(part)) return false;
  const media = isObj(part.inlineData) ? part.inlineData : part.fileData;
  return isObj(media) && typeof media.mimeType === "string" && media.mimeType.startsWith("image/");
}
function stripNestedImages(protocol, part) {
  if (!isObj(part)) return { part, removed: 0 };
  if (protocol === "anthropic" && part.type === "tool_result" && Array.isArray(part.content)) {
    const inner = part.content;
    const kept = inner.filter((p) => !isImagePart(protocol, p));
    const removed = inner.length - kept.length;
    if (removed === 0) return { part, removed: 0 };
    return {
      part: {
        ...part,
        content: kept.length > 0 ? kept : placeholderContent(protocol)
      },
      removed
    };
  }
  if (protocol === "google" && isObj(part.functionResponse) && Array.isArray(part.functionResponse.parts)) {
    const fr = part.functionResponse;
    if (JSON.stringify(fr.response ?? null).includes('"$ref"'))
      return { part, removed: 0 };
    const inner = fr.parts;
    const kept = inner.filter((p) => !isGoogleNestedImage(p));
    const removed = inner.length - kept.length;
    if (removed === 0) return { part, removed: 0 };
    const { parts: _, ...rest } = fr;
    return {
      part: {
        ...part,
        functionResponse: kept.length > 0 ? { ...fr, parts: kept } : rest
      },
      removed
    };
  }
  return { part, removed: 0 };
}
function stripParts(protocol, parts) {
  let removed = 0;
  const kept = [];
  for (const p of parts) {
    if (isImagePart(protocol, p)) {
      removed++;
      continue;
    }
    const nested = stripNestedImages(protocol, p);
    removed += nested.removed;
    kept.push(nested.part);
  }
  if (removed === 0) return null;
  return {
    parts: kept.length > 0 ? kept : placeholderContent(protocol),
    removed
  };
}
function stripHistoricalImages(body, protocol, keepRecent) {
  if (!protocol || !isObj(body)) return { body, removed: 0 };
  const recentCount = Math.max(0, Math.floor(keepRecent));
  if (protocol === "responses") {
    const input = body.input;
    if (!Array.isArray(input)) return { body, removed: 0 };
    const cutoff2 = input.length - recentCount;
    let removed2 = 0;
    let touched2 = false;
    const nextInput = input.map((item, i) => {
      if (i >= cutoff2 || !isObj(item)) return item;
      const key = item.type === "function_call_output" || item.type === "custom_tool_call_output" ? "output" : "content";
      if (!Array.isArray(item[key])) return item;
      const r = stripParts("responses", item[key]);
      if (!r) return item;
      removed2 += r.removed;
      touched2 = true;
      return { ...item, [key]: r.parts };
    });
    if (!touched2) return { body, removed: 0 };
    return { body: { ...body, input: nextInput }, removed: removed2 };
  }
  if (protocol === "google") {
    const contents = body.contents;
    if (!Array.isArray(contents)) return { body, removed: 0 };
    const cutoff2 = contents.length - recentCount;
    let removed2 = 0;
    let touched2 = false;
    const nextContents = contents.map((c, i) => {
      if (i < cutoff2 && isObj(c) && Array.isArray(c.parts)) {
        const r = stripParts("google", c.parts);
        if (r) {
          removed2 += r.removed;
          touched2 = true;
          return { ...c, parts: r.parts };
        }
      }
      return c;
    });
    if (!touched2) return { body, removed: 0 };
    return { body: { ...body, contents: nextContents }, removed: removed2 };
  }
  const messages = body.messages;
  if (!Array.isArray(messages)) return { body, removed: 0 };
  const cutoff = messages.length - recentCount;
  let removed = 0;
  let touched = false;
  const nextMessages = messages.map((m, i) => {
    if (i < cutoff && isObj(m) && Array.isArray(m.content)) {
      const r = stripParts(protocol, m.content);
      if (r) {
        removed += r.removed;
        touched = true;
        return { ...m, content: r.parts };
      }
    }
    return m;
  });
  if (!touched) return { body, removed: 0 };
  return { body: { ...body, messages: nextMessages }, removed };
}
export {
  ClusterCounter,
  WIRE_FORMATS,
  anthropicToCore,
  boundaryIndexCore,
  boundaryRawCore,
  buildSystem,
  compressToolArgs,
  conversationIdentityResponses,
  conversationSignalAnthropic,
  conversationSignalGoogle,
  conversationSignalOpenai,
  conversationSignalResponses,
  corePieceKey,
  coreToAnthropic,
  coreToGoogle,
  coreToOpenai,
  coreToResponses,
  createSubagentNamespaces,
  deriveMessageId,
  detectWireFormat,
  extractSystem,
  findCompressCallsCore,
  googleSystemText,
  googleToCore,
  hashId,
  injectGoogleSystem,
  injectOpenaiSystem,
  injectResponsesDeveloperMessage,
  isWireFormat,
  mirrorAnthropicMessages,
  mirrorAnthropicToCore,
  mirrorOpenaiMessages,
  mirrorOpenaiToCore,
  mirrorResponsesInput,
  mirrorResponsesToCore,
  openaiToCore,
  parseDataUrl,
  patchResponsesInput,
  rangeFingerprintsCore,
  rangePositionsCore,
  refOfPieceCore,
  responsesToCore,
  spanFingerprintCore,
  spanFingerprintCoreIdx,
  splitDemotedThinking,
  staleRangeCore,
  stripHistoricalImages,
  subagentNamespace,
  toCoreMessages,
  toolCallNames,
  toolResultTextsCore
};
//# sourceMappingURL=index.js.map