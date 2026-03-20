const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const email = process.argv[2];
  if (!email) { console.error("Usage: node verify-user.js <email>"); process.exit(1); }

  const user = await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { isVerified: true },
    select: { email: true, isVerified: true },
  });

  // Also mark all pending verification tokens as consumed
  await prisma.emailVerificationToken.updateMany({
    where: { user: { email: email.toLowerCase() }, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  console.log("✅ Verified:", user.email, "| isVerified:", user.isVerified);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
