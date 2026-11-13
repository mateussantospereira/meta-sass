FROM oven/bun:latest
WORKDIR /app

# Contexto de build do APP MetaSass. O .dockerignore da raiz exclui os outros
# microsservicos: sao unidades de deploy separadas.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
EXPOSE 8222
CMD ["bun", "run", "src/index.ts"]
