#!/usr/bin/env node
/**
 * Point d'entrée stdio du serveur MCP Tisséo.
 *
 * Usage local (Claude Desktop, Cursor, CLI MCP, etc.) :
 *   TISSEO_API_KEY=xxxx node src/stdio.js
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Le serveur tourne tant que le transport stdio reste ouvert.
  console.error("Serveur MCP Tisséo démarré (stdio).");
}

main().catch((error) => {
  console.error("Échec du démarrage du serveur MCP Tisséo :", error);
  process.exit(1);
});
