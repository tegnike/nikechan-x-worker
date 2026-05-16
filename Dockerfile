FROM node:22-slim

USER root
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    jq \
    python3 \
    python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir hermes-agent mcp \
    && rm -rf /var/lib/apt/lists/*

COPY docker-entrypoint.sh /usr/local/bin/nikechan-x-worker-entrypoint
RUN chmod +x /usr/local/bin/nikechan-x-worker-entrypoint

USER root
WORKDIR /worker

ENV HERMES_HOME=/home/node/.hermes
ENV NIKECHAN_X_WORKER_HOST=0.0.0.0
ENV NIKECHAN_X_WORKER_PORT=8787

ENTRYPOINT ["nikechan-x-worker-entrypoint"]
CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0", "--port", "8787"]
