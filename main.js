import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset, RequestQueue } from 'crawlee';

await Actor.init();

const {
    startUrls = [{ url: 'https://www.fruitoftheloom.eu/shop/c/Fruit-Europe' }],
    proxyConfiguration = {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
    },
    maxConcurrency = 3,
    maxRequestRetries = 3,
    maxProducts = null, // null = tous les produits
} = await Actor.getInput() || {};

// Configuration du proxy rotatif résidentiel
const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

// Liste des user agents réalistes pour rotation
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// Fonction pour obtenir un user agent aléatoire
const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

// Fonction pour délai aléatoire
const randomDelay = (min = 2000, max = 5000) => 
    Math.floor(Math.random() * (max - min + 1)) + min;

// Créer les files d'attente
const catalogQueue = await RequestQueue.open('catalog');
const productQueue = await RequestQueue.open('products');

// Ensemble pour stocker les URLs déjà traitées
const processedCatalogPages = new Set();
const processedProducts = new Set();

// Compteur pour limiter le nombre de produits traités
let productsProcessedCount = 0;

// ============================================================================
// ACTEUR 1: Extraction des URLs de produits
// ============================================================================

const catalogCrawler = new PuppeteerCrawler({
    proxyConfiguration: proxyConfig,
    maxConcurrency: 1, // Limiter à 1 pour éviter la détection
    maxRequestRetries,
    requestHandlerTimeoutSecs: 300,
    
    launchContext: {
        launchOptions: {
            headless: true,
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
            ],
        },
    },
    
    preNavigationHooks: [
        async ({ page, request }) => {
            // Définir un user agent aléatoire
            await page.setUserAgent(getRandomUserAgent());
            
            // Définir des en-têtes réalistes
            await page.setExtraHTTPHeaders({
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            });
        },
    ],
    
    async requestHandler({ page, request }) {
        const url = request.url;
        
        if (processedCatalogPages.has(url)) {
            console.log(`Page catalogue déjà traitée: ${url}`);
            return;
        }
        
        console.log(`Traitement de la page catalogue: ${url}`);
        processedCatalogPages.add(url);
        
        // Délai aléatoire avant de charger la page
        await page.waitForTimeout(randomDelay(1000, 2000));
        
        // Attendre que le contenu soit chargé
        try {
            await page.waitForSelector('.product-listing-desc, .pagination, a[href*="/shop/p/"]', { 
                timeout: 30000 
            });
        } catch (e) {
            console.log(`Erreur lors de l'attente du sélecteur: ${e.message}`);
        }
        
        // Attendre que AngularJS charge le contenu
        await page.waitForTimeout(randomDelay(2000, 3000));
        
        // Simuler un défilement humain
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        await page.waitForTimeout(randomDelay(1000, 2000));
        
        // Gérer le bouton "Load More" s'il existe
        let loadMoreClicked = true;
        let loadMoreAttempts = 0;
        const maxLoadMoreAttempts = 50; // Limite de sécurité
        
        while (loadMoreClicked && loadMoreAttempts < maxLoadMoreAttempts) {
            loadMoreClicked = false;
            loadMoreAttempts++;
            
            // Chercher différents sélecteurs possibles pour "Load More"
            const loadMoreSelectors = [
                'button:contains("Load More")',
                'button:contains("Show More")',
                'a:contains("Load More")',
                '.btn-load-more',
                '.load-more',
                'button[class*="load"]',
                'a[class*="load-more"]',
            ];
            
            for (const selector of loadMoreSelectors) {
                try {
                    // Essayer de trouver le bouton avec différents sélecteurs
                    const loadMoreButton = await page.evaluate((sel) => {
                        // Chercher par texte
                        const buttons = Array.from(document.querySelectorAll('button, a'));
                        const found = buttons.find(btn => 
                            btn.textContent.toLowerCase().includes('load more') ||
                            btn.textContent.toLowerCase().includes('show more') ||
                            btn.textContent.toLowerCase().includes('voir plus')
                        );
                        return found ? true : false;
                    });
                    
                    if (loadMoreButton) {
                        // Cliquer sur le bouton
                        await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button, a'));
                            const btn = buttons.find(b => 
                                b.textContent.toLowerCase().includes('load more') ||
                                b.textContent.toLowerCase().includes('show more') ||
                                b.textContent.toLowerCase().includes('voir plus')
                            );
                            if (btn) {
                                btn.click();
                                return true;
                            }
                            return false;
                        });
                        
                        loadMoreClicked = true;
                        console.log(`Bouton "Load More" cliqué (tentative ${loadMoreAttempts})`);
                        
                        // Attendre que de nouveaux produits apparaissent
                        await page.waitForTimeout(randomDelay(2000, 4000));
                        
                        // Vérifier si de nouveaux éléments sont apparus
                        const newProducts = await page.evaluate(() => {
                            return document.querySelectorAll('a.product-listing-desc, a[href*="/shop/p/"]').length;
                        });
                        
                        console.log(`Produits visibles après clic: ${newProducts}`);
                        break;
                    }
                } catch (error) {
                    // Continuer avec le sélecteur suivant
                }
            }
            
            // Si aucun bouton trouvé, arrêter
            if (!loadMoreClicked) {
                break;
            }
        }
        
        // Extraire toutes les URLs de produits de cette page
        const productLinks = await page.evaluate(() => {
            const links = new Set();
            
            // Chercher avec plusieurs sélecteurs
            const selectors = [
                'a.product-listing-desc',
                'a[href*="/shop/p/"]',
                'a[ng-href*="/shop/p/"]',
            ];
            
            selectors.forEach(selector => {
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
                        links.add(fullUrl);
                    }
                });
            });
            
            return Array.from(links);
        });
        
        console.log(`Nombre de liens produits trouvés: ${productLinks.length}`);
        
        // Ajouter les URLs de produits à la file d'attente
        for (const productUrl of productLinks) {
            if (!processedProducts.has(productUrl)) {
                await productQueue.addRequest({ url: productUrl });
                processedProducts.add(productUrl);
            }
        }
        
        // Gérer la pagination normale (si pas de Load More)
        try {
            const currentPageMatch = url.match(/[?&]page=(\d+)/);
            const currentPage = currentPageMatch ? parseInt(currentPageMatch[1]) : 1;
            
            const urlObj = new URL(url);
            
            // Extraire les numéros de page visibles
            const pageNumbers = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('li.pagination-page a'));
                return links.map(link => {
                    const text = link.textContent.trim();
                    const num = parseInt(text);
                    return isNaN(num) ? null : num;
                }).filter(Boolean);
            });
            
            // Ajouter les pages suivantes
            for (const pageNum of pageNumbers) {
                urlObj.searchParams.set('page', pageNum.toString());
                const pageUrl = urlObj.toString();
                
                if (!processedCatalogPages.has(pageUrl)) {
                    await catalogQueue.addRequest({ url: pageUrl });
                }
            }
            
            // Vérifier s'il y a une page suivante
            const nextButton = await page.$('li.pagination-next:not(.disabled)');
            if (nextButton) {
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
        
        // Délai aléatoire après traitement
        await page.waitForTimeout(randomDelay(2000, 4000));
    },
    
    requestQueue: catalogQueue,
});

// ============================================================================
// ACTEUR 2: Scraping des pages produits avec interactions de couleurs
// ============================================================================

const productCrawler = new PuppeteerCrawler({
    proxyConfiguration: proxyConfig,
    maxConcurrency: maxConcurrency,
    maxRequestRetries,
    requestHandlerTimeoutSecs: 300,
    
    launchContext: {
        launchOptions: {
            headless: true,
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
            ],
        },
    },
    
    preNavigationHooks: [
        async ({ page, request }) => {
            await page.setUserAgent(getRandomUserAgent());
            await page.setExtraHTTPHeaders({
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            });
        },
    ],
    
    async requestHandler({ page, request }) {
        const url = request.url;
        
        // Vérifier la limite de produits
        if (maxProducts && productsProcessedCount >= maxProducts) {
            console.log(`Limite de ${maxProducts} produit(s) atteinte.`);
            return;
        }
        
        if (processedProducts.has(url)) {
            console.log(`Produit déjà traité: ${url}`);
            return;
        }
        
        console.log(`Traitement du produit: ${url} (${productsProcessedCount + 1}${maxProducts ? `/${maxProducts}` : ''})`);
        
        try {
            // Délai aléatoire avant de charger
            await page.waitForTimeout(randomDelay(1000, 2000));
            
            // Attendre que la page soit chargée
            await page.waitForSelector('.style-number-font, format-text', { 
                timeout: 30000,
                state: 'attached'
            });
            
            await page.waitForTimeout(randomDelay(2000, 3000));
            
            // Simuler un défilement
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });
            
            await page.waitForTimeout(randomDelay(1000, 2000));
            
            // Extraire le SKU
            let sku = null;
            try {
                const skuText = await page.$eval('.style-number-font', (el) => {
                    return el.textContent.trim();
                }).catch(() => null);
                
                if (skuText) {
                    const match = skuText.match(/Style:\s*(\d+)/);
                    if (match) sku = match[1];
                }
                
                if (!sku) {
                    const urlMatch = url.match(/\/(\d+)$/);
                    if (urlMatch) sku = urlMatch[1];
                }
            } catch (e) {
                const urlMatch = url.match(/\/(\d+)$/);
                if (urlMatch) sku = urlMatch[1];
            }
            
            // Extraire le nom du produit
            let name = null;
            try {
                const nameElement = await page.$('format-text[text="prodDetails.productNameAttribute.displayValue"]');
                if (nameElement) {
                    name = await nameElement.evaluate(el => el.textContent.trim());
                }
            } catch (e) {}
            
            if (!name) {
                try {
                    name = await page.$eval('format-text.ng-binding', 
                        el => el.textContent.trim()
                    ).catch(() => null);
                } catch (e) {}
            }
            
            if (!name) {
                try {
                    name = await page.$eval('h1, h2, h5, .product-name', 
                        el => el.textContent.trim()
                    ).catch(() => null);
                } catch (e) {
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
            
            // Extraire les couleurs disponibles
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
            
            // Pour chaque couleur, cliquer et extraire les images
            for (const color of colors) {
                try {
                    const colorButtons = await page.$$('.color-tooltip');
                    
                    for (const button of colorButtons) {
                        try {
                            const colorTitle = await button.$eval('.color-feature-title', 
                                el => el.textContent.trim()
                            ).catch(() => null);
                            
                            if (colorTitle === color) {
                                // Faire défiler jusqu'au bouton
                                await button.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                                await page.waitForTimeout(randomDelay(500, 1000));
                                
                                // Cliquer sur le bouton
                                const clickableElement = await button.$('.pdp-colors').catch(() => button);
                                await clickableElement.click({ delay: randomDelay(100, 300) });
                                
                                // Attendre que les images se chargent
                                await page.waitForTimeout(randomDelay(2000, 3000));
                                
                                // Attendre que le conteneur soit visible
                                try {
                                    await page.waitForSelector('ul.preview-thumbnail', { 
                                        timeout: 5000,
                                        visible: true
                                    });
                                } catch (e) {
                                    console.log(`Conteneur preview-thumbnail non visible pour ${color}`);
                                }
                                
                                // Extraire les images depuis ul.preview-thumbnail
                                const imageUrls = await page.evaluate(() => {
                                    const images = [];
                                    const previewThumbnail = document.querySelector('ul.preview-thumbnail');
                                    
                                    if (!previewThumbnail) return images;
                                    
                                    const containerStyle = window.getComputedStyle(previewThumbnail);
                                    if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') {
                                        return images;
                                    }
                                    
                                    const listItems = previewThumbnail.querySelectorAll('li.preview-image');
                                    
                                    listItems.forEach(li => {
                                        const img = li.querySelector('img');
                                        if (!img) return;
                                        
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
                                });
                                
                                if (imageUrls.length > 0) {
                                    colorImages[color] = imageUrls;
                                    console.log(`Images trouvées pour ${color}: ${imageUrls.length}`);
                                }
                                
                                break;
                            }
                        } catch (btnError) {
                            continue;
                        }
                    }
                } catch (error) {
                    console.log(`Erreur lors de l'extraction des images pour ${color}: ${error.message}`);
                }
            }
            
            // Si aucune image trouvée, essayer de récupérer les images par défaut
            if (Object.keys(colorImages).length === 0) {
                const defaultImages = await page.evaluate(() => {
                    const images = [];
                    const previewThumbnail = document.querySelector('ul.preview-thumbnail');
                    
                    if (!previewThumbnail) return images;
                    
                    const containerStyle = window.getComputedStyle(previewThumbnail);
                    if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') {
                        return images;
                    }
                    
                    const listItems = previewThumbnail.querySelectorAll('li.preview-image');
                    
                    listItems.forEach(li => {
                        const img = li.querySelector('img');
                        if (!img) return;
                        
                        const imgStyle = window.getComputedStyle(img);
                        if (imgStyle.display === 'none' || imgStyle.visibility === 'hidden') {
                            return;
                        }
                        
                        const src = img.getAttribute('src') || 
                                   img.getAttribute('data-ng-src') || 
                                   img.getAttribute('ng-src');
                        
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
                });
                
                if (defaultImages.length > 0 && colors.length > 0) {
                    colorImages[colors[0]] = defaultImages;
                } else if (defaultImages.length > 0) {
                    colorImages['Default'] = defaultImages;
                }
            }
            
            // Formater les données du produit
            const productData = {
                SKU: sku || '',
                Name: name || '',
                Colors: colors.join(';'),
                Size: sizes.join(';'),
                ColorImage: JSON.stringify(colorImages),
                Category: category || '',
                URL: url,
                ScrapedAt: new Date().toISOString(),
            };
            
            // Sauvegarder le produit
            await Dataset.pushData(productData);
            processedProducts.add(url);
            productsProcessedCount++;
            
            console.log(`Produit extrait: ${sku} - ${name} (${productsProcessedCount}${maxProducts ? `/${maxProducts}` : ''})`);
            
            // Délai aléatoire après traitement
            await page.waitForTimeout(randomDelay(2000, 4000));
            
        } catch (error) {
            console.error(`Erreur lors du traitement du produit ${url}: ${error.message}`);
            throw error;
        }
    },
    
    requestQueue: productQueue,
});

// ============================================================================
// DÉMARRAGE DU SCRAPING
// ============================================================================

console.log('Démarrage du scraping...');
console.log(`URLs de départ: ${JSON.stringify(startUrls)}`);

// Ajouter les URLs de départ à la file d'attente du catalogue
for (const startUrl of startUrls) {
    await catalogQueue.addRequest({ url: startUrl.url || startUrl });
}

// Phase 1: Scraper les pages de catalogue pour collecter toutes les URLs de produits
console.log('Phase 1: Extraction des URLs de produits...');
await catalogCrawler.run();

const productQueueInfo = await productQueue.getInfo();
console.log(`Phase 1 terminée. URLs produits collectées: ${productQueueInfo.pendingRequestCount || 0}`);

// Phase 2: Scraper toutes les pages produits
if (productQueueInfo.pendingRequestCount > 0) {
    console.log('Phase 2: Scraping des pages produits...');
    await productCrawler.run();
} else {
    console.log('Aucune URL produit à traiter.');
}

console.log('Scraping terminé!');

await Actor.exit();
