FROM apify/actor-node-puppeteer-chrome:20

# Copier les fichiers du projet
COPY package*.json ./

# Installer les dépendances npm
# L'image a déjà Chrome installé, Puppeteer l'utilisera automatiquement
RUN npm install --quiet --omit=dev

# Copier le reste des fichiers
COPY . ./

