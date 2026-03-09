# Avengers Relay - Claude Code Telegram Bots
# Deploy on Railway - one image, multiple services via BOT_ID

FROM oven/bun:1-debian AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates git tini && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI only
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --production

COPY . .

RUN mkdir -p /data/relay /data/temp /data/uploads

ENV RELAY_DIR=/data/relay
ENV NODE_ENV=production

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/relay.ts"]
