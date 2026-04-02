/**
 * Structured Logging Service
 * Production-grade logging with proper levels and context
 */

const fs = require('fs');
const path = require('path');

const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|authorization)/i;

function redactSensitiveValue(value) {
  const text = String(value || '');
  if (!text) return text;
  if (text.length <= 8) return '***';
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(4, text.length - 6))}${text.slice(-4)}`;
}

function sanitizeForLog(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 6) return '[Redacted]';

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        acc[key] = redactSensitiveValue(entry);
      } else {
        acc[key] = sanitizeForLog(entry, depth + 1);
      }
      return acc;
    }, {});
  }

  return value;
}

class Logger {
  constructor(serviceName = 'college-os', options = {}) {
    this.serviceName = serviceName;
    this.level = options.level || process.env.LOG_LEVEL || 'info';
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.format = options.format || 'json'; // 'json' or 'text'

    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      critical: 4
    };

    this.currentLevel = this.levels[this.level] || this.levels.info;

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.currentLogFile = null;
    this.initializeLogFile();
  }

  /**
   * Initialize log file with date rotation
   */
  initializeLogFile() {
    const date = new Date().toISOString().split('T')[0];
    this.currentLogFile = path.join(this.logDir, `${date}.log`);
  }

  /**
   * Log message with context
   */
  log(level, message, context = {}) {
    if (this.levels[level] < this.currentLevel) {
      return; // Skip logs below current level
    }

    // Initialize log file if new day
    const date = new Date().toISOString().split('T')[0];
    if (!this.currentLogFile.includes(date)) {
      this.initializeLogFile();
    }

    // Build log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level: level.toUpperCase(),
      message,
      ...sanitizeForLog(context),
      pid: process.pid
    };

    // Format output
    const output = this.format === 'json' 
      ? JSON.stringify(logEntry)
      : this.formatText(logEntry);

    // Log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(output);
    }

    // Write to file
    this.writeToFile(output);
  }

  /**
   * Format log as text
   */
  formatText(entry) {
    return `[${entry.timestamp}] [${entry.level}] [${entry.service}] ${entry.message}`;
  }

  /**
   * Write log to file
   */
  writeToFile(message) {
    try {
      // Check file size and rotate if needed
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size > this.maxFileSize) {
          this.rotateLogFile();
        }
      }

      fs.appendFileSync(this.currentLogFile, message + '\n');
    } catch (error) {
      // Fallback to console if file write fails
      console.error('Failed to write log:', error.message);
    }
  }

  /**
   * Rotate log file when size exceeds limit
   */
  rotateLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const newName = this.currentLogFile.replace('.log', `-${timestamp}.log`);
    fs.renameSync(this.currentLogFile, newName);
  }

  /**
   * Log levels
   */
  debug(message, context) {
    this.log('debug', message, context);
  }

  info(message, context = {}) {
    // Handle object as message
    if (typeof message === 'object') {
      this.log('info', message.message || JSON.stringify(message), message);
    } else {
      this.log('info', message, context);
    }
  }

  warn(message, context = {}) {
    if (typeof message === 'object') {
      this.log('warn', message.message || JSON.stringify(message), message);
    } else {
      this.log('warn', message, context);
    }
  }

  error(message, context = {}) {
    if (typeof message === 'object') {
      this.log('error', message.message || JSON.stringify(message), message);
    } else {
      this.log('error', message, context);
    }
  }

  critical(message, context = {}) {
    if (typeof message === 'object') {
      this.log('critical', message.message || JSON.stringify(message), message);
    } else {
      this.log('critical', message, context);
    }
  }
}

/**
 * Specialized loggers for different domains
 */
class ApiLogger extends Logger {
  logRequest(req, res, duration) {
    // Only log if duration > 100ms or status >= 400
    if (duration <= 100 && res.statusCode < 400) {
      return;
    }

    this.info({
      message: 'http_request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      userId: req.user?.id,
      ip: req.ip,
      requestId: req.id
    });
  }

  logError(error, req, context = {}) {
    this.error({
      message: error.message,
      code: error.code || 'INTERNAL_ERROR',
      status: error.statusCode || 500,
      stack: error.stack,
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      ip: req.ip,
      requestId: req.id,
      ...context
    });
  }
}

class DatabaseLogger extends Logger {
  logQuery(query, duration, params = []) {
    if (duration > 1000) {
      // Log slow queries
      this.warn({
        message: 'slow_query',
        query: query.substring(0, 200),
        duration,
        paramCount: params.length
      });
    }
  }

  logError(error, query, context = {}) {
    this.error({
      message: 'database_error',
      error: error.message,
      query: query.substring(0, 200),
      ...context
    });
  }
}

class AdminLogger extends Logger {
  logAction(action, details) {
    this.info({
      message: 'admin_action',
      action,
      adminId: details.adminId,
      targetUserId: details.targetUserId,
      targetResourceId: details.targetResourceId,
      changes: details.changes,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Create singleton instances
 */
const createLoggers = () => {
  const serviceName = 'college-os';
  
  return {
    app: new Logger(serviceName, { level: process.env.LOG_LEVEL || 'info' }),
    api: new ApiLogger(`${serviceName}-api`),
    db: new DatabaseLogger(`${serviceName}-db`),
    admin: new AdminLogger(`${serviceName}-admin`)
  };
};

// Initialize on module load
const loggers = createLoggers();

module.exports = loggers.app; // Default export
module.exports.ApiLogger = ApiLogger;
module.exports.DatabaseLogger = DatabaseLogger;
module.exports.AdminLogger = AdminLogger;
module.exports.createLoggers = createLoggers;
