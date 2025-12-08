FROM node:18

# Pasta onde a app vai rodar
WORKDIR /app

# Copia só os arquivos de dependências
COPY pix-server/package*.json ./

# Instala dependências
RUN npm install

# Copia o restante do código
COPY pix-server .

# Porta da aplicação (a Fly vai definir isso)
EXPOSE 3000

# Inicia o servidor
CMD ["node", "index.js"]
