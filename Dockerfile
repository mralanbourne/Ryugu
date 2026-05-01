FROM node:22-alpine

WORKDIR /usr/src/app

# Kopiere Abhängigkeiten
COPY package*.json ./

# Installiere Produktion-Dependencies
RUN npm install --omit=dev

# Kopiere den kompletten Quellcode (inkl. lib, public, server.js)
COPY . .

# Setze Umgebung auf Produktion
ENV NODE_ENV=production
# Koyeb Standard-Port ist oft 8000, wir bleiben flexibel
ENV PORT=7000

EXPOSE 7000

# Startbefehl über den Express-Server
CMD [ "node", "server.js" ]