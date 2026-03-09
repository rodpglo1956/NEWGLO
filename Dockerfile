# Avengers Relay - Claude Code Telegram Bot Fleet
# Deploy on Railway - one image, multiple services via BOT_ID

FROM oven/bun:1-debian AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates git tini && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI and Composio MCP
RUN npm install -g @anthropic-ai/claude-code composio-mcp@latest

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --production

COPY . .

# Set up Claude Code MCP config
RUN mkdir -p /root/.claude
COPY .claude/mcp.json /root/.claude/mcp.json

RUN mkdir -p /data/relay /data/temp /data/uploads

ENV RELAY_DIR=/data/relay
ENV NODE_ENV=production

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/relay.ts"]
