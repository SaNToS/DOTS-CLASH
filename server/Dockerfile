# syntax=docker/dockerfile:1
FROM node:20-slim

# Install OpenSSL required by Prisma
RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

# Generate Prisma Client
RUN npx prisma generate

EXPOSE 3001

# The start script can run migrations before starting
CMD ["sh", "-c", "npx prisma db push && node index.js"]
