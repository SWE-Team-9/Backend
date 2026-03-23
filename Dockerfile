FROM node:20

WORKDIR /app

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