# Official Node images are published for linux/arm64 and linux/amd64.
# Mac mini Docker should build or pull linux/arm64. No native addons.
FROM node:22-bookworm-slim

WORKDIR /app

COPY how-llms-work/package.json how-llms-work/server.mjs how-llms-work/auth.mjs how-llms-work/base-path.mjs ./
COPY how-llms-work/auth-ui ./auth-ui
COPY how-llms-work/index.html ./index.html
COPY how-llms-work/assets ./assets
COPY how-llms-work/mlx-core.opt.wasm ./mlx-core.opt.wasm
COPY how-llms-work/model ./model

RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    BASE_PATH=/how-LLM-works \
    AUTH_DATA_DIR=/data \
    REQUIRE_AUTH=0 \
    ALLOW_UPSTREAM_MODEL=0 \
    TRUST_PROXY=1

EXPOSE 8080
VOLUME ["/data"]
USER node

CMD ["node", "server.mjs"]
