# Argus web UI for local self-hosting.

FROM node:24-bookworm-slim AS deps

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build

ARG ARGUS_API_HOST=http://backend:8080
ARG NEXT_PUBLIC_ARGUS_SELF_HOSTED=0
ARG NEXT_PUBLIC_ARGUS_MIROMIND_MODEL=mirothinker-1-7-deepresearch-mini
ENV ARGUS_API_HOST=$ARGUS_API_HOST \
    NEXT_PUBLIC_ARGUS_SELF_HOSTED=$NEXT_PUBLIC_ARGUS_SELF_HOSTED \
    NEXT_PUBLIC_ARGUS_MIROMIND_MODEL=$NEXT_PUBLIC_ARGUS_MIROMIND_MODEL \
    NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
