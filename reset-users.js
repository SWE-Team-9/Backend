// Deletes all users and their cascading data from the database (dev reset)
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  // Use TRUNCATE CASCADE to remove all user-related data regardless of FK order
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users" CASCADE`);
  const remaining = await prisma.user.count();
  console.log("Done. Users remaining:", remaining);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
