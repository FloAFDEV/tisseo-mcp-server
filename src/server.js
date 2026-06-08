/**
 * Construction du serveur MCP Tisséo et enregistrement des outils.
 *
 * Le même serveur est utilisé par le transport stdio (usage local / CLI)
 * et par le transport HTTP streamable (déploiement Vercel / Poke).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { tisseoRequest, resolvePlace, TisseoError } from "./tisseo.js";

/** Emballe un résultat JSON dans le format de contenu attendu par MCP. */
function jsonContent(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Emballe une erreur applicative dans une réponse MCP `isError`. */
function errorContent(error) {
  const message =
    error instanceof TisseoError
      ? error.message
      : `Erreur inattendue : ${error?.message || String(error)}`;
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Crée une instance de serveur MCP Tisséo entièrement configurée.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey] Clé API Tisséo (défaut: process.env.TISSEO_API_KEY).
 * @returns {McpServer}
 */
export function createServer({ apiKey = process.env.TISSEO_API_KEY } = {}) {
  const server = new McpServer({
    name: "tisseo-mcp-server",
    version: "1.0.0",
  });

  // ---------------------------------------------------------------------------
  // get_next_departures — prochains passages à un arrêt
  // ---------------------------------------------------------------------------
  server.registerTool(
    "get_next_departures",
    {
      title: "Prochains passages",
      description:
        "Renvoie les prochains passages (temps réel) à un arrêt Tisséo. " +
        "Fournissez un identifiant d'arrêt (stopAreaId ou stopPointId) OU un nom " +
        "d'arrêt (stopName) qui sera résolu automatiquement.",
      inputSchema: {
        stopAreaId: z
          .string()
          .optional()
          .describe("Identifiant de la zone d'arrêt (stop_area)."),
        stopPointId: z
          .string()
          .optional()
          .describe("Identifiant du point d'arrêt (stop_point)."),
        stopName: z
          .string()
          .optional()
          .describe("Nom de l'arrêt à résoudre si aucun identifiant n'est fourni."),
        latitude: z
          .number()
          .optional()
          .describe("Latitude pour utiliser l'arrêt le plus proche (géolocalisation)."),
        longitude: z
          .number()
          .optional()
          .describe("Longitude pour utiliser l'arrêt le plus proche (géolocalisation)."),
        lineId: z
          .string()
          .optional()
          .describe("Filtre sur une ligne précise (lineId)."),
        number: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Nombre de passages à retourner (défaut 5)."),
        datetime: z
          .string()
          .optional()
          .describe("Date/heure de référence au format ISO ou 'YYYY-MM-DD HH:mm'."),
      },
    },
    async ({
      stopAreaId,
      stopPointId,
      stopName,
      latitude,
      longitude,
      lineId,
      number = 5,
      datetime,
    }) => {
      try {
        // Résolution par nom d'arrêt.
        if (!stopAreaId && !stopPointId && stopName) {
          const data = await tisseoRequest(
            "places",
            { term: stopName, number: 1 },
            apiKey
          );
          const place = data?.placesList?.places?.[0] || data?.places?.[0];
          stopAreaId = place?.id || place?.stopAreaId;
          if (!stopAreaId) {
            throw new TisseoError(`Aucun arrêt trouvé pour « ${stopName} ».`);
          }
        }

        // Résolution par géolocalisation : arrêt le plus proche.
        if (!stopAreaId && !stopPointId && latitude !== undefined && longitude !== undefined) {
          const data = await tisseoRequest(
            "places",
            { coordinatesXY: `${longitude},${latitude}`, number: 1 },
            apiKey
          );
          const place = data?.placesList?.places?.[0] || data?.places?.[0];
          stopAreaId = place?.id || place?.stopAreaId;
          if (!stopAreaId) {
            throw new TisseoError(
              `Aucun arrêt trouvé à proximité de (${latitude}, ${longitude}).`
            );
          }
        }

        if (!stopAreaId && !stopPointId) {
          throw new TisseoError(
            "Veuillez fournir stopAreaId, stopPointId, stopName ou une position (latitude/longitude)."
          );
        }

        const result = await tisseoRequest(
          "stops_schedules",
          {
            stopAreaId,
            stopPointId,
            lineId,
            number,
            datetime,
            displayRealTime: 1,
          },
          apiKey
        );
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // search_stops — recherche d'arrêts / lieux
  // ---------------------------------------------------------------------------
  server.registerTool(
    "search_stops",
    {
      title: "Recherche d'arrêts",
      description:
        "Recherche des arrêts, stations et lieux du réseau Tisséo par nom. " +
        "Utile pour récupérer un identifiant ou des coordonnées.",
      inputSchema: {
        term: z.string().min(1).describe("Texte recherché (nom d'arrêt ou de lieu)."),
        number: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Nombre maximum de résultats (défaut 10)."),
      },
    },
    async ({ term, number = 10 }) => {
      try {
        const result = await tisseoRequest("places", { term, number }, apiKey);
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // find_nearby_stops — arrêts à proximité d'une position
  // ---------------------------------------------------------------------------
  // Un serveur MCP n'a pas accès au GPS : la position est fournie par le client
  // (Poke, application mobile…) ou saisie par l'utilisateur. Cet outil convertit
  // une géolocalisation en arrêts Tisséo les plus proches.
  server.registerTool(
    "find_nearby_stops",
    {
      title: "Arrêts à proximité",
      description:
        "Renvoie les arrêts Tisséo les plus proches d'une position géographique. " +
        "Fournissez la latitude et la longitude de la personne (par ex. issues de " +
        "la géolocalisation du client) pour trouver d'où partir.",
      inputSchema: {
        latitude: z.number().describe("Latitude de la position (ex: 43.6045)."),
        longitude: z.number().describe("Longitude de la position (ex: 1.4442)."),
        number: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Nombre maximum d'arrêts à retourner (défaut 5)."),
      },
    },
    async ({ latitude, longitude, number = 5 }) => {
      try {
        // L'API Tisséo attend les coordonnées au format "longitude,latitude".
        const result = await tisseoRequest(
          "places",
          {
            coordinatesXY: `${longitude},${latitude}`,
            number,
          },
          apiKey
        );
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_lines — liste des lignes
  // ---------------------------------------------------------------------------
  server.registerTool(
    "get_lines",
    {
      title: "Lignes du réseau",
      description:
        "Liste les lignes du réseau Tisséo (métro, tram, bus). " +
        "Filtres optionnels par identifiant de ligne ou par réseau.",
      inputSchema: {
        lineId: z.string().optional().describe("Filtre sur une ligne précise."),
        network: z
          .string()
          .optional()
          .describe("Filtre sur un réseau (ex: 'Tisséo')."),
        shortName: z
          .string()
          .optional()
          .describe("Filtre sur le nom court de la ligne (ex: 'A', 'T1', '14')."),
      },
    },
    async ({ lineId, network, shortName }) => {
      try {
        const result = await tisseoRequest(
          "lines",
          { lineId, network, shortName },
          apiKey
        );
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // get_disruptions — perturbations / messages réseau
  // ---------------------------------------------------------------------------
  server.registerTool(
    "get_disruptions",
    {
      title: "Perturbations",
      description:
        "Renvoie les messages d'information et perturbations en cours sur le réseau " +
        "Tisséo, avec filtrage optionnel par ligne ou par réseau.",
      inputSchema: {
        lineId: z.string().optional().describe("Filtre sur une ligne précise."),
        network: z.string().optional().describe("Filtre sur un réseau."),
      },
    },
    async ({ lineId, network }) => {
      try {
        const result = await tisseoRequest(
          "messages",
          { lineId, network },
          apiKey
        );
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // plan_journey — calcul d'itinéraire
  // ---------------------------------------------------------------------------
  server.registerTool(
    "plan_journey",
    {
      title: "Calcul d'itinéraire",
      description:
        "Calcule un itinéraire en transports en commun entre deux lieux. " +
        "Les lieux peuvent être des noms (résolus automatiquement) ou des " +
        "coordonnées au format 'longitude,latitude'.",
      inputSchema: {
        from: z
          .string()
          .min(1)
          .describe("Point de départ : nom de lieu ou 'longitude,latitude'."),
        to: z
          .string()
          .min(1)
          .describe("Point d'arrivée : nom de lieu ou 'longitude,latitude'."),
        datetime: z
          .string()
          .optional()
          .describe("Date/heure de départ au format ISO ou 'YYYY-MM-DD HH:mm'."),
        count: z
          .number()
          .int()
          .positive()
          .max(10)
          .optional()
          .describe("Nombre d'itinéraires à proposer (défaut 3)."),
        roadmap: z
          .boolean()
          .optional()
          .describe("Inclure la feuille de route détaillée (défaut true)."),
      },
    },
    async ({ from, to, datetime, count = 3, roadmap = true }) => {
      try {
        const [origin, destination] = await Promise.all([
          resolvePlace(from, apiKey),
          resolvePlace(to, apiKey),
        ]);

        const result = await tisseoRequest(
          "journeys",
          {
            departureX: origin.x,
            departureY: origin.y,
            arrivalX: destination.x,
            arrivalY: destination.y,
            datetime,
            number: count,
            roadmap: roadmap ? 1 : 0,
          },
          apiKey
        );

        return jsonContent({
          origin: origin.label,
          destination: destination.label,
          ...result,
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  return server;
}
