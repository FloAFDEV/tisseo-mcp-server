/**
 * Client HTTP minimal pour l'API OpenData Tisséo v2.
 *
 * Toutes les requêtes sont en lecture seule (GET) et l'authentification
 * se fait via le paramètre de requête `key`.
 *
 * Documentation : https://data.toulouse-metropole.fr/explore/dataset/api-temps-reel-tisseo/
 */

export const TISSEO_BASE_URL = process.env.TISSEO_BASE_URL || "https://api.tisseo.fr/v2";

/** Erreur applicative renvoyée lorsqu'un appel API échoue. */
export class TisseoError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = "TisseoError";
    this.status = status;
    this.url = url;
  }
}

/**
 * Construit et exécute un appel GET vers un endpoint Tisséo.
 *
 * @param {string} endpoint  Nom du service (ex: "stops_schedules", "lines").
 * @param {Record<string, unknown>} params  Paramètres de requête.
 * @param {string} apiKey  Clé API Tisséo.
 * @returns {Promise<any>} Corps JSON de la réponse.
 */
export async function tisseoRequest(endpoint, params, apiKey) {
  if (!apiKey) {
    throw new TisseoError(
      "Clé API Tisséo manquante. Définissez la variable d'environnement TISSEO_API_KEY " +
        "ou transmettez la clé via le paramètre/entête de la requête MCP."
    );
  }

  const url = new URL(`${TISSEO_BASE_URL}/${endpoint}.json`);
  url.searchParams.set("key", apiKey);

  for (const [name, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    throw new TisseoError(`Échec de la requête réseau vers Tisséo : ${cause.message}`, {
      url: url.toString(),
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TisseoError(
      `L'API Tisséo a répondu ${response.status} ${response.statusText}` +
        (body ? ` — ${body.slice(0, 300)}` : ""),
      { status: response.status, url: url.toString() }
    );
  }

  return response.json();
}

/**
 * Résout un lieu (nom libre ou couple "lon,lat") en coordonnées exploitables
 * par le calculateur d'itinéraires.
 *
 * @returns {Promise<{x: string, y: string, label: string}>}
 */
export async function resolvePlace(place, apiKey) {
  const coordMatch = String(place).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    return { x: coordMatch[1], y: coordMatch[2], label: place };
  }

  const data = await tisseoRequest("places", { term: place, number: 1 }, apiKey);
  const candidate = data?.placesList?.places?.[0] || data?.places?.[0];

  if (!candidate) {
    throw new TisseoError(`Aucun lieu trouvé pour « ${place} ».`);
  }

  const x = candidate.x ?? candidate.coordinatesX ?? candidate.longitude;
  const y = candidate.y ?? candidate.coordinatesY ?? candidate.latitude;

  if (x === undefined || y === undefined) {
    throw new TisseoError(`Coordonnées indisponibles pour « ${place} ».`);
  }

  return { x: String(x), y: String(y), label: candidate.label || candidate.name || place };
}
