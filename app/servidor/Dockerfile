FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY voz.mjs ./
ENV PUERTO=8080
EXPOSE 8080
CMD ["node", "voz.mjs"]
