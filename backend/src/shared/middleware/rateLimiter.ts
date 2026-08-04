import rateLimit from 'express-rate-limit';

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);

export const authenticatedLimiter = rateLimit({
  windowMs,
  limit: parseInt(process.env.RATE_LIMIT_MAX_AUTHENTICATED ?? '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

export const publicLimiter = rateLimit({
  windowMs,
  limit: parseInt(process.env.RATE_LIMIT_MAX_PUBLIC ?? '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // max 5 requests per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many password change attempts. Please try again after 15 minutes.' },
});
