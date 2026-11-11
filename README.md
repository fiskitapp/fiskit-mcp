# FisKit MCP server

[Español más abajo](#español)

Lets AI agents (Claude, Cursor, VS Code Copilot, Windsurf and any [MCP](https://modelcontextprotocol.io) client) issue Argentine electronic invoices with ARCA (formerly AFIP) through [FisKit](https://fiskit.com.ar): "invoice $15,000 to CUIT 30-71234567-1 for the November service" becomes a real voucher with its CAE.

## Tools

| Tool | What it does |
|---|---|
| `lookup_taxpayer` | Name, address and VAT condition of a CUIT, from the ARCA registry |
| `issue_invoice` | Issues an invoice, credit note or debit note and returns its number and CAE |
| `get_invoice` | Status, number and CAE of an invoice |
| `get_invoice_pdf` | The PDF, in ARCA's layout with the QR code |
| `email_invoice` | Emails the PDF to the customer |

With an `sk_test_...` key everything goes to ARCA's testing environment (no fiscal validity): start there. With `sk_live_...` the agent issues **real invoices**; the tool says so and asks to confirm the details first. Set `FISKIT_READ_ONLY=true` to expose only the three lookup tools.

Every invoice needs an idempotency key, so an agent that retries never issues it twice.

## Setup

Create a key in the dashboard (API Keys). Node.js 18 or later.

**Claude Code**

```bash
claude mcp add fiskit --env FISKIT_API_KEY=sk_test_... -- npx -y @fiskit/mcp
```

**Claude Desktop, Cursor, Windsurf** (`claude_desktop_config.json`, `.cursor/mcp.json`...)

```json
{
  "mcpServers": {
    "fiskit": {
      "command": "npx",
      "args": ["-y", "@fiskit/mcp"],
      "env": { "FISKIT_API_KEY": "sk_test_..." }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "fiskit": {
      "command": "npx",
      "args": ["-y", "@fiskit/mcp"],
      "env": { "FISKIT_API_KEY": "sk_test_..." }
    }
  }
}
```

Keep the key out of shared repositories: a config file with a live key is a credential.

Writing code instead? The agent needs https://fiskit.com.ar/llms.txt, not this server. Full documentation: https://fiskit.com.ar/developers

---

## Español

Servidor MCP de [FisKit](https://fiskit.com.ar): les permite a los agentes de IA (Claude, Cursor, Copilot en VS Code, Windsurf y cualquier cliente MCP) emitir facturas electrónicas de ARCA (ex AFIP). Le pedís "facturale $15.000 al CUIT 30-71234567-1 por el servicio de noviembre" y lo emite con su CAE.

Herramientas: buscar un CUIT en el padrón, emitir facturas y notas de crédito o débito, consultar una factura, bajar el PDF y mandarlo por email.

**Configuración en Claude Code:**

```bash
claude mcp add fiskit --env FISKIT_API_KEY=sk_test_... -- npx -y @fiskit/mcp
```

En Claude Desktop, Cursor o VS Code, el bloque JSON de arriba con tu clave.

Con una clave `sk_test_...` todo va a la homologación de ARCA, sin validez fiscal: empezá por ahí. Con `sk_live_...` el agente emite **facturas reales**, y la herramienta le pide confirmar los datos antes. Con `FISKIT_READ_ONLY=true` solo puede consultar.

Documentación completa: https://fiskit.com.ar/developers
