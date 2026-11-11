#!/usr/bin/env node
// Runs the FisKit MCP server over stdio, the transport desktop agents and editors use.
// Configuration: FISKIT_API_KEY (required) and FISKIT_READ_ONLY=true to hide the tools that issue or send.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

if (!process.env.FISKIT_API_KEY) {
  console.error("fiskit-mcp: set FISKIT_API_KEY (sk_test_... to try it without fiscal validity)");
  process.exit(1);
}

const server = createServer({ readOnly: process.env.FISKIT_READ_ONLY === "true" });
await server.connect(new StdioServerTransport());
