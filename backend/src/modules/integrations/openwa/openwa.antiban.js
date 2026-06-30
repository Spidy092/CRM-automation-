"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAntiBanConfig = buildAntiBanConfig;
exports.jitter = jitter;
exports.rateLimit = rateLimit;
exports.warmup = warmup;
exports.cooldown = cooldown;
exports.rotateNumber = rotateNumber;
exports.createMemoryStateRepository = createMemoryStateRepository;
exports.createStateRepository = createStateRepository;
var ioredis_1 = __importDefault(require("ioredis"));
var DEFAULT_CONFIG = {
    rateLimitPerHour: 20,
    rateLimitPerDay: 100,
    jitterMinMs: 1000,
    jitterMaxMs: 5000,
    warmupMax: 10,
    cooldownMinutes: 60,
    enabled: true,
};
var DEFAULT_NUMBER_STATE = {
    number: '',
    dailyCount: 0,
    hourlyCount: 0,
    lastSentAt: null,
    warmupSent: 0,
    cooldownUntil: null,
};
/**
 * Build a complete anti-ban config from partial input, applying safe defaults.
 *
 * @param input - Partial anti-ban configuration overrides.
 * @returns A fully populated AntiBanConfig.
 */
function buildAntiBanConfig(input) {
    var _a, _b, _c, _d, _e, _f, _g;
    var config = {
        rateLimitPerHour: (_a = input === null || input === void 0 ? void 0 : input.rateLimitPerHour) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG.rateLimitPerHour,
        rateLimitPerDay: (_b = input === null || input === void 0 ? void 0 : input.rateLimitPerDay) !== null && _b !== void 0 ? _b : DEFAULT_CONFIG.rateLimitPerDay,
        jitterMinMs: (_c = input === null || input === void 0 ? void 0 : input.jitterMinMs) !== null && _c !== void 0 ? _c : DEFAULT_CONFIG.jitterMinMs,
        jitterMaxMs: (_d = input === null || input === void 0 ? void 0 : input.jitterMaxMs) !== null && _d !== void 0 ? _d : DEFAULT_CONFIG.jitterMaxMs,
        warmupMax: (_e = input === null || input === void 0 ? void 0 : input.warmupMax) !== null && _e !== void 0 ? _e : DEFAULT_CONFIG.warmupMax,
        cooldownMinutes: (_f = input === null || input === void 0 ? void 0 : input.cooldownMinutes) !== null && _f !== void 0 ? _f : DEFAULT_CONFIG.cooldownMinutes,
        enabled: (_g = input === null || input === void 0 ? void 0 : input.enabled) !== null && _g !== void 0 ? _g : DEFAULT_CONFIG.enabled,
    };
    if (config.jitterMinMs > config.jitterMaxMs) {
        config.jitterMaxMs = config.jitterMinMs;
    }
    return config;
}
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
/**
 * Wait for a random duration between minMs and maxMs (inclusive).
 *
 * @param minMs - Minimum delay in milliseconds.
 * @param maxMs - Maximum delay in milliseconds.
 * @returns A promise that resolves after the random delay.
 */
function jitter(minMs, maxMs) {
    return __awaiter(this, void 0, void 0, function () {
        var delay;
        return __generator(this, function (_a) {
            delay = minMs >= maxMs ? minMs : randomInt(minMs, maxMs);
            return [2 /*return*/, new Promise(function (resolve) {
                    setTimeout(resolve, delay);
                })];
        });
    });
}
/**
 * Check whether the given number is allowed to send a message under rate limits
 * and active cooldown. If allowed, the caller must invoke the increment callback.
 *
 * @param args - Rate limit check arguments.
 * @returns Whether the send is allowed and the reason if blocked.
 */
function rateLimit(args) {
    return __awaiter(this, void 0, void 0, function () {
        var credentials, getState, increment, _a, now, config, state;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    credentials = args.credentials, getState = args.getState, increment = args.increment, _a = args.now, now = _a === void 0 ? new Date() : _a;
                    config = buildAntiBanConfig(credentials.antiBan);
                    return [4 /*yield*/, getState()];
                case 1:
                    state = _b.sent();
                    if (state.cooldownUntil && new Date(state.cooldownUntil) > now) {
                        return [2 /*return*/, { allowed: false, reason: 'cooldown' }];
                    }
                    if (state.hourlyCount >= config.rateLimitPerHour) {
                        return [2 /*return*/, { allowed: false, reason: 'rate_limit' }];
                    }
                    if (state.dailyCount >= config.rateLimitPerDay) {
                        return [2 /*return*/, { allowed: false, reason: 'rate_limit' }];
                    }
                    return [4 /*yield*/, increment()];
                case 2:
                    _b.sent();
                    return [2 /*return*/, { allowed: true }];
            }
        });
    });
}
function warmupDelay(sent) {
    return Math.min(300000, (sent + 1) * 30000);
}
/**
 * Determine whether a number has completed its warm-up phase and suggest a
 * progressive delay between warm-up messages.
 *
 * @param args - Warm-up check arguments.
 * @returns Whether the send is allowed and an optional advisory delay.
 */
function warmup(args) {
    return __awaiter(this, void 0, void 0, function () {
        var credentials, getState, config, state;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    credentials = args.credentials, getState = args.getState;
                    config = buildAntiBanConfig(credentials.antiBan);
                    return [4 /*yield*/, getState()];
                case 1:
                    state = _a.sent();
                    if (state.warmupSent >= config.warmupMax) {
                        return [2 /*return*/, { allowed: true }];
                    }
                    return [2 /*return*/, { allowed: true, delayMs: warmupDelay(state.warmupSent) }];
            }
        });
    });
}
/**
 * Place the number into cooldown until the configured number of minutes from now.
 *
 * @param args - Cooldown arguments.
 * @returns A promise that resolves once cooldownUntil is persisted.
 */
function cooldown(args) {
    return __awaiter(this, void 0, void 0, function () {
        var credentials, persist, minutes, _a, now, config, cooldownMinutes, cooldownUntil;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    credentials = args.credentials, persist = args.persist, minutes = args.minutes, _a = args.now, now = _a === void 0 ? new Date() : _a;
                    config = buildAntiBanConfig(credentials.antiBan);
                    cooldownMinutes = minutes !== null && minutes !== void 0 ? minutes : config.cooldownMinutes;
                    cooldownUntil = new Date(now.getTime() + cooldownMinutes * 60000).toISOString();
                    return [4 /*yield*/, persist({ cooldownUntil: cooldownUntil })];
                case 1:
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Rotate sender numbers using least-recently-used selection.
 *
 * @param args - Rotation arguments.
 * @returns The selected number, or null when all numbers are excluded.
 */
function rotateNumber(args) {
    var _a;
    var numbers = args.numbers, lastUsedAt = args.lastUsedAt, _b = args.excludeCooldown, excludeCooldown = _b === void 0 ? new Set() : _b;
    var candidates = numbers.filter(function (n) { return !excludeCooldown.has(n); });
    if (candidates.length === 0) {
        return { number: null };
    }
    candidates.sort(function (a, b) {
        var _a, _b, _c, _d;
        var timeA = (_b = (_a = lastUsedAt.get(a)) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : Number.NEGATIVE_INFINITY;
        var timeB = (_d = (_c = lastUsedAt.get(b)) === null || _c === void 0 ? void 0 : _c.getTime()) !== null && _d !== void 0 ? _d : Number.NEGATIVE_INFINITY;
        return timeA - timeB;
    });
    return { number: (_a = candidates[0]) !== null && _a !== void 0 ? _a : null };
}
function buildMemoryKey(integrationId, number) {
    return "".concat(integrationId, ":").concat(number);
}
/**
 * Create an in-memory state repository for testing or fallback usage.
 *
 * @returns A NumberStateRepository backed by an in-memory Map.
 */
function createMemoryStateRepository() {
    var store = new Map();
    return {
        get: function (integrationId, number) {
            var key = buildMemoryKey(integrationId, number);
            var existing = store.get(key);
            if (existing) {
                return Promise.resolve(existing);
            }
            var fresh = __assign(__assign({}, DEFAULT_NUMBER_STATE), { number: number });
            store.set(key, fresh);
            return Promise.resolve(fresh);
        },
        set: function (integrationId, number, state) {
            var _a;
            var key = buildMemoryKey(integrationId, number);
            var existing = (_a = store.get(key)) !== null && _a !== void 0 ? _a : __assign(__assign({}, DEFAULT_NUMBER_STATE), { number: number });
            store.set(key, __assign(__assign({}, existing), state));
            return Promise.resolve();
        },
    };
}
function buildRedisKey(integrationId, number) {
    return "openwa:".concat(integrationId, ":").concat(number);
}
function createRedisStateRepository(client) {
    return {
        get: function (integrationId, number) {
            return __awaiter(this, void 0, void 0, function () {
                var key, raw, parsed;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            key = buildRedisKey(integrationId, number);
                            return [4 /*yield*/, client.get(key)];
                        case 1:
                            raw = _a.sent();
                            if (raw) {
                                parsed = JSON.parse(raw);
                                return [2 /*return*/, __assign(__assign(__assign({}, DEFAULT_NUMBER_STATE), parsed), { number: number })];
                            }
                            return [2 /*return*/, __assign(__assign({}, DEFAULT_NUMBER_STATE), { number: number })];
                    }
                });
            });
        },
        set: function (integrationId, number, state) {
            return __awaiter(this, void 0, void 0, function () {
                var key, existing, merged;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            key = buildRedisKey(integrationId, number);
                            return [4 /*yield*/, this.get(integrationId, number)];
                        case 1:
                            existing = _a.sent();
                            merged = __assign(__assign({}, existing), state);
                            return [4 /*yield*/, client.set(key, JSON.stringify(merged))];
                        case 2:
                            _a.sent();
                            return [2 /*return*/];
                    }
                });
            });
        },
    };
}
/**
 * Create a state repository. Uses Redis when REDIS_URL is configured; otherwise
 * falls back to an in-memory Map so tests can run without Redis.
 *
 * @returns A NumberStateRepository.
 */
function createStateRepository() {
    var redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
        var client = new ioredis_1.default(redisUrl);
        return createRedisStateRepository(client);
    }
    return createMemoryStateRepository();
}
