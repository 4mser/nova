FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY servidor.mjs ./
ENV PUERTO=8080 DATOS=/data
EXPOSE 8080
CMD ["node", "--no-warnings", "servidor.mjs"]
