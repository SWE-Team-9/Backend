const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.user.count();
  const users = await prisma.user.findMany({
    select: { email: true, isVerified: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log("Total users:", count);
  users.forEach(u => console.log(" -", u.email, "| verified:", u.isVerified));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
