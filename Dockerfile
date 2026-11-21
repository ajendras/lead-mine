FROM mcr.microsoft.com/playwright:v1.44.1-jammy

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production

USER root

WORKDIR /app

# Copy all source (build happens automatically via prepare script on npm install)
COPY . .

# Install globally so the "lead-mine" binary is immediately available in PATH.
# The prepare script runs "npm run build" so the dist/ folder is ready.
RUN npm install -g .

# Ensure config directory exists with open permissions (for mounted volumes)
RUN mkdir -p /root/.leadmine && chmod 777 /root/.leadmine

ENTRYPOINT ["lead-mine"]
CMD ["--help"]
