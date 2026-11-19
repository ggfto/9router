// openai-compatible nodes: the upstream body must say `stream: true` whenever the
// handler decided to stream. chatCore streams a request that omits `stream`
// (`body.stream !== false`), but the same-format openai→openai path forwards the
// body as the client sent it. An upstream that defaults to non-stream (FreeLLMAPI)
// then answers a plain chat.completion JSON, which 9router pipes out as
// text/event-stream; the combo empty-peek reads only `data:` lines, sees no
// content and fails every member over ("returned empty (no-content)").
import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { peekStreamForContent } from "../../open-sse/services/emptyFailover.js";

const NODE = "openai-compatible-chat-77804ddb-b0dd-4fde-969d-7808ada07f26";
const creds = { apiKey: "test-key" };
const body = () => ({ model: "qwen/qwen3.8-27b", messages: [{ role: "user", content: "diga ok" }], max_tokens: 8 });

describe("openai-compatible upstream stream flag", () => {
  it("sets stream:true when the handler streams and the client omitted the field", () => {
    const out = new DefaultExecutor(NODE).transformRequest("qwen/qwen3.8-27b", body(), true, creds);
    expect(out.stream).toBe(true);
  });

  it("does not add stream when the handler is not streaming", () => {
    const out = new DefaultExecutor(NODE).transformRequest("qwen/qwen3.8-27b", body(), false, creds);
    expect(out.stream).toBeUndefined();
  });

  it("keeps an explicit client value", () => {
    const out = new DefaultExecutor(NODE).transformRequest("qwen/qwen3.8-27b", { ...body(), stream: false }, true, creds);
    expect(out.stream).toBe(false);
  });

  it("leaves non openai-compatible providers alone", () => {
    const out = new DefaultExecutor("groq").transformRequest("qwen/qwen3.8-27b", body(), true, creds);
    expect(out.stream).toBeUndefined();
  });

  // What the combo saw before the fix: FreeLLMAPI's non-stream answer (recorded 19/11,
  // ids shortened) relayed as SSE. It has content, but no `data:` frame carries it.
  it("documents why the peek judged the non-stream relay empty", async () => {
    const relayed =
      '{"id":"chatcmpl-bfe2b052","object":"chat.completion","model":"qwen/qwen3.8-27b",' +
      '"choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],' +
      '"usage":{"prompt_tokens":441,"completion_tokens":2,"total_tokens":443}}data: [DONE]\n\n';
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(relayed)); c.close(); },
    });
    const peeked = await peekStreamForContent(stream, { deadlineMs: 1000 });
    expect(peeked.outcome).toBe("empty");
  });
});
