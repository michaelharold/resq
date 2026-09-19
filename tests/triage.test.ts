import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  isTriageOutput,
  normalizeTriageOutput,
  applyUrgencyFloor,
  triage,
  triageSchema,
  buildSystemPrompt,
} from "../lib/triage";
import { NEED_TYPES, SKILLS, TYPE_SKILLS } from "../lib/taxonomy";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type FakeHandler = (
  body: Record<string, unknown>,
  res: http.ServerResponse,
) => void | Promise<void>;

/** Starts a fake Ollama on an ephemeral port; `handler` gets the parsed POST body. */
function startFake(handler: FakeHandler): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          body = {};
        }
        void handler(body, res);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const GOOD_OUTPUT = {
  type: "cardiac_no_breathing",
  urgency: "critical",
  skills: ["doctor"],
  summary: "x",
  confidence: 0.9,
};

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// ---------------------------------------------------------------------------
// guard + normalisation
// ---------------------------------------------------------------------------

test("isTriageOutput accepts a valid object", () => {
  assert.equal(isTriageOutput(GOOD_OUTPUT), true);
  assert.equal(isTriageOutput({ type: "bleeding", urgency: "medium" }), true);
});

test("isTriageOutput rejects bad enums and missing fields", () => {
  assert.equal(isTriageOutput({ type: "zombie", urgency: "critical" }), false);
  assert.equal(isTriageOutput({ type: "bleeding", urgency: "extreme" }), false);
  assert.equal(isTriageOutput({ urgency: "critical" }), false);
  assert.equal(isTriageOutput({ type: "bleeding" }), false);
  assert.equal(isTriageOutput(null), false);
  assert.equal(isTriageOutput("bleeding"), false);
  assert.equal(isTriageOutput([]), false);
  assert.equal(isTriageOutput({ type: 3, urgency: "high" }), false);
});

test("normalizeTriageOutput clamps confidence", () => {
  const base = { type: "bleeding", urgency: "high" } as const;
  assert.equal(normalizeTriageOutput({ ...base, confidence: 7 } as never, "t").confidence, 1);
  assert.equal(normalizeTriageOutput({ ...base, confidence: -2 } as never, "t").confidence, 0);
  assert.equal(normalizeTriageOutput({ ...base, confidence: 0.42 } as never, "t").confidence, 0.42);
  assert.equal(normalizeTriageOutput({ ...base } as never, "t").confidence, 0.5);
  assert.equal(normalizeTriageOutput({ ...base, confidence: NaN } as never, "t").confidence, 0.5);
  assert.equal(normalizeTriageOutput({ ...base, confidence: "0.9" } as never, "t").confidence, 0.5);
});

test("normalizeTriageOutput dedupes and filters skills, falls back to TYPE_SKILLS", () => {
  const base = { type: "flood_rescue", urgency: "critical" } as const;
  const out = normalizeTriageOutput(
    { ...base, skills: ["swimmer", "wizard", "swimmer", 42, "doctor"] } as never,
    "t",
  );
  assert.deepEqual(out.skills, ["swimmer", "doctor"]);
  assert.deepEqual(normalizeTriageOutput({ ...base, skills: [] } as never, "t").skills, TYPE_SKILLS.flood_rescue);
  assert.deepEqual(normalizeTriageOutput({ ...base, skills: "swimmer" } as never, "t").skills, TYPE_SKILLS.flood_rescue);
  assert.deepEqual(normalizeTriageOutput({ ...base, skills: ["nope"] } as never, "t").skills, TYPE_SKILLS.flood_rescue);
});

test("normalizeTriageOutput truncates summary / falls back to input text", () => {
  const base = { type: "fire", urgency: "high" } as const;
  const long = "a".repeat(300);
  assert.equal(normalizeTriageOutput({ ...base, summary: long } as never, "t").summary.length, 140);
  const text = "b".repeat(250);
  assert.equal(normalizeTriageOutput({ ...base } as never, text).summary, "b".repeat(100));
  assert.equal(normalizeTriageOutput({ ...base, summary: 12 } as never, "short text").summary, "short text");
});

test("triageSchema is built from the taxonomy", () => {
  const schema = triageSchema() as {
    required: string[];
    properties: { type: { enum: string[] }; urgency: { enum: string[] }; skills: { items: { enum: string[] } } };
  };
  assert.deepEqual([...schema.required].sort(), ["confidence", "skills", "summary", "type", "urgency"]);
  assert.deepEqual(schema.properties.type.enum, [...NEED_TYPES]);
  assert.deepEqual(schema.properties.skills.items.enum, [...SKILLS]);
  assert.deepEqual(schema.properties.urgency.enum, ["critical", "high", "medium", "low"]);
});

test("buildSystemPrompt lists every type and skill", () => {
  const p = buildSystemPrompt();
  for (const t of NEED_TYPES) assert.ok(p.includes(t), `prompt lacks ${t}`);
  for (const s of SKILLS) assert.ok(p.includes(s), `prompt lacks ${s}`);
  assert.ok(/JSON only/i.test(p));
  assert.ok(p.includes("evacuation_mobility when"));
});

// ---------------------------------------------------------------------------
// urgency floor
// ---------------------------------------------------------------------------

test("applyUrgencyFloor lifts cardiac to critical and leaves bleeding/medium alone", () => {
  assert.equal(applyUrgencyFloor("cardiac_no_breathing", "high"), "critical");
  assert.equal(applyUrgencyFloor("cardiac_no_breathing", "low"), "critical");
  assert.equal(applyUrgencyFloor("bleeding", "medium"), "medium");
  assert.equal(applyUrgencyFloor("fire", "low"), "high");
  assert.equal(applyUrgencyFloor("fire", "critical"), "critical");
  assert.equal(applyUrgencyFloor("flood_rescue", "medium"), "high");
  assert.equal(applyUrgencyFloor("other", "low"), "low");
});

// ---------------------------------------------------------------------------
// triage() end to end against fakes (never the real Ollama)
// ---------------------------------------------------------------------------

test("triage() falls back to rules when the port is closed, quickly", async () => {
  await withEnv({ OLLAMA_URL: "http://127.0.0.1:9", OLLAMA_TIMEOUT_MS: "4000" }, async () => {
    const t0 = Date.now();
    const r = await triage("father collapsed not breathing");
    const ms = Date.now() - t0;
    assert.equal(r.source, "rules");
    assert.ok(ms < 1000, `took ${ms} ms`);
  });
});

test("triage() returns source ollama for a valid fake response", async () => {
  const seen: Record<string, unknown>[] = [];
  const { server, url } = await startFake((body, res) => {
    seen.push(body);
    sendJson(res, 200, { response: JSON.stringify(GOOD_OUTPUT) });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000", OLLAMA_MODEL: "fake-model" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "ollama");
      assert.equal(r.type, "cardiac_no_breathing");
      assert.equal(r.urgency, "critical");
      assert.deepEqual(r.skills, ["doctor"]);
      assert.equal(r.summary, "x");
      assert.equal(r.confidence, 0.9);
      assert.equal(r.clarifyingQuestion, null);
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, "fake-model");
    assert.equal(seen[0].stream, false);
    assert.equal(seen[0].keep_alive, "30m");
    assert.equal(typeof seen[0].format, "object");
    assert.deepEqual(seen[0].options, { temperature: 0, num_predict: 200 });
  } finally {
    await closeServer(server);
  }
});

test("triage() applies the urgency floor to Ollama results", async () => {
  const { server, url } = await startFake((_body, res) => {
    sendJson(res, 200, { response: JSON.stringify({ ...GOOD_OUTPUT, urgency: "high" }) });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "ollama");
      assert.equal(r.urgency, "critical");
    });
  } finally {
    await closeServer(server);
  }
});

test("triage() falls back to rules when the fake returns garbage", async () => {
  const { server, url } = await startFake((_body, res) => {
    sendJson(res, 200, { response: "this is not json {" });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "rules");
    });
  } finally {
    await closeServer(server);
  }
});

test("triage() falls back to rules when the guard fails", async () => {
  const { server, url } = await startFake((_body, res) => {
    sendJson(res, 200, { response: JSON.stringify({ type: "nonsense", urgency: "critical" }) });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "rules");
    });
  } finally {
    await closeServer(server);
  }
});

test("triage() times out at OLLAMA_TIMEOUT_MS and falls back to rules", async () => {
  const pending: http.ServerResponse[] = [];
  const { server, url } = await startFake((_body, res) => {
    pending.push(res);
    setTimeout(() => {
      if (!res.writableEnded) sendJson(res, 200, { response: JSON.stringify(GOOD_OUTPUT) });
    }, 2000).unref();
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "300" }, async () => {
      const t0 = Date.now();
      const r = await triage("father collapsed not breathing");
      const ms = Date.now() - t0;
      assert.equal(r.source, "rules");
      assert.ok(ms >= 250 && ms < 700, `took ${ms} ms`);
    });
  } finally {
    for (const res of pending) if (!res.writableEnded) res.destroy();
    await closeServer(server);
  }
});

test("triage() falls back to rules when Ollama confidence < 0.5", async () => {
  const { server, url } = await startFake((_body, res) => {
    sendJson(res, 200, { response: JSON.stringify({ ...GOOD_OUTPUT, confidence: 0.2 }) });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "rules");
    });
  } finally {
    await closeServer(server);
  }
});

test("triage() retries with format json when the schema format gets HTTP 400", async () => {
  const formats: unknown[] = [];
  const { server, url } = await startFake((body, res) => {
    formats.push(body.format);
    if (typeof body.format === "object") {
      sendJson(res, 400, { error: "format must be json" });
      return;
    }
    if (body.format === "json") {
      sendJson(res, 200, { response: JSON.stringify(GOOD_OUTPUT) });
      return;
    }
    sendJson(res, 500, { error: "unexpected" });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "ollama");
      assert.equal(r.type, "cardiac_no_breathing");
    });
    assert.equal(formats.length, 2);
    assert.equal(typeof formats[0], "object");
    assert.equal(formats[1], "json");
  } finally {
    await closeServer(server);
  }
});

test("triage() falls back to rules on a non-400 HTTP error", async () => {
  const { server, url } = await startFake((_body, res) => {
    sendJson(res, 500, { error: "boom" });
  });
  try {
    await withEnv({ OLLAMA_URL: url, OLLAMA_TIMEOUT_MS: "4000" }, async () => {
      const r = await triage("father collapsed not breathing");
      assert.equal(r.source, "rules");
    });
  } finally {
    await closeServer(server);
  }
});
