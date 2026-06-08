/**
 * Endpoint HTTP streamable du serveur MCP Tisséo (fonction serverless Vercel).
 *
 * C'est l'URL à renseigner dans Poke :  https://<votre-projet>.vercel.app/api/mcp
 *
 * Fonctionnement sans état (stateless) : un serveur et un transport sont créés
 * pour chaque requête, ce qui correspond au modèle d'exécution serverless.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer } from "../src/server.js";

/**
 * Récupère la clé API Tisséo dans l'ordre de priorité :
 *   1. variable d'environnement TISSEO_API_KEY
 *   2. entête Authorization: Bearer <clé>
 *   3. paramètre de requête ?key=<clé>
 */
function resolveApiKey(req) {
  if (process.env.TISSEO_API_KEY) return process.env.TISSEO_API_KEY;

  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();

  try {
    const url = new URL(req.url, "http://localhost");
    const key = url.searchParams.get("key");
    if (key) return key;
  } catch {
    /* ignore */
  }

  return undefined;
}

export default async function handler(req, res) {
  // En-têtes CORS (utiles pour les clients navigateur et l'inspecteur MCP).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id"
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Méthode non autorisée. Utilisez POST." },
        id: null,
      })
    );
    return;
  }

  const apiKey = resolveApiKey(req);
  const server = createServer({ apiKey });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // mode sans état
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Erreur de traitement MCP :", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Erreur interne du serveur." },
          id: null,
        })
      );
    }
  }
}
