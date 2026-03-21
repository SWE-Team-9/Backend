/**
 * One-off script — creates a test user + profile for local endpoint testing.
 * Run: node node_modules/ts-node/dist/bin.js prisma/create-test-user.ts
 */
import { PrismaClient, Gender, AccountType, ProfileVisibility } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    // Upsert so re-runs are idempotent
    const user = await prisma.user.upsert({
      where: { email: 'testuser@example.com' },
      update: {},
      create: {
        email: 'testuser@example.com',
        passwordHash: '$2b$10$testhashdoesnotmatter',
        isVerified: true,
        dateOfBirth: new Date('1995-06-15'),
        gender: Gender.MALE,
        profile: {
          create: {
            handle: 'test_user_01',
            displayName: 'Test User',
            bio: 'This is a test bio for endpoint testing.',
            location: 'Cairo, Egypt',
            accountType: AccountType.ARTIST,
            visibility: ProfileVisibility.PUBLIC,
            likesVisible: true,
          },
        },
      },
    });

    // Seed a couple of favorite genres
    const genres = await prisma.genre.findMany({ take: 3 });
    for (let i = 0; i < genres.length; i++) {
      await prisma.userFavoriteGenre.upsert({
        where: { userId_genreId: { userId: user.id, genreId: genres[i].id } },
        update: {},
        create: { userId: user.id, genreId: genres[i].id },
      });
    }

    console.log('Test user created:');
    console.log(`  id    : ${user.id}`);
    console.log(`  email : ${user.email}`);
    console.log(`  handle: test_user_01`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
