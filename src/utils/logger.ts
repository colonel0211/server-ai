// src/utils/logger.ts

import winston from 'winston';

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug', // Log 'info' and above in production, 'debug' and above in development
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }), // Include stack trace for errors
    winston.format.splat(),
    winston.format.json() // Use JSON format for structured logging
  ),
  defaultMeta: { service: 'youtube-automation-api' },
  transports: [
    // Console transport logs to stdout
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Add colors for console output
        winston.format.printf(({ level, message, service, timestamp, stack }) => {
          if (stack) {
            return `${timestamp} [${service}] ${level}: ${message}\n${stack}`;
          }
          return `${timestamp} [${service}] ${level}: ${message}`;
        })
      )
    }),
    // You can add other transports here, like file logging:
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Export the logger instance
export { logger };
