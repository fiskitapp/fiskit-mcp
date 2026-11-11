import assert from "node:assert/strict";
import { test } from "node:test";
import { Fiskit } from "@fiskit/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

const AUTHORIZED = {
  id: "inv_1",
  object: "invoice",
  status: "authorized",
  voucher_type: "invoice_c",
  point_of_sale: 1,
  number: 42,
  cae: "76451234567890",
  cae_due_date: "2026-11-20",
  authority_observations: [],
  authority_errors: [],
};

/** A connected MCP client whose API calls go to `handler` instead of the network. */
async function connect(handler, { apiKey = "sk_test_x", readOnly = false } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const { status = 200, body, binary } = handler(call);
    return binary ? new Response(binary, { status }) : Response.json(body, { status });
  };
  const fiskit = new Fiskit(apiKey, { baseUrl: "https://api.test", fetch, maxRetries: 0 });
  const server = createServer({ apiKey, readOnly, fiskit });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, calls };
}

test("lists every tool, and only the read ones in read-only mode", async () => {
  const { client } = await connect(() => ({ body: {} }));
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["email_invoice", "get_invoice", "get_invoice_pdf", "issue_invoice", "lookup_taxpayer"]);

  const readOnly = await connect(() => ({ body: {} }), { readOnly: true });
  const readNames = (await readOnly.client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(readNames, ["get_invoice", "get_invoice_pdf", "lookup_taxpayer"]);
});

test("issue_invoice sends the body and the idempotency key, and returns the invoice", async () => {
  const { client, calls } = await connect(() => ({ body: AUTHORIZED }));
  const result = await client.callTool({
    name: "issue_invoice",
    arguments: { voucher_type: "invoice_c", amounts: { total: 1500 }, idempotency_key: "order-8812" },
  });

  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).cae, "76451234567890");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.test/v1/invoices");
  assert.equal(calls[0].headers["Idempotency-Key"], "order-8812");
  assert.deepEqual(calls[0].body, { voucher_type: "invoice_c", amounts: { total: 1500 } });
});

test("issue_invoice needs an idempotency key", async () => {
  const { client, calls } = await connect(() => ({ body: AUTHORIZED }));
  const result = await client.callTool({ name: "issue_invoice", arguments: { voucher_type: "invoice_c", amounts: { total: 1500 } } });
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("with a live key the issue tool says it is real and is marked destructive", async () => {
  const { client } = await connect(() => ({ body: {} }), { apiKey: "sk_live_x" });
  const tool = (await client.listTools()).tools.find((t) => t.name === "issue_invoice");
  assert.match(tool.description, /REAL invoice/);
  assert.equal(tool.annotations.destructiveHint, true);
});

test("API errors come back as readable tool errors with ARCA's reasons", async () => {
  const { client } = await connect(() => ({
    status: 400,
    body: {
      error: {
        type: "invalid_request_error",
        code: "invoice_rejected",
        message: "ARCA rejected the invoice",
        request_id: "req_1",
        authority_errors: [{ code: 10016, message: "Invalid date" }],
      },
    },
  }));
  const result = await client.callTool({
    name: "issue_invoice",
    arguments: { voucher_type: "invoice_c", amounts: { total: 1500 }, idempotency_key: "k" },
  });

  assert.equal(result.isError, true);
  const detail = JSON.parse(result.content[0].text);
  assert.equal(detail.code, "invoice_rejected");
  assert.equal(detail.authority_errors[0].code, 10016);
});

test("lookup_taxpayer, get_invoice and get_invoice_pdf", async () => {
  const { client, calls } = await connect((call) => {
    if (call.url.endsWith("/pdf")) return { binary: new Uint8Array([37, 80, 68, 70]) };
    if (call.url.includes("/taxpayers/")) return { body: { cuit: 30712345671, name: "ACME SA", receiver_vat_condition_id: 1 } };
    return { body: AUTHORIZED };
  });

  const taxpayer = await client.callTool({ name: "lookup_taxpayer", arguments: { cuit: 30712345671 } });
  assert.equal(JSON.parse(taxpayer.content[0].text).name, "ACME SA");

  const invoice = await client.callTool({ name: "get_invoice", arguments: { id: "inv_1" } });
  assert.equal(JSON.parse(invoice.content[0].text).number, 42);

  const pdf = await client.callTool({ name: "get_invoice_pdf", arguments: { id: "inv_1" } });
  assert.equal(pdf.content[0].resource.mimeType, "application/pdf");
  assert.equal(Buffer.from(pdf.content[0].resource.blob, "base64").toString(), "%PDF");

  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://api.test/v1/taxpayers/30712345671", "https://api.test/v1/invoices/inv_1", "https://api.test/v1/invoices/inv_1/pdf"],
  );
});
