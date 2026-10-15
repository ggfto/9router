import { describe, expect, it } from "vitest";

import { pipeWithDisconnect, createStreamController } from "../../open-sse/utils/streamHandler.js";
import { SSE_KEEPALIVE_MS } from "../../open-sse/config/runtimeConfig.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

async function readAll(stream) {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("SSE_KEEPALIVE_MS default", () => {
  it("é 0 (desligado) por padrão", () => {
    expect(SSE_KEEPALIVE_MS).toBe(0);
  });
});

describe("pipeWithDisconnect keepalive adaptado", () => {
  it("emite ': keepalive' durante silêncio do upstream (gap > N)", async () => {
    const upstream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("data: hello\n\n"));
        // Gap maior que o keepalive: 200ms > 50ms → deve emitir keepalives
        await new Promise((r) => setTimeout(r, 200));
        controller.enqueue(encoder.encode("data: world\n\n"));
        controller.close();
      },
    });

    const out = pipeWithDisconnect(
      { body: upstream },
      new TransformStream(),
      makeController(),
      null,
      360 * 1000,
      50
    );

    const text = await readAll(out);
    expect(text).toContain("data: hello");
    expect(text).toContain("data: world");
    // Keepalive adaptado: comentário SSE, não `event: ping`
    expect(text).toContain(": keepalive");
    expect(text).not.toContain("event: ping");
  }, 10000);

  it("com 0 não muda nada (desligado)", async () => {
    const upstream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("data: hello\n\n"));
        await new Promise((r) => setTimeout(r, 150));
        controller.enqueue(encoder.encode("data: world\n\n"));
        controller.close();
      },
    });

    const out = pipeWithDisconnect(
      { body: upstream },
      new TransformStream(),
      makeController(),
      null,
      360 * 1000,
      0
    );

    const text = await readAll(out);
    expect(text).toContain("data: hello");
    expect(text).toContain("data: world");
    expect(text).not.toContain(": keepalive");
    expect(text).not.toContain("event: ping");
  }, 10000);

  it("não duplica se o upstream já mandou comentário", async () => {
    const upstream = new ReadableStream({
      async start(controller) {
        // Upstream rápido com comentário próprio: fecha antes do intervalo
        controller.enqueue(encoder.encode(": upstream-comment\n\n"));
        controller.enqueue(encoder.encode("data: hello\n\n"));
        controller.close();
      },
    });

    const out = pipeWithDisconnect(
      { body: upstream },
      new TransformStream(),
      makeController(),
      null,
      360 * 1000,
      100
    );

    const text = await readAll(out);
    expect(text).toContain(": upstream-comment");
    expect(text).toContain("data: hello");
    // Fechou antes de ficar em silêncio → nenhum keepalive extra
    expect(text).not.toContain(": keepalive");
  }, 10000);

  it("para no fim/abort (não vaza timer)", async () => {
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: hi\n\n"));
        controller.close();
      },
    });

    const ctrl = makeController();
    const out = pipeWithDisconnect(
      { body: upstream },
      new TransformStream(),
      ctrl,
      null,
      360 * 1000,
      30
    );

    const text = await readAll(out);
    expect(text).toContain("data: hi");
    // Stream curto, sem silêncio: nenhum keepalive, e o timer foi limpo
    // (se vazasse, o teste ficaria pendurado pelo intervalo)
    expect(text).not.toContain(": keepalive");
  }, 10000);
});
