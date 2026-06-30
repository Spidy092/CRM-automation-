"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openWAHealthResponseSchema = exports.openWASendResponseSchema = exports.openWASendRequestSchema = exports.openWACredentialsSchema = exports.antiBanConfigSchema = exports.openWANumberConfigSchema = void 0;
exports.isOpenWACredentials = isOpenWACredentials;
var zod_1 = require("zod");
exports.openWANumberConfigSchema = zod_1.z.object({
    number: zod_1.z.string().min(1),
    dailyCount: zod_1.z.number().int().min(0),
    hourlyCount: zod_1.z.number().int().min(0),
    lastSentAt: zod_1.z.string().datetime().nullable(),
    warmupSent: zod_1.z.number().int().min(0),
    cooldownUntil: zod_1.z.string().datetime().nullable(),
});
exports.antiBanConfigSchema = zod_1.z.object({
    rateLimitPerHour: zod_1.z.number().int().min(1),
    rateLimitPerDay: zod_1.z.number().int().min(1),
    jitterMinMs: zod_1.z.number().int().min(0),
    jitterMaxMs: zod_1.z.number().int().min(0),
    warmupMax: zod_1.z.number().int().min(0),
    cooldownMinutes: zod_1.z.number().int().min(0),
    enabled: zod_1.z.boolean(),
});
exports.openWACredentialsSchema = zod_1.z.object({
    baseUrl: zod_1.z.string().url(),
    apiKey: zod_1.z.string().min(1),
    sessionId: zod_1.z.string().min(1),
    numbers: zod_1.z.array(zod_1.z.string().min(1)),
    antiBan: exports.antiBanConfigSchema.optional(),
});
/**
 * Runtime type guard for OpenWA credentials.
 *
 * @param value - Any value to validate.
 * @returns True when the value matches the OpenWACredentials shape.
 */
function isOpenWACredentials(value) {
    return exports.openWACredentialsSchema.safeParse(value).success;
}
exports.openWASendRequestSchema = zod_1.z.object({
    chatId: zod_1.z.string().min(1),
    text: zod_1.z.string().min(1),
});
exports.openWASendResponseSchema = zod_1.z.object({
    messageId: zod_1.z.string().min(1),
    timestamp: zod_1.z.number().int(),
});
exports.openWAHealthResponseSchema = zod_1.z.object({
    status: zod_1.z.string().min(1),
    session: zod_1.z.string().optional(),
    error: zod_1.z.string().optional(),
});
