# Use Playwright Chrome image for browser-based scraping
# TikTok requires JavaScript execution - HTTP-only approach gets blocked
FROM apify/actor-node-playwright-chrome:20

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --omit=optional \
    && echo "Dependencies installed."

# Copy source code
COPY . ./

# Run the actor
CMD ["npm", "start"]
