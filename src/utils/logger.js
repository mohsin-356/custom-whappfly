'use strict';

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, errors, json, colorize, printf } = format;

// Console format for development
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    let log = `${ts} [${level}]: ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) log += ` ${JSON.stringify(meta)}`;
    return log;
  })
);

// JSON format for production / file logs
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const fileTransports = [
  // All logs
  new transports.DailyRotateFile({
    filename: path.join(config.logs.basePath, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: `${config.logs.maxFiles}d`,
    maxSize: config.logs.maxSize,
    format: prodFormat,
    level: 'info',
  }),
  // Error logs only
  new transports.DailyRotateFile({
    filename: path.join(config.logs.basePath, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: `${config.logs.maxFiles}d`,
    maxSize: config.logs.maxSize,
    format: prodFormat,
    level: 'error',
  }),
];

const logger = createLogger({
  level: config.logs.level,
  transports: [
    new transports.Console({
      format: config.nodeEnv === 'development' ? devFormat : prodFormat,
    }),
    ...fileTransports,
  ],
  exitOnError: false,
});

module.exports = logger;
