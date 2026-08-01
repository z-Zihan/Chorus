FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @agentlink/shared build && pnpm --filter @agentlink/relay build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app/packages/relay
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/relay/node_modules ./node_modules
COPY --from=build /app/packages/relay/dist ./dist
COPY --from=build /app/packages/relay/drizzle ./drizzle
EXPOSE 3211
CMD ["node", "dist/index.js"]
