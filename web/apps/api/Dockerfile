FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run prisma:generate
RUN npm run build

EXPOSE 4000
CMD ["sh", "-c", "npm run prisma:deploy && npm run start"]
