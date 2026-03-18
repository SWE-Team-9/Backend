import { PrismaClient } from '@prisma/client';

// Genre slugs must stay in sync with ALLOWED_GENRES in src/users/dto/profile.dto.ts
const GENRES: { slug: string; name: string }[] = [
  { slug: 'electronic', name: 'Electronic' },
  { slug: 'hip-hop', name: 'Hip-Hop' },
  { slug: 'pop', name: 'Pop' },
  { slug: 'rock', name: 'Rock' },
  { slug: 'alternative', name: 'Alternative' },
  { slug: 'ambient', name: 'Ambient' },
  { slug: 'classical', name: 'Classical' },
  { slug: 'jazz', name: 'Jazz' },
  { slug: 'r-b-soul', name: 'R&B / Soul' },
  { slug: 'metal', name: 'Metal' },
  { slug: 'folk-singer-songwriter', name: 'Folk / Singer-Songwriter' },
  { slug: 'country', name: 'Country' },
  { slug: 'reggaeton', name: 'Reggaeton' },
  { slug: 'dancehall', name: 'Dancehall' },
  { slug: 'drum-bass', name: 'Drum & Bass' },
  { slug: 'house', name: 'House' },
  { slug: 'techno', name: 'Techno' },
  { slug: 'deep-house', name: 'Deep House' },
  { slug: 'trance', name: 'Trance' },
  { slug: 'lo-fi', name: 'Lo-Fi' },
  { slug: 'indie', name: 'Indie' },
  { slug: 'punk', name: 'Punk' },
  { slug: 'blues', name: 'Blues' },
  { slug: 'latin', name: 'Latin' },
  { slug: 'afrobeat', name: 'Afrobeat' },
  { slug: 'trap', name: 'Trap' },
  { slug: 'experimental', name: 'Experimental' },
  { slug: 'world', name: 'World' },
  { slug: 'gospel', name: 'Gospel' },
  { slug: 'spoken-word', name: 'Spoken Word' },
];

async function main() {
  const prisma = new PrismaClient();

  try {
    for (const genre of GENRES) {
      await prisma.genre.upsert({
        where: { slug: genre.slug },
        update: { name: genre.name },
        create: { slug: genre.slug, name: genre.name },
      });
    }

    console.log(`Seeded ${GENRES.length} genres.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
