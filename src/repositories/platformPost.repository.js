'use strict';

const { prisma } = require('../config/prisma');

const MAX_ATTEMPTS = 3;

/**
 * PlatformPostRepository — manages per-platform publish records.
 * Central to the retry and publishing pipeline.
 */
class PlatformPostRepository {
  /**
   * Bulk-create platform posts for a given Post.
   * Called right after AI content generation.
   *
   * @param {Array<{ postId, socialAccountId, platform, content, metadata? }>} records
   */
  async createMany(records) {
    return prisma.$transaction(
      records.map((r) =>
        prisma.platformPost.create({ data: r })
      )
    );
  }

  /**
   * Upsert — create or update a platform post for a given post + platform pair.
   */
  async upsert({ postId, platform, socialAccountId, content, metadata }) {
    return prisma.platformPost.upsert({
      where: { postId_platform: { postId, platform } },
      create: { postId, platform, socialAccountId, content, metadata },
      update: { content, metadata, socialAccountId, status: 'PENDING' },
    });
  }

  /** All platform posts for a given Post ID. */
  async findByPostId(postId) {
    return prisma.platformPost.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Claim a platform post for publishing — atomically transition PENDING → PUBLISHING.
   * Returns null if the record was already claimed by another worker.
   */
  async claimForPublishing(id) {
    try {
      return await prisma.platformPost.update({
        where: { id, status: 'PENDING' },
        data: {
          status: 'PUBLISHING',
          lastAttemptAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    } catch {
      // Prisma throws P2025 if no row matched the where clause
      return null;
    }
  }

  /**
   * Mark a platform post as successfully published.
   */
  async markPublished(id, externalId) {
    return prisma.platformPost.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        externalId,
        publishedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  /**
   * Mark a platform post as failed.
   * If attempts < MAX_ATTEMPTS, resets to PENDING for retry.
   * Otherwise marks as permanently FAILED.
   */
  async markFailed(id, errorMessage) {
    const current = await prisma.platformPost.findUnique({
      where: { id },
      select: { attempts: true },
    });

    const isFinal = !current || current.attempts >= MAX_ATTEMPTS;

    return prisma.platformPost.update({
      where: { id },
      data: {
        status: isFinal ? 'FAILED' : 'PENDING',
        errorMessage,
      },
    });
  }

  /**
   * Find retryable failed posts (PENDING, under max attempts).
   * Used by the retry worker / cron.
   */
  async findRetryable() {
    return prisma.platformPost.findMany({
      where: {
        status: 'PENDING',
        attempts: { lt: MAX_ATTEMPTS },
      },
      include: {
        post: { select: { userId: true, status: true } },
        socialAccount: true,
      },
      orderBy: { lastAttemptAt: 'asc' },
    });
  }

  /** Stats grouped by platform and status for a user. */
  async getStatsByUser(userId) {
    return prisma.platformPost.groupBy({
      by: ['platform', 'status'],
      where: { post: { userId } },
      _count: { id: true },
    });
  }
}

module.exports = new PlatformPostRepository();
