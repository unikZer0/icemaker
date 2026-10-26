FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3100 1884
CMD ["node", "server.js"]
