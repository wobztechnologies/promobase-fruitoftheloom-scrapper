FROM apify/actor-node-puppeteer-chrome:20

# Copier les fichiers du projet
COPY . ./

# Installer les dépendances npm
RUN npm install --quiet --only=prod --no-optional && (npm list || true)

