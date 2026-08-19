# Debian base (not -slim) so `playwright install --with-deps` can apt-get
# the OS libraries Chromium needs.
FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Downloads Chromium and its OS dependencies, matching whatever `playwright`
# version is pinned in package-lock.json at build time.
RUN npx playwright install --with-deps chromium

# Long-running scheduler process — not an HTTP server, no EXPOSE needed.
CMD ["node", "index.js"]
