import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, RequestQueue } from 'crawlee';

await Actor.init();

const {
    startUrls = [{ url: 'https://www.fruitoftheloom.eu/shop/c?page=1' }],
    proxyConfiguration = {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
    },
    maxConcurrency = 5,
    maxRequestRetries = 3,
    maxProducts = 1, // Limiter à 1 produit pour les tests
} = await Actor.getInput() || {};

// Configuration du proxy rotatif résidentiel
const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

// Créer les files d'attente
const catalogQueue = await RequestQueue.open('catalog');
const productQueue = await RequestQueue.open('products');

// Ensemble pour stocker les URLs déjà traitées
const processedCatalogPages = new Set();
const processedProducts = new Set();

// Compteur pour limiter le nombre de produits traités
let productsProcessedCount = 0;

// Crawler pour les pages de catalogue (extraction des URLs produits)
const catalogCrawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfig,
    maxConcurrency,
    maxRequestRetries,
    requestHandlerTimeoutSecs: 300,
    useSessionPool: true,
    sessionPoolOptions: {
        sessionOptions: {
            maxUsageCount: 5,
            maxErrorScore: 1,
        },
    },
    
    async requestHandler({ page, request }) {
        const url = request.url;
        
        if (processedCatalogPages.has(url)) {
            console.log(`Page catalogue déjà traitée: ${url}`);
            return;
        }
        
        console.log(`Traitement de la page catalogue: ${url}`);
        processedCatalogPages.add(url);
        
        // La page est déjà chargée par PlaywrightCrawler
        const pageTitle = await page.title().catch(() => 'Unknown');
        console.log(`Titre de la page: ${pageTitle}`);

        // Attendre que le contenu soit chargé
        try {
            await page.waitForSelector('.product-listing-desc, .pagination, a[href*="/shop/p/"]', { timeout: 30000 });
            console.log('Sélecteur trouvé, contenu chargé');
        } catch (e) {
            console.log(`Erreur lors de l'attente du sélecteur: ${e.message}`);
            console.log('Tentative de continuer quand même...');
        }
        
        // Attendre que AngularJS charge le contenu
        await page.waitForTimeout(3000);
        
        // Vérifier le contenu de la page
        const pageContent = await page.content().catch(() => '');
        const hasProductLinks = pageContent.includes('/shop/p/') || pageContent.includes('product-listing');
        console.log(`La page contient des liens produits: ${hasProductLinks}`);

        // Extraire toutes les URLs de produits de cette page avec plusieurs sélecteurs possibles
        const productLinks = await page.evaluate(() => {
            const links = [];
            
            // Essayer plusieurs sélecteurs possibles
            const selectors = [
                'a.product-listing-desc',
                'a[href*="/shop/p/"]',
                'a[ng-href*="/shop/p/"]',
                '.product-listing-desc a',
                '.product-item a',
                'a[href^="/shop/p/"]'
            ];
            
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(link => {
                    const href = link.getAttribute('href') || link.getAttribute('ng-href');
                    if (href && (href.includes('/shop/p/') || href.startsWith('/shop/p/'))) {
                        let fullUrl = href;
                        if (href.startsWith('/')) {
                            fullUrl = `https://www.fruitoftheloom.eu${href}`;
                        } else if (!href.startsWith('http')) {
                            fullUrl = `https://www.fruitoftheloom.eu/${href}`;
                        }
                        
                        // Éviter les doublons
                        if (!links.includes(fullUrl)) {
                            links.push(fullUrl);
                        }
                    }
                });
            }
            
            return links;
        });

        console.log(`Nombre de liens produits trouvés: ${productLinks.length}`);
        
        if (productLinks.length > 0) {
            console.log(`Premiers liens trouvés: ${productLinks.slice(0, 3).join(', ')}`);
        } else {
            console.log('Aucun lien produit trouvé. Vérification du DOM...');
            // Essayer de voir ce qui est dans la page
            const pageInfo = await page.evaluate(() => {
                return {
                    allLinks: document.querySelectorAll('a').length,
                    productLinks: document.querySelectorAll('a[href*="/shop/p/"]').length,
                    productListingDesc: document.querySelectorAll('.product-listing-desc').length,
                    pagination: document.querySelectorAll('.pagination').length
                };
            });
            console.log(`Informations de la page:`, JSON.stringify(pageInfo));
        }

        // Ajouter les URLs de produits à la file d'attente
        let addedCount = 0;
        for (const productUrl of productLinks) {
            if (!processedProducts.has(productUrl)) {
                await productQueue.addRequest({ url: productUrl });
                processedProducts.add(productUrl); // Marquer comme traité pour éviter les doublons
                addedCount++;
                if (addedCount <= 3) {
                    console.log(`URL produit ajoutée: ${productUrl}`);
                }
            }
        }
        console.log(`Total URLs produits ajoutées à la file d'attente: ${addedCount}`);

        // Gérer la pagination AngularJS
        try {
            // Extraire le numéro de page actuel depuis l'URL
            const currentPageMatch = url.match(/[?&]page=(\d+)/);
            const currentPage = currentPageMatch ? parseInt(currentPageMatch[1]) : 1;
            
            // Construire l'URL de base
            const urlObj = new URL(url);
            const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
            
            // Extraire tous les numéros de page visibles dans la pagination
            const pageNumbers = await page.$$eval('li.pagination-page a', (links) => {
                return links.map(link => {
                    const text = link.textContent.trim();
                    if (!isNaN(parseInt(text))) {
                        return parseInt(text);
                    }
                    return null;
                }).filter(Boolean);
            });

            // Construire les URLs pour chaque page visible
            for (const pageNum of pageNumbers) {
                urlObj.searchParams.set('page', pageNum.toString());
                const pageUrl = urlObj.toString();
                
                if (!processedCatalogPages.has(pageUrl)) {
                    await catalogQueue.addRequest({ url: pageUrl });
                }
            }
            
            // Vérifier s'il y a une page suivante disponible
            const nextButton = await page.$('li.pagination-next:not(.disabled)');
            if (nextButton) {
                // Essayer de trouver le numéro de la dernière page visible
                const maxVisiblePage = pageNumbers.length > 0 ? Math.max(...pageNumbers) : currentPage;
                const nextPage = maxVisiblePage + 1;
                
                urlObj.searchParams.set('page', nextPage.toString());
                const nextPageUrl = urlObj.toString();
                
                if (!processedCatalogPages.has(nextPageUrl)) {
                    await catalogQueue.addRequest({ url: nextPageUrl });
                }
            }
        } catch (error) {
            console.log(`Erreur lors de l'extraction de la pagination: ${error.message}`);
        }
    },
    
    requestQueue: catalogQueue,
});

// Crawler pour les pages produits individuelles
const productCrawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfig,
    maxConcurrency: 3, // Moins de concurrence pour les pages produits (plus complexes)
    maxRequestRetries,
    requestHandlerTimeoutSecs: 300,
    useSessionPool: true,
    sessionPoolOptions: {
        sessionOptions: {
            maxUsageCount: 3,
            maxErrorScore: 1,
        },
    },
    
    async requestHandler({ page, request }) {
        const url = request.url;
        
        // Vérifier la limite de produits
        if (productsProcessedCount >= maxProducts) {
            console.log(`Limite de ${maxProducts} produit(s) atteinte. Arrêt du traitement.`);
            return;
        }
        
        // Éviter de traiter les mêmes produits plusieurs fois
        if (processedProducts.has(url)) {
            console.log(`Produit déjà traité: ${url}`);
            return;
        }

        console.log(`Traitement du produit: ${url} (${productsProcessedCount + 1}/${maxProducts})`);

        try {
            // Attendre que la page soit chargée - attendre que les éléments soient attachés au DOM (pas nécessairement visibles)
            await page.waitForSelector('.style-number-font, format-text', { 
                timeout: 30000,
                state: 'attached' // Attendre que l'élément soit attaché au DOM, pas nécessairement visible
            });
            
            // Attendre un peu pour que AngularJS charge le contenu
            await page.waitForTimeout(2000);

            // Extraire le SKU
            let sku = null;
            try {
                // Essayer d'extraire depuis .style-number-font
                const skuText = await page.$eval('.style-number-font', (el) => {
                    return el.textContent.trim();
                }).catch(() => null);
                
                if (skuText) {
                    const match = skuText.match(/Style:\s*(\d+)/);
                    if (match) {
                        sku = match[1];
                    }
                }
                
                // Si pas trouvé, essayer d'extraire depuis l'URL (le SKU est souvent dans l'URL)
                if (!sku) {
                    const urlMatch = url.match(/\/(\d+)$/);
                    if (urlMatch) {
                        sku = urlMatch[1];
                    }
                }
            } catch (e) {
                // Essayer d'extraire depuis l'URL en dernier recours
                const urlMatch = url.match(/\/(\d+)$/);
                if (urlMatch) {
                    sku = urlMatch[1];
                }
            }

            // Extraire le nom du produit
            let name = null;
            try {
                // Essayer d'abord avec le sélecteur spécifique AngularJS
                const nameElement = await page.$('format-text[text="prodDetails.productNameAttribute.displayValue"]');
                if (nameElement) {
                    name = await nameElement.textContent().then(t => t.trim());
                }
            } catch (e) {
                // Ignorer et essayer les fallbacks
            }
            
            if (!name) {
                try {
                    // Chercher dans les éléments format-text
                    name = await page.$eval('format-text.ng-binding', 
                        (el) => el.textContent.trim()
                    ).catch(() => null);
                } catch (e2) {
                    // Ignorer
                }
            }
            
            if (!name) {
                try {
                    // Fallback: chercher dans les titres
                    name = await page.$eval('h1, h2, h5, .product-name', 
                        (el) => el.textContent.trim()
                    ).catch(() => null);
                } catch (e3) {
                    name = null;
                }
            }

            // Extraire la catégorie
            const category = await page.$eval('a[ng-href^="c/"]', (el) => {
                const href = el.getAttribute('href') || el.getAttribute('ng-href');
                if (href) {
                    const match = href.match(/c\/([^\/]+)/);
                    return match ? match[1] : el.textContent.trim();
                }
                return el.textContent.trim();
            }).catch(() => null);

            // Extraire les couleurs
            const colors = await page.$$eval('.color-tooltip .color-feature-title', (elements) => {
                return elements.map(el => el.textContent.trim()).filter(Boolean);
            }).catch(() => []);

            // Extraire les tailles
            const sizes = await page.$$eval('.details.sizes span.ng-binding', (elements) => {
                const sizeList = [];
                elements.forEach(el => {
                    const text = el.textContent.trim();
                    if (text && text !== '-') {
                        const cleanSize = text.replace(/^-\s*/, '');
                        if (cleanSize && !sizeList.includes(cleanSize)) {
                            sizeList.push(cleanSize);
                        }
                    }
                });
                return sizeList;
            }).catch(() => []);

            // Objet pour stocker les images par couleur
            const colorImages = {};

            // Pour chaque couleur, simuler un clic et récupérer UNIQUEMENT les images de cette couleur
            for (const color of colors) {
                try {
                    // Trouver tous les boutons de couleur avec leurs titres
                    const colorButtons = await page.$$('.color-tooltip');
                    
                    for (const button of colorButtons) {
                        try {
                            // Extraire le titre de la couleur
                            const colorTitle = await button.$eval('.color-feature-title', 
                                (el) => el.textContent.trim()
                            ).catch(() => null);

                            if (colorTitle === color) {
                                // Faire défiler jusqu'au bouton
                                await button.scrollIntoViewIfNeeded();
                                await page.waitForTimeout(500);
                                
                                // Trouver l'élément cliquable (pdp-colors ou le bouton lui-même)
                                const clickableElement = await button.$('.pdp-colors').catch(() => button);
                                
                                // Cliquer sur l'élément
                                await clickableElement.click({ force: true });
                                
                                // Attendre que AngularJS mette à jour le DOM avec les nouvelles images
                                await page.waitForTimeout(3000);
                                
                                // Attendre que le conteneur preview-thumbnail soit visible et contienne des images
                                try {
                                    await page.waitForSelector('ul.preview-thumbnail:not([style*="display: none"])', { 
                                        timeout: 5000,
                                        state: 'visible' 
                                    });
                                } catch (e) {
                                    console.log(`Le conteneur preview-thumbnail n'est pas visible pour ${color}`);
                                }
                                
                                // Extraire UNIQUEMENT les images dans ul.preview-thumbnail après le clic sur cette couleur
                                const imageUrls = await page.evaluate(() => {
                                    const images = [];
                                    
                                    // Chercher UNIQUEMENT dans ul.preview-thumbnail
                                    const previewThumbnail = document.querySelector('ul.preview-thumbnail');
                                    
                                    if (!previewThumbnail) {
                                        return images;
                                    }
                                    
                                    // Vérifier que le conteneur est visible
                                    const containerStyle = window.getComputedStyle(previewThumbnail);
                                    if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') {
                                        return images;
                                    }
                                    
                                    // Chercher toutes les images dans les li.preview-image
                                    const listItems = previewThumbnail.querySelectorAll('li.preview-image');
                                    
                                    listItems.forEach(li => {
                                        const img = li.querySelector('img');
                                        if (!img) {
                                            return;
                                        }
                                        
                                        // Vérifier que l'image est visible
                                        const imgStyle = window.getComputedStyle(img);
                                        if (imgStyle.display === 'none' || 
                                            imgStyle.visibility === 'hidden' || 
                                            parseFloat(imgStyle.opacity) < 0.1) {
                                            return;
                                        }
                                        
                                        // Extraire l'URL de l'image
                                        const src = img.getAttribute('src') || 
                                                   img.getAttribute('data-ng-src') || 
                                                   img.getAttribute('ng-src') ||
                                                   img.getAttribute('data-src');
                                        
                                        if (src && (src.includes('product') || src.includes('cdn'))) {
                                            let fullUrl = src;
                                            if (src.startsWith('//')) {
                                                fullUrl = 'https:' + src;
                                            } else if (src.startsWith('/')) {
                                                fullUrl = 'https://www.fruitoftheloom.eu' + src;
                                            }
                                            
                                            // Éviter les doublons
                                            if (!images.includes(fullUrl.trim())) {
                                                images.push(fullUrl.trim());
                                            }
                                        }
                                    });
                                    
                                    return images;
                                }).catch(() => []);

                                if (imageUrls.length > 0) {
                                    colorImages[color] = imageUrls;
                                    console.log(`Images trouvées pour ${color}: ${imageUrls.length}`);
                                } else {
                                    console.log(`Aucune image visible trouvée pour ${color}`);
                                }
                                
                                break; // Sortir de la boucle une fois la couleur trouvée
                            }
                        } catch (btnError) {
                            // Continuer avec le bouton suivant
                            continue;
                        }
                    }
                } catch (error) {
                    console.log(`Erreur lors de l'extraction des images pour la couleur ${color}: ${error.message}`);
                }
            }

            // Si aucune image n'a été trouvée par couleur, essayer de récupérer les images par défaut depuis preview-thumbnail
            if (Object.keys(colorImages).length === 0) {
                const defaultImages = await page.evaluate(() => {
                    const images = [];
                    
                    // Chercher UNIQUEMENT dans ul.preview-thumbnail
                    const previewThumbnail = document.querySelector('ul.preview-thumbnail');
                    
                    if (!previewThumbnail) {
                        return images;
                    }
                    
                    // Vérifier que le conteneur est visible
                    const containerStyle = window.getComputedStyle(previewThumbnail);
                    if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') {
                        return images;
                    }
                    
                    // Chercher toutes les images dans les li.preview-image
                    const listItems = previewThumbnail.querySelectorAll('li.preview-image');
                    
                    listItems.forEach(li => {
                        const img = li.querySelector('img');
                        if (!img) {
                            return;
                        }
                        
                        // Vérifier que l'image est visible
                        const imgStyle = window.getComputedStyle(img);
                        if (imgStyle.display === 'none' || 
                            imgStyle.visibility === 'hidden' || 
                            parseFloat(imgStyle.opacity) < 0.1) {
                            return;
                        }
                        
                        const src = img.getAttribute('src') || 
                                   img.getAttribute('data-ng-src') || 
                                   img.getAttribute('ng-src') ||
                                   img.getAttribute('data-src');
                        
                        if (src && (src.includes('product') || src.includes('cdn'))) {
                            let fullUrl = src;
                            if (src.startsWith('//')) {
                                fullUrl = 'https:' + src;
                            } else if (src.startsWith('/')) {
                                fullUrl = 'https://www.fruitoftheloom.eu' + src;
                            }
                            
                            if (!images.includes(fullUrl.trim())) {
                                images.push(fullUrl.trim());
                            }
                        }
                    });
                    
                    return images;
                }).catch(() => []);

                if (defaultImages.length > 0 && colors.length > 0) {
                    // Associer les images à la première couleur disponible
                    colorImages[colors[0]] = defaultImages;
                } else if (defaultImages.length > 0) {
                    // Si pas de couleurs mais des images, les associer à "Default"
                    colorImages['Default'] = defaultImages;
                }
            }

            // Formater les données du produit
            // Convertir ColorImage en JSON string pour qu'il soit dans une seule colonne
            const productData = {
                SKU: sku || '',
                Name: name || '',
                Colors: colors.join(';'),
                Size: sizes.join(';'),
                ColorImage: JSON.stringify(colorImages), // Convertir l'objet en JSON string pour une seule colonne
                Category: category || '',
                URL: url,
                ScrapedAt: new Date().toISOString(),
            };

            // Sauvegarder le produit
            await Dataset.pushData(productData);
            processedProducts.add(url);
            productsProcessedCount++;

            console.log(`Produit extrait: ${sku} - ${name} (${productsProcessedCount}/${maxProducts})`);
            
            // Vérifier si on a atteint la limite
            if (productsProcessedCount >= maxProducts) {
                console.log(`Limite de ${maxProducts} produit(s) atteinte. Arrêt du traitement.`);
            }

        } catch (error) {
            console.error(`Erreur lors du traitement du produit ${url}: ${error.message}`);
            // Si c'est juste un timeout de sélecteur, essayer de sauvegarder ce qu'on a pu extraire
            if (error.message.includes('Timeout') || error.message.includes('waitForSelector')) {
                console.log(`Tentative de récupération des données partielles pour ${url}`);
                // Essayer d'extraire au moins l'URL et la date
                try {
                    const partialData = {
                        SKU: '',
                        Name: '',
                        Colors: '',
                        Size: '',
                        ColorImage: JSON.stringify({}), // Convertir en JSON string pour une seule colonne
                        Category: '',
                        URL: url,
                        ScrapedAt: new Date().toISOString(),
                        Error: error.message,
                    };
                    await Dataset.pushData(partialData);
                    processedProducts.add(url);
                    console.log(`Données partielles sauvegardées pour ${url}`);
                } catch (saveError) {
                    console.error(`Impossible de sauvegarder les données partielles: ${saveError.message}`);
                }
            }
            // Relancer l'erreur pour que le crawler puisse réessayer
            throw error;
        }
    },
    
    requestQueue: productQueue,
});

// Démarrer le scraping
console.log('Démarrage du scraping...');
console.log(`URLs de départ: ${JSON.stringify(startUrls)}`);

// Ajouter les URLs de départ à la file d'attente du catalogue AVANT de démarrer le crawler
for (const startUrl of startUrls) {
    const urlToAdd = startUrl.url || startUrl;
    console.log(`Ajout de l'URL catalogue: ${urlToAdd}`);
    try {
        const request = await catalogQueue.addRequest({ 
            url: urlToAdd,
            uniqueKey: urlToAdd
        });
        console.log(`Requête ajoutée avec ID: ${request.requestId || 'N/A'}`);
    } catch (error) {
        console.error(`Erreur lors de l'ajout de la requête: ${error.message}`);
    }
}

// Attendre un peu pour s'assurer que les requêtes sont bien enregistrées
await new Promise(resolve => setTimeout(resolve, 2000));

// Vérifier que les URLs ont été ajoutées
const catalogQueueInfo = await catalogQueue.getInfo();
console.log(`File d'attente catalogue - Requêtes en attente: ${catalogQueueInfo.pendingRequestCount || 0}, Total: ${catalogQueueInfo.totalRequestCount || 0}, Traitées: ${catalogQueueInfo.handledRequestCount || 0}`);

if (catalogQueueInfo.pendingRequestCount === 0 && catalogQueueInfo.totalRequestCount === 0) {
    console.error('ERREUR: Aucune requête dans la file d\'attente! Le crawler ne pourra pas fonctionner.');
} else {
    console.log('Démarrage du crawler catalogue...');
    // D'abord, scraper les pages de catalogue pour collecter toutes les URLs de produits
    await catalogCrawler.run();
}

console.log(`Nombre total d'URLs produits collectées: ${await productQueue.getInfo().then(info => info.pendingRequestCount || 0)}`);

// Ensuite, scraper toutes les pages produits
await productCrawler.run();

console.log('Scraping terminé!');

await Actor.exit();

