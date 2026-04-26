import { PrismaClient, SubscriptionTier, BillingInterval } from '@prisma/client';
import { createHash } from 'crypto';

// ── Subscription plans ──────────────────────────────────────────────────────
// Upload limits: FREE=3, PRO=100, GO_PLUS=1000
// These must stay in sync with FREE_UPLOAD_LIMIT in src/subscriptions/subscriptions.service.ts
const SUBSCRIPTION_PLANS: {
  code: string;
  name: string;
  tier: SubscriptionTier;
  priceCents: number;
  billingInterval: BillingInterval;
  uploadLimit: number;
  features: object;
}[] = [
  {
    code: 'free-monthly',
    name: 'Free',
    tier: SubscriptionTier.FREE,
    priceCents: 0,
    billingInterval: BillingInterval.MONTH,
    uploadLimit: 3,
    features: { adFree: false, offlineListening: false },
  },
  {
    code: 'pro-monthly',
    name: 'Pro Monthly',
    tier: SubscriptionTier.PRO,
    priceCents: 999,
    billingInterval: BillingInterval.MONTH,
    uploadLimit: 100,
    features: { adFree: true, offlineListening: true },
  },
  {
    code: 'go-plus-monthly',
    name: 'Go+ Monthly',
    tier: SubscriptionTier.GO_PLUS,
    priceCents: 1999,
    billingInterval: BillingInterval.MONTH,
    uploadLimit: 1000,
    features: { adFree: true, offlineListening: true },
  },
];

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
  { slug: 'quran', name: 'Quran' },
  { slug: 'sha3by', name: 'Sha3by' },
  { slug: 'islamic', name: 'Islamic' },
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

    // ── Subscription plans ───────────────────────────────────────────────────
    for (const plan of SUBSCRIPTION_PLANS) {
      await prisma.subscriptionPlan.upsert({
        where: { code: plan.code },
        update: {
          name: plan.name,
          priceCents: plan.priceCents,
          uploadLimit: plan.uploadLimit,
          features: plan.features,
          isActive: true,
        },
        create: {
          code: plan.code,
          name: plan.name,
          tier: plan.tier,
          priceCents: plan.priceCents,
          billingInterval: plan.billingInterval,
          uploadLimit: plan.uploadLimit,
          features: plan.features,
          isActive: true,
        },
      });
    }
    console.log(`Seeded ${SUBSCRIPTION_PLANS.length} subscription plans.`);

    const nativeClientId = 'soundclone-native-app';
    const nativeClientSecret =
      process.env.OAUTH_NATIVE_CLIENT_SECRET ?? 'soundclone-native-dev-secret-change-me';
    const nativeClientSecretHash = createHash('sha256')
      .update(nativeClientSecret)
      .digest('hex');

    // OAuth native client seed (idempotent). Keeps existing secret hash on conflict.
    await prisma.$executeRaw`
      INSERT INTO "api_clients" (
        "id",
        "client_id",
        "client_secret_hash",
        "name",
        "description",
        "redirect_uris",
        "allowed_scopes",
        "is_active",
        "rate_limit",
        "rate_limit_window",
        "created_at",
        "updated_at"
      )
      VALUES (
        gen_random_uuid(),
        ${nativeClientId},
        ${nativeClientSecretHash},
        'SoundClone Native App',
        'Public native client for Android and Windows PKCE OAuth flows',
        ARRAY['soundclone://oauth/callback', 'http://127.0.0.1:8080/oauth/callback']::TEXT[],
        ARRAY['openid', 'profile', 'email', 'offline_access']::TEXT[],
        true,
        1000,
        3600,
        NOW(),
        NOW()
      )
      ON CONFLICT ("client_id") DO UPDATE
      SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "redirect_uris" = EXCLUDED."redirect_uris",
        "allowed_scopes" = EXCLUDED."allowed_scopes",
        "is_active" = EXCLUDED."is_active",
        "rate_limit" = EXCLUDED."rate_limit",
        "rate_limit_window" = EXCLUDED."rate_limit_window",
        "updated_at" = NOW();
    `;

    console.log('Ensured OAuth client seed: soundclone-native-app');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
