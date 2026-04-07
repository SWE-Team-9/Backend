FROM node:20

WORKDIR /app

# install system dependencies (added for audio processing)
RUN apt-get update && apt-get install -y ffmpeg

# copy dependencies
COPY package*.json ./

# install dependencies
RUN npm install

# copy source code
COPY . .

# generate prisma client
RUN npx prisma generate

EXPOSE 3006

# migrate + seed (idempotent) then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && npm run start:dev"]
