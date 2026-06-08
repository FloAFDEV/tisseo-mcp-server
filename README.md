# Tisséo MCP Server

Serveur [MCP (Model Context Protocol)](https://modelcontextprotocol.io) donnant accès à
l'**API OpenData Tisséo v2** (transports en commun de Toulouse) : prochains passages en
temps réel, recherche d'arrêts, lignes, perturbations et calcul d'itinéraires.

Le serveur fonctionne en **double transport** :

- **stdio** — pour une utilisation locale (Claude Desktop, Cursor, inspecteur MCP, CLI…).
- **HTTP streamable** — pour un déploiement serverless sur **Vercel** et une intégration
  dans **[Poke](https://poke.com)**.

## Stack technique

- Node.js (ESM, `>= 18`)
- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [`zod`](https://zod.dev) pour la validation des entrées

## Outils exposés

| Outil | Description | Paramètres principaux |
|---|---|---|
| `get_next_departures` | Prochains passages (temps réel) à un arrêt | `stopAreaId` \| `stopPointId` \| `stopName` \| (`latitude`+`longitude`), `lineId?`, `number?`, `datetime?` |
| `search_stops` | Recherche d'arrêts et de lieux par nom | `term`, `number?` |
| `find_nearby_stops` | Arrêts les plus proches d'une position (géolocalisation) | `latitude`, `longitude`, `number?` |
| `get_lines` | Liste des lignes (métro, tram, bus) | `lineId?`, `network?`, `shortName?` |
| `get_disruptions` | Messages d'information et perturbations | `lineId?`, `network?` |
| `plan_journey` | Calcul d'itinéraire entre deux lieux | `from`, `to`, `datetime?`, `count?`, `roadmap?` |

> Pour `plan_journey`, `from` et `to` acceptent soit un **nom de lieu** (résolu
> automatiquement via le service `places`), soit des coordonnées au format
> `longitude,latitude`.

### Géolocalisation de l'utilisateur

Un serveur MCP n'accède pas directement au GPS : la **position est fournie par le
client** (Poke, application mobile, navigateur…) puis transmise aux outils.

- `find_nearby_stops` convertit une position (`latitude`, `longitude`) en arrêts
  Tisséo les plus proches.
- `get_next_departures` accepte aussi `latitude`/`longitude` et utilise alors
  automatiquement l'arrêt le plus proche.
- `plan_journey` accepte des coordonnées `longitude,latitude` comme point de départ
  (ex. `from: "1.4442,43.6045"`).

Exemple : « Quel est le prochain bus **près de moi** ? » → le client transmet la
position de l'utilisateur à `get_next_departures`.

## Prérequis : clé API Tisséo

L'API Tisséo nécessite une clé, à demander gratuitement auprès de
**opendata@tisseo.fr** (voir le [jeu de données OpenData](https://data.toulouse-metropole.fr/explore/dataset/api-temps-reel-tisseo/)).
La clé est transmise via la variable d'environnement `TISSEO_API_KEY`.

## Installation locale

```bash
git clone <votre-repo>
cd tisseo-mcp-server
npm install
cp .env.example .env   # puis renseignez TISSEO_API_KEY
```

### Lancement en stdio

```bash
TISSEO_API_KEY=xxxx npm start
```

### Inspection / test des outils

```bash
TISSEO_API_KEY=xxxx npm run inspect
```

### Intégration Claude Desktop (exemple)

Dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "tisseo": {
      "command": "node",
      "args": ["/chemin/absolu/vers/tisseo-mcp-server/src/stdio.js"],
      "env": { "TISSEO_API_KEY": "votre_cle_api" }
    }
  }
}
```

## Déploiement sur Vercel

Le endpoint HTTP MCP est exposé par la fonction serverless `api/mcp.js`
(également disponible via le raccourci `/mcp`).

### 1. Via le CLI Vercel

```bash
npm i -g vercel

# Depuis le dossier tisseo-mcp-server/
vercel link                              # lier le projet
vercel env add TISSEO_API_KEY production # coller votre clé API
vercel --prod                            # déployer en production
```

> Si le serveur vit dans un sous-dossier du dépôt (`tisseo-mcp-server/`), exécutez
> les commandes `vercel` depuis ce dossier, ou configurez le **Root Directory** sur
> `tisseo-mcp-server` dans les réglages du projet Vercel.

### 2. Via l'interface Vercel

1. *New Project* → importez le dépôt Git.
2. **Root Directory** : `tisseo-mcp-server`.
3. **Environment Variables** : ajoutez `TISSEO_API_KEY`.
4. *Deploy*.

### Vérification

Une fois déployé, l'URL MCP est :

```
https://<votre-projet>.vercel.app/api/mcp
```

Test rapide (liste des outils) :

```bash
curl -s -X POST https://<votre-projet>.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Intégration dans Poke

Poke se connecte à un serveur MCP distant exposant un endpoint **HTTP streamable**,
exactement ce que fournit le déploiement Vercel.

### Via l'interface

1. Ouvrez **https://poke.com/settings/connections/integrations/new**
   (ou *Settings → Connections → Integrations → Add Custom MCP Server*).
2. **Name** : `Tisséo`.
3. **MCP Server URL** : `https://<votre-projet>.vercel.app/api/mcp`.
4. (Optionnel) **API Key** : si vous n'avez pas défini `TISSEO_API_KEY` côté Vercel,
   vous pouvez fournir ici la clé Tisséo — elle sera transmise en
   `Authorization: Bearer <clé>` et utilisée par le serveur.
5. **Create Integration** : Poke se connecte et découvre les 5 outils.

### Via la ligne de commande (CLI)

Poke gère ses intégrations via une API. Avec votre clé Poke (`POKE_API_KEY`), vous
pouvez piloter l'assistant et lui demander d'utiliser l'intégration sans quitter le
terminal :

```bash
# Demander à Poke d'enregistrer / d'utiliser le serveur Tisséo
curl -s https://poke.com/api/v1/inbound-sms/webhook \
  -H "Authorization: Bearer $POKE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Connecte mon serveur MCP Tisséo : https://<votre-projet>.vercel.app/api/mcp"}'
```

Pour tester le serveur MCP lui-même en ligne de commande, utilisez l'inspecteur
officiel pointé sur l'URL distante :

```bash
npx @modelcontextprotocol/inspector https://<votre-projet>.vercel.app/api/mcp
```

> La documentation Poke à jour (transports supportés, format des intégrations) est
> disponible sur **https://poke.com/docs/mcp-servers**.

## Exemples d'utilisation (langage naturel via Poke / Claude)

- « Prochains métros à **Jean Jaurès** ? » → `get_next_departures`
- « Y a-t-il des **perturbations sur la ligne A** ? » → `get_disruptions`
- « Itinéraire de **Capitole** à **Aéroport de Toulouse-Blagnac** » → `plan_journey`
- « Quelles sont les **lignes de tram** ? » → `get_lines`

## Structure du projet

```
tisseo-mcp-server/
├── api/
│   └── mcp.js          # Endpoint HTTP streamable (Vercel / Poke)
├── src/
│   ├── server.js       # Construction du serveur + enregistrement des outils
│   ├── stdio.js        # Point d'entrée stdio (usage local)
│   └── tisseo.js       # Client HTTP de l'API Tisséo v2
├── .env.example
├── package.json
├── vercel.json
└── README.md
```

## Licence

MIT
