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

EXPOSE 3000

CMD ["npm", "run", "start:dev"]