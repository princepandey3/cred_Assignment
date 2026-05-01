'use strict';

const { prisma } = require('../config/prisma');

/**
 * PostRepository — CRUD + filtered queries for Post records.
 * Soft-delete is implemented at the repository level (deletedAt field).
 */
class PostRepository {
  /**
   * Create a new post (initially DRAFT).
   */
  async create({ userId, idea, postType, tone, language, modelUsed, publishAt }) {
    return prisma.post.create({
      data: { userId, idea, postType, tone, language, modelUsed, publishAt },
      include: { platformPosts: true },
    });
  }

  /**
   * Paginated list of a user's posts, newest first.
   * Excludes soft-deleted posts.
   *
   * @param {string} userId
   * @param {{ page?, limit?, status? }} opts
   */
  async findByUserId(userId, { page = 1, limit = 20, status } = {}) {
    const where = {
      userId,
      deletedAt: null,
      ...(status && { status }),
    };

    const [posts, total] = await prisma.$transaction([
      prisma.post.findMany({
        where,
        include: { platformPosts: { select: { platform: true, status: true, publishedAt: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    return { posts, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /**
   * Single post — validates ownership.
   */
  async findByIdAndUserId(id, userId) {
    return prisma.post.findFirst({
      where: { id, userId, deletedAt: null },
      include: { platformPosts: true },
    });
  }

  /**
   * Update mutable fields (idea, tone, publishAt, status).
   */
  async update(id, userId, data) {
    return prisma.post.update({
      where: { id, userId },
      data,
      include: { platformPosts: true },
    });
  }

  /**
   * Transition the post status (e.g. DRAFT → SCHEDULED).
   */
  async setStatus(id, status) {
    return prisma.post.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Soft-delete — sets deletedAt, does NOT remove the row.
   */
  async softDelete(id, userId) {
    return prisma.post.update({
      where: { id, userId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Find posts scheduled to publish before `cutoff` that are still SCHEDULED.
   * Used by the scheduler / cron job.
   */
  async findDueForPublishing(cutoff = new Date()) {
    return prisma.post.findMany({
      where: {
        status: 'SCHEDULED',
        publishAt: { lte: cutoff },
        deletedAt: null,
      },
      include: {
        platformPosts: { where: { status: { in: ['PENDING', 'FAILED'] } } },
        user: { select: { id: true, email: true } },
      },
    });
  }
}

module.exports = new PostRepository();
