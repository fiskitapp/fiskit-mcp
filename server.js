// The FisKit MCP server: the tools, independent of the transport so they can be tested in memory.
import { Fiskit, FiskitError } from "@fiskit/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const VERSION = "0.1.0";

const INSTRUCTIONS = `FisKit issues Argentine electronic invoices (ARCA, formerly AFIP) and returns their CAE.
- Pick voucher_type by the issuer: a monotributista issues invoice_c to anyone; a registered VAT taxpayer issues invoice_a to another registered VAT taxpayer and invoice_b to everyone else. Credit notes (credit_note_a|b|c) cancel an invoice through associated_vouchers.
- amounts.total is the only required amount. For A and B, add amounts.vat_rate (for example "21") and FisKit computes net and VAT.
- Before invoicing a company, call lookup_taxpayer with its CUIT and use receiver_vat_condition_id as receiver.vat_condition_id.
- Always pass an idempotency_key tied to the sale or order: repeating a call with it never issues a second invoice.
- A pending status is not an error: FisKit finishes it in the background; check it later with get_invoice.
Full rules: https://fiskit.com.ar/llms.txt`;

const receiver = z
  .object({
    document_type: z.enum(["cuit", "cuil", "dni", "final_consumer"]).optional(),
    document_number: z.number().int().optional().describe("Digits only; 0 for an unidentified final consumer"),
    vat_condition_id: z.number().int().optional().describe("1 registered VAT, 4 exempt, 5 final consumer, 6 monotributo"),
    name: z.string().optional().describe("Only printed on the PDF"),
    address: z.string().optional().describe("Only printed on the PDF"),
    email: z.string().optional().describe("The PDF is emailed here once authorized"),
  })
  .describe("Who buys. Leave it out for an unidentified final consumer");

const invoiceInput = {
  voucher_type: z
    .enum(["invoice_a", "invoice_b", "invoice_c", "credit_note_a", "credit_note_b", "credit_note_c", "debit_note_a", "debit_note_b", "debit_note_c"])
    .describe("invoice_c if the issuer is monotributista; A or B if it is a registered VAT taxpayer"),
  amounts: z
    .object({
      total: z.number().positive(),
      vat_rate: z.enum(["0", "2.5", "5", "10.5", "21", "27"]).optional().describe("A and B vouchers: FisKit computes net and VAT"),
    })
    .passthrough()
    .describe("total is required; for several VAT rates send net, vat and vat_breakdown yourself"),
  receiver: receiver.optional(),
  concept: z.enum(["products", "services", "products_and_services"]).optional().describe("products by default"),
  service_period: z
    .object({ from: z.string(), to: z.string(), payment_due_date: z.string() })
    .optional()
    .describe("Required for services. Dates as YYYY-MM-DD"),
  point_of_sale: z.number().int().positive().optional().describe("The dashboard's default when left out"),
  associated_vouchers: z
    .array(z.object({ voucher_type: z.string(), point_of_sale: z.number().int(), number: z.number().int() }))
    .optional()
    .describe("For credit and debit notes: the invoice they modify"),
  items: z
    .array(z.object({ description: z.string(), quantity: z.number().optional(), unit_price: z.number() }))
    .optional()
    .describe("Lines printed on the PDF; ARCA does not receive them"),
  notes: z.string().optional().describe("Free text printed on the PDF"),
  idempotency_key: z
    .string()
    .min(1)
    .max(255)
    .describe("Unique per sale, for example order-8812. Repeating it returns the same invoice instead of a new one"),
};

/** Turns an API error into a tool result the model can read and act on, instead of a protocol error. */
function failure(error) {
  if (error instanceof FiskitError) {
    const detail = { status: error.status, code: error.code, message: error.message, param: error.param, request_id: error.requestId };
    const reasons = error.body?.error?.authority_errors;
    if (reasons?.length) detail.authority_errors = reasons;
    return { isError: true, content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
  }
  throw error;
}

function json(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * @param {{ apiKey?: string, readOnly?: boolean, fiskit?: Fiskit }} options
 *   readOnly hides the tools that issue or send anything.
 */
export function createServer({ apiKey = process.env.FISKIT_API_KEY, readOnly = false, fiskit } = {}) {
  const client = fiskit ?? new Fiskit(apiKey);
  const live = (apiKey ?? "").startsWith("sk_live_");
  const server = new McpServer({ name: "fiskit", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "lookup_taxpayer",
    {
      title: "Look up a CUIT",
      description: "Name, fiscal address and VAT condition of a CUIT from the ARCA registry, plus the receiver_vat_condition_id to use when invoicing it.",
      inputSchema: { cuit: z.number().int().describe("11 digits, without dashes") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ cuit }) => {
      try {
        return json(await client.taxpayers.retrieve(cuit));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get an invoice",
      description: "Looks up an invoice by id: its status (authorized, pending, rejected...), number and CAE.",
      inputSchema: { id: z.string().describe("The invoice id returned when it was issued") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        return json(await client.invoices.retrieve(id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_invoice_pdf",
    {
      title: "Get the invoice PDF",
      description: "The PDF of an authorized invoice, in ARCA's layout with its QR code.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        const pdf = await client.invoices.pdf(id);
        return {
          content: [
            {
              type: "resource",
              resource: { uri: `fiskit://invoices/${encodeURIComponent(id)}/pdf`, mimeType: "application/pdf", blob: Buffer.from(pdf).toString("base64") },
            },
          ],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (readOnly) return server;

  server.registerTool(
    "issue_invoice",
    {
      title: live ? "Issue a REAL invoice" : "Issue a test invoice",
      description: `${
        live
          ? "Issues a REAL invoice with fiscal validity before ARCA. It cannot be deleted, only cancelled with a credit note: confirm the details with the user first."
          : "Issues an invoice in ARCA's testing environment (no fiscal validity)."
      } Returns the invoice with its number and CAE, or status pending if ARCA is slow (check it later with get_invoice).`,
      inputSchema: invoiceInput,
      annotations: { destructiveHint: live, idempotentHint: true, openWorldHint: true },
    },
    async ({ idempotency_key, ...body }) => {
      try {
        return json(await client.invoices.create(body, { idempotencyKey: idempotency_key }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "email_invoice",
    {
      title: "Email an invoice",
      description: "Emails the invoice PDF to the customer. Without email it goes to the receiver.email given when it was issued.",
      inputSchema: { id: z.string(), email: z.string().optional() },
      annotations: { openWorldHint: true },
    },
    async ({ id, email }) => {
      try {
        return json(await client.invoices.email(id, email));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
