FROM node:20-bookworm-slim

WORKDIR /app

# Instalar dependencias primero (mejor cacheo)
COPY package.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

# Carpeta de datos persistente (se monta como volumen en EasyPanel)
ENV DATA_DIR=/app/data
ENV PORT=3000
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
