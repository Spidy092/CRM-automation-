import winston from 'winston';

const { combine, timestamp, json, colorize, simple } = winston.format;

const isDev = process.env.NODE_ENV !== 'production';

export function sanitizeUrlForLogging(raw: string): string {
  if (!raw) return raw;
  return raw.replace(
    /([?&](?:ticket|token|access_token|refresh_token|code|apiKey|api_key|secret|password)=)[^&#\s"']+/gi,
    '$1[REDACTED]',
  );
}

export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format: combine(timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), json()),
  transports: [
    new winston.transports.Console({
      format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()),
    }),
  ],
});
