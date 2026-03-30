/**
 * Background Job Queue Service
 * Asynchronous task processing to improve API response times
 * Can use Bull (Redis) or simple in-memory queue for now
 */

const logger = require('./logger');
const { EventEmitter } = require('events');

/**
 * Job Queue implementation
 */
class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.jobs = new Map();
    this.jobId = 0;
    this.workers = options.workers || 5;
    this.processingJobs = new Set();
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Add job to queue
   */
  addJob(jobType, data, options = {}) {
    const jobId = ++this.jobId;
    const job = {
      id: jobId,
      type: jobType,
      data,
      status: 'pending',
      createdAt: Date.now(),
      retries: 0,
      maxRetries: options.maxRetries || this.maxRetries,
      priority: options.priority || 'normal',
      delayMs: options.delayMs || 0,
      callback: options.callback || null
    };

    this.jobs.set(jobId, job);

    logger.info({
      message: 'job_added',
      jobId,
      jobType,
      priority: job.priority
    });

    // Process if not at capacity
    this.processNextJob();

    return jobId;
  }

  /**
   * Process next job in queue
   */
  async processNextJob() {
    if (this.processingJobs.size >= this.workers) {
      return;
    }

    // Find next pending job (sorted by priority)
    let nextJob = null;
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'pending' && Date.now() >= job.createdAt + job.delayMs) {
        if (!nextJob || (job.priority === 'high' && nextJob.priority !== 'high')) {
          nextJob = { id, ...job };
        }
      }
    }

    if (!nextJob) {
      return;
    }

    this.processingJobs.add(nextJob.id);

    try {
      const job = this.jobs.get(nextJob.id);
      job.status = 'processing';

      logger.info({
        message: 'job_processing',
        jobId: nextJob.id,
        jobType: nextJob.type
      });

      // Process job based on type
      await this.processJobByType(nextJob);

      job.status = 'completed';

      logger.info({
        message: 'job_completed',
        jobId: nextJob.id,
        jobType: nextJob.type
      });

      // Emit success event
      this.emit('job:success', { jobId: nextJob.id, type: nextJob.type });

      // Cleanup old jobs
      this.cleanupCompletedJobs();
    } catch (error) {
      const job = this.jobs.get(nextJob.id);
      job.retries++;

      logger.error({
        message: 'job_failed',
        jobId: nextJob.id,
        jobType: nextJob.type,
        error: error.message,
        retries: job.retries
      });

      if (job.retries >= job.maxRetries) {
        job.status = 'failed';
        this.emit('job:failed', { 
          jobId: nextJob.id, 
          type: nextJob.type,
          error: error.message 
        });
      } else {
        // Retry with exponential backoff
        job.status = 'pending';
        job.delayMs = Math.pow(2, job.retries) * 1000;
      }
    } finally {
      this.processingJobs.delete(nextJob.id);
      // Process next job
      setImmediate(() => this.processNextJob());
    }
  }

  /**
   * Process job based on type
   */
  async processJobByType(job) {
    switch (job.type) {
      case 'calculate_quality_metrics':
        return this.calculateQualityMetrics(job);
      case 'generate_ai_summary':
        return this.generateAiSummary(job);
      case 'update_demand_heatmap':
        return this.updateDemandHeatmap(job);
      case 'cleanup_old_logs':
        return this.cleanupOldLogs(job);
      case 'generate_analytics':
        return this.generateAnalytics(job);
      case 'send_notification':
        return this.sendNotification(job);
      default:
        if (job.callback) {
          return await job.callback(job.data);
        }
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  /**
   * Job type handlers
   */
  async calculateQualityMetrics(job) {
    const adminIntel = require('./adminIntelligence');
    const { userId } = job.data;
    await adminIntel.calculateContributorQuality(userId);
  }

  async generateAiSummary(job) {
    const { contribId } = job.data;
    // AI summarization logic
    logger.info({
      message: 'ai_summary_generation',
      contribId
    });
  }

  async updateDemandHeatmap(job) {
    const adminIntel = require('./adminIntelligence');
    const { collegeName, branchId, semesterId } = job.data;
    await adminIntel.updateSubjectDemandHeatmap(collegeName, branchId, semesterId);
  }

  async cleanupOldLogs(job) {
    const { olderThanDays = 30 } = job.data;
    logger.info({
      message: 'cleanup_old_logs',
      olderThanDays
    });
    // Cleanup logic
  }

  async generateAnalytics(job) {
    const { metric, date } = job.data;
    logger.info({
      message: 'analytics_generation',
      metric,
      date
    });
    // Analytics calculation
  }

  async sendNotification(job) {
    const { userId, message, type } = job.data;
    logger.info({
      message: 'notification_sent',
      userId,
      type
    });
    // Notification handling
  }

  /**
   * Cleanup completed jobs (keep last 100)
   */
  cleanupCompletedJobs() {
    const completed = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.status === 'completed')
      .sort((a, b) => b[1].createdAt - a[1].createdAt);

    while (completed.length > 100) {
      const [id] = completed.pop();
      this.jobs.delete(id);
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      retries: job.retries,
      createdAt: job.createdAt
    };
  }

  /**
   * Get queue stats
   */
  getStats() {
    const stats = {
      total: this.jobs.size,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const job of this.jobs.values()) {
      stats[job.status]++;
    }

    return stats;
  }

  /**
   * Start processing jobs (call once on app startup)
   */
  start() {
    // Start processing loop
    const processLoop = () => {
      this.processNextJob();
      setTimeout(processLoop, 100);
    };
    processLoop();

    logger.info({
      message: 'job_queue_started',
      workers: this.workers
    });
  }

  /**
   * Stop processing jobs
   */
  stop() {
    logger.info({
      message: 'job_queue_stopped'
    });
  }
}

/**
 * Scheduled jobs
 */
class JobScheduler {
  constructor(queue) {
    this.queue = queue;
    this.schedules = new Map();
  }

  /**
   * Schedule recurring job
   */
  schedule(jobType, data, intervalMs, options = {}) {
    const scheduleId = `${jobType}_${Date.now()}`;

    const interval = setInterval(() => {
      this.queue.addJob(jobType, data, options);
    }, intervalMs);

    this.schedules.set(scheduleId, interval);

    logger.info({
      message: 'job_scheduled',
      jobType,
      intervalMs
    });

    return scheduleId;
  }

  /**
   * Cancel scheduled job
   */
  cancel(scheduleId) {
    const interval = this.schedules.get(scheduleId);
    if (interval) {
      clearInterval(interval);
      this.schedules.delete(scheduleId);
      logger.info({ message: 'schedule_cancelled', scheduleId });
    }
  }

  /**
   * Setup default schedules
   */
  setupDefaultSchedules() {
    // Calculate quality metrics daily
    this.schedule('calculate_quality_metrics', {}, 24 * 60 * 60 * 1000);

    // Update demand heatmaps daily
    this.schedule('update_demand_heatmap', {}, 24 * 60 * 60 * 1000);

    // Cleanup old logs weekly
    this.schedule('cleanup_old_logs', { olderThanDays: 30 }, 7 * 24 * 60 * 60 * 1000);

    // Generate analytics daily
    this.schedule('generate_analytics', {}, 24 * 60 * 60 * 1000);

    logger.info({ message: 'default_schedules_setup' });
  }
}

/**
 * Initialize job queue
 */
function createJobQueue() {
  const queue = new JobQueue({ workers: 5 });
  const scheduler = new JobScheduler(queue);

  // Setup defaults and start
  scheduler.setupDefaultSchedules();
  queue.start();

  return { queue, scheduler };
}

module.exports = {
  JobQueue,
  JobScheduler,
  createJobQueue
};
