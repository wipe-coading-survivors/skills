FROM quay.io/fedora/nodejs-22:latest

WORKDIR /app
COPY server/server.mjs server/server.mjs
COPY skills/ ./skills/

EXPOSE 8080
CMD ["node", "server/server.mjs"]
