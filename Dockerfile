FROM node:20-alpine3.21

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . ./
EXPOSE 3001
CMD ["npm","run","start"]
