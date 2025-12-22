# Fruit of the Loom Scraper - Acteur APIfy

Acteur APIfy optimisé avec rotating residential proxy pour scraper le catalogue produit de Fruit of the Loom.

## Fonctionnalités

- ✅ Scraping automatique de toutes les pages de catalogue avec gestion de la pagination AngularJS
- ✅ Extraction des URLs de tous les produits
- ✅ Extraction des données produits :
  - SKU (Style number)
  - Nom du produit
  - Couleurs disponibles (format: "Color1;Color2;Color3")
  - Tailles disponibles (format: "S;M;L;XL;2XL;3XL")
  - Images par couleur (objet JSON avec chaque couleur comme clé)
  - Catégorie du produit
- ✅ Simulation de clics sur les couleurs pour récupérer les images spécifiques à chaque couleur
- ✅ Rotating residential proxy pour éviter les blocages
- ✅ Gestion des sessions avec rotation automatique
- ✅ Gestion d'erreurs et retry automatique

## Structure des données extraites

Chaque produit est enregistré avec la structure suivante :

```json
{
  "SKU": "0613620",
  "Name": "Pure Cotton T",
  "Colors": "White;Black;Red;Royal Blue",
  "Size": "S;M;L;XL;2XL;3XL",
  "ColorImage": {
    "White": [
      "https://cdn.fruitoftheloom.eu/resources/images/product/061362/30/large/95476.jpg",
      "https://cdn.fruitoftheloom.eu/resources/images/product/061362/30/large/95468.jpg"
    ],
    "Black": [
      "https://cdn.fruitoftheloom.eu/resources/images/product/061362/36/large/..."
    ]
  },
  "Category": "T-Shirts",
  "URL": "https://www.fruitoftheloom.eu/shop/p/pure-cotton-t/0613620",
  "ScrapedAt": "2024-01-01T12:00:00.000Z"
}
```

## Installation

```bash
npm install
```

## Configuration

L'acteur utilise le fichier `input.json` pour la configuration par défaut. Vous pouvez le modifier ou passer les paramètres via l'interface APIfy :

```json
{
  "startUrls": [
    {
      "url": "https://www.fruitoftheloom.eu/shop/c?page=1"
    }
  ],
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  },
  "maxConcurrency": 5,
  "maxRequestRetries": 3,
  "requestHandlerTimeoutSecs": 300
}
```

### Paramètres

- `startUrls`: URLs de départ pour le scraping (par défaut: page 1 du catalogue)
- `proxyConfiguration`: Configuration du proxy résidentiel rotatif
- `maxConcurrency`: Nombre maximum de requêtes simultanées (défaut: 5)
- `maxRequestRetries`: Nombre de tentatives en cas d'échec (défaut: 3)

## Utilisation

### Localement

```bash
npm start
```

### Sur APIfy Platform

1. Créez un nouvel acteur sur [apify.com](https://apify.com)
2. Uploadez le code de cet acteur
3. Configurez les paramètres d'entrée
4. Lancez l'acteur

## Fonctionnement

1. **Phase 1 - Collecte des URLs produits** :
   - Le crawler parcourt toutes les pages de catalogue
   - Extrait les URLs de chaque produit
   - Gère automatiquement la pagination AngularJS

2. **Phase 2 - Extraction des données produits** :
   - Pour chaque produit, extrait le SKU, nom, couleurs, tailles et catégorie
   - Simule un clic sur chaque couleur pour charger les images correspondantes
   - Stocke toutes les images dans un objet structuré par couleur

## Optimisations

- Utilisation de `RequestQueue` pour gérer efficacement les URLs
- Session pool avec rotation automatique des proxies
- Détection des doublons pour éviter les traitements multiples
- Timeouts adaptés pour les pages AngularJS
- Gestion d'erreurs robuste avec retry automatique

## Notes

- Le site utilise AngularJS, donc des délais sont nécessaires pour le chargement du contenu dynamique
- Les proxies résidentiels rotatifs sont essentiels pour éviter les blocages
- Le scraping peut prendre du temps selon le nombre de produits dans le catalogue
