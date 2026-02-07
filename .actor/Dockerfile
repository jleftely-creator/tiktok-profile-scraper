# Use Node.js 20 base image (required for ES modules and modern packages)
FROM apify/actor-node:20

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --omit=optional \
    && echo "Dependencies installed."

# Copy source code
COPY . ./

# Run the actor
CMD ["npm", "start"]
