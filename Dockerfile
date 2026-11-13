# Front: build do Vite e nginx servindo os arquivos estáticos.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# As variáveis VITE_* entram no bundle em tempo de build: o Vite lê o .env.local copiado aqui.
# Elas são públicas por natureza (vão para o navegador); nenhum segredo fica no front.
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
