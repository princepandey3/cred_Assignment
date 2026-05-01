'use strict';

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create a demo user (password: "Password123!")
  // In production, use bcrypt. Here we use a simple SHA-256 for seed purposes.
  const passwordHash = crypto.createHash('sha256').update('Password123!').digest('hex');

  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      passwordHash,
      name: 'Demo User',
      bio: 'AI content creator. Building in public.',
      defaultTone: 'PROFESSIONAL',
      defaultLanguage: 'EN',
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`✓ User: ${user.email} (${user.id})`);

  // Create a sample post
  const post = await prisma.post.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      userId: user.id,
      idea: 'Write a thread about the top 5 benefits of using TypeScript in 2024',
      postType: 'THREAD',
      tone: 'EDUCATIONAL',
      language: 'EN',
      modelUsed: 'claude-3-5-sonnet-20241022',
      status: 'DRAFT',
    },
  });

  console.log(`✓ Post: ${post.id} (${post.status})`);
  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
