"use strict";
/**
 * OpenWA HTTP connector.
 *
 * Implements the shared connector interface and composes the anti-ban helpers
 * (rate-limiting, warm-up, cooldown, number rotation) from openwa.antiban.
 *
 * Endpoints (OpenWA):
 *   Send message: POST {baseUrl}/api/sessions/{sessionId}/messages/send-text
 *   Health check: GET  {baseUrl}/api/sessions/{sessionId}/health
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCredentials = loadCredentials;
exports.sendMessage = sendMessage;
exports.healthCheck = healthCheck;
exports.verifyWebhook = verifyWebhook;
var errorHandler_1 = require("../../../shared/middleware/errorHandler");
var connector_base_1 = require("../connector.base");
var openwa_types_1 = require("./openwa.types");
var openwa_antiban_1 = require("./openwa.antiban");
var OPENWA_CHANNEL = 'openwa';
var DEFAULT_INTEGRATION_KEY = 'default';
/**
 * Loads and validates raw OpenWA credentials.
 *
 * Throws AppError(422) when the shape is invalid, numbers are empty, or the
 * base URL does not use http/https. No network call is performed.
 */
// eslint-disable-next-line @typescript-eslint/require-await
function loadCredentials(input) {
    return __awaiter(this, void 0, void 0, function () {
        var parsed, credentials;
        return __generator(this, function (_a) {
            parsed = openwa_types_1.openWACredentialsSchema.safeParse(input);
            if (!parsed.success) {
                throw new errorHandler_1.AppError("OpenWA credentials invalid: ".concat(parsed.error.errors.map(function (e) { return e.message; }).join(', ')), 422);
            }
            credentials = parsed.data;
            if (!credentials.baseUrl.toLowerCase().startsWith('http://') &&
                !credentials.baseUrl.toLowerCase().startsWith('https://')) {
                throw new errorHandler_1.AppError('OpenWA baseUrl must start with http:// or https://', 422);
            }
            if (credentials.numbers.length === 0) {
                throw new errorHandler_1.AppError('OpenWA credentials must include at least one sender number', 422);
            }
            credentials.antiBan = (0, openwa_antiban_1.buildAntiBanConfig)(credentials.antiBan);
            return [2 /*return*/, credentials];
        });
    });
}
/**
 * Sends a text message through OpenWA using the anti-ban helpers.
 *
 * Never throws for HTTP failures — returns a ConnectorResult instead.
 */
function sendMessage(input) {
    return __awaiter(this, void 0, void 0, function () {
        var credentials, leadId, campaignId, to, body, integrationId, config, repo, integrationKey, now, chatId, lastUsedAt, activeCooldown, numberUsed, excluded, attempt, _loop_1, state_1, url, res, bodyText, isBlockOrBan, nonRetryable;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    credentials = input.credentials, leadId = input.leadId, campaignId = input.campaignId, to = input.to, body = input.body, integrationId = input.integrationId;
                    config = (0, openwa_antiban_1.buildAntiBanConfig)(credentials.antiBan);
                    repo = (0, openwa_antiban_1.createStateRepository)();
                    integrationKey = integrationId !== null && integrationId !== void 0 ? integrationId : DEFAULT_INTEGRATION_KEY;
                    now = new Date();
                    chatId = to.endsWith('@c.us') ? to : "".concat(to.replace(/[^0-9]/g, ''), "@c.us");
                    lastUsedAt = new Map();
                    activeCooldown = new Set();
                    return [4 /*yield*/, Promise.all(credentials.numbers.map(function (number) { return __awaiter(_this, void 0, void 0, function () {
                            var state;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, repo.get(integrationKey, number)];
                                    case 1:
                                        state = _a.sent();
                                        if (state.lastSentAt) {
                                            lastUsedAt.set(number, new Date(state.lastSentAt));
                                        }
                                        if (state.cooldownUntil && new Date(state.cooldownUntil) > now) {
                                            activeCooldown.add(number);
                                        }
                                        return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 1:
                    _a.sent();
                    numberUsed = null;
                    excluded = new Set(activeCooldown);
                    attempt = 0;
                    _loop_1 = function () {
                        var rotation, number, state, rateResult, warmupResult, antiBanReason;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    rotation = (0, openwa_antiban_1.rotateNumber)({
                                        numbers: credentials.numbers,
                                        lastUsedAt: lastUsedAt,
                                        excludeCooldown: excluded,
                                        now: now,
                                    });
                                    if (!rotation.number) {
                                        return [2 /*return*/, { value: {
                                                    ok: false,
                                                    status: 429,
                                                    error: 'All OpenWA sender numbers are cooling down',
                                                    latencyMs: 0,
                                                    retryable: false,
                                                } }];
                                    }
                                    number = rotation.number;
                                    return [4 /*yield*/, repo.get(integrationKey, number)];
                                case 1:
                                    state = _b.sent();
                                    return [4 /*yield*/, (0, openwa_antiban_1.rateLimit)({
                                            number: number,
                                            credentials: credentials,
                                            getState: function () { return Promise.resolve(state); },
                                            increment: function () { return __awaiter(_this, void 0, void 0, function () {
                                                return __generator(this, function (_a) {
                                                    switch (_a.label) {
                                                        case 0: return [4 /*yield*/, repo.set(integrationKey, number, {
                                                                dailyCount: state.dailyCount + 1,
                                                                hourlyCount: state.hourlyCount + 1,
                                                                lastSentAt: now.toISOString(),
                                                                warmupSent: state.warmupSent + 1,
                                                            })];
                                                        case 1:
                                                            _a.sent();
                                                            return [2 /*return*/];
                                                    }
                                                });
                                            }); },
                                            now: now,
                                        })];
                                case 2:
                                    rateResult = _b.sent();
                                    return [4 /*yield*/, (0, openwa_antiban_1.warmup)({
                                            number: number,
                                            credentials: credentials,
                                            getState: function () { return Promise.resolve(state); },
                                            now: now,
                                        })];
                                case 3:
                                    warmupResult = _b.sent();
                                    antiBanReason = !rateResult.allowed
                                        ? rateResult.reason
                                        : !warmupResult.allowed
                                            ? warmupResult.reason
                                            : undefined;
                                    if (!antiBanReason) return [3 /*break*/, 5];
                                    if (attempt === 1) {
                                        return [2 /*return*/, { value: {
                                                    ok: false,
                                                    status: 429,
                                                    error: "OpenWA anti-ban rejected send: ".concat(antiBanReason),
                                                    latencyMs: 0,
                                                    retryable: false,
                                                } }];
                                    }
                                    return [4 /*yield*/, (0, openwa_antiban_1.jitter)(config.jitterMinMs, config.jitterMaxMs)];
                                case 4:
                                    _b.sent();
                                    excluded.add(number);
                                    attempt++;
                                    return [2 /*return*/, "continue"];
                                case 5:
                                    if (!warmupResult.delayMs) return [3 /*break*/, 7];
                                    return [4 /*yield*/, (0, openwa_antiban_1.jitter)(warmupResult.delayMs, warmupResult.delayMs)];
                                case 6:
                                    _b.sent();
                                    _b.label = 7;
                                case 7:
                                    numberUsed = number;
                                    return [2 /*return*/, "break"];
                            }
                        });
                    };
                    _a.label = 2;
                case 2:
                    if (!(attempt < 2)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1()];
                case 3:
                    state_1 = _a.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    if (state_1 === "break")
                        return [3 /*break*/, 4];
                    return [3 /*break*/, 2];
                case 4:
                    if (!numberUsed) {
                        return [2 /*return*/, {
                                ok: false,
                                status: 429,
                                error: 'OpenWA anti-ban prevented send after retry',
                                latencyMs: 0,
                                retryable: false,
                            }];
                    }
                    return [4 /*yield*/, (0, openwa_antiban_1.jitter)(config.jitterMinMs, config.jitterMaxMs)];
                case 5:
                    _a.sent();
                    url = "".concat(credentials.baseUrl, "/api/sessions/").concat(encodeURIComponent(credentials.sessionId), "/messages/send-text");
                    return [4 /*yield*/, (0, connector_base_1.loggedFetch)(url, {
                            method: 'POST',
                            headers: {
                                'x-api-key': credentials.apiKey,
                                'content-type': 'application/json',
                            },
                            body: JSON.stringify({ chatId: chatId, text: body }),
                        }, {
                            channel: OPENWA_CHANNEL,
                            leadId: leadId,
                            campaignId: campaignId,
                            context: { to: maskPhone(to), numberUsed: numberUsed },
                        })];
                case 6:
                    res = _a.sent();
                    if (!!res.ok) return [3 /*break*/, 9];
                    bodyText = res.error;
                    isBlockOrBan = /block|ban/i.test(bodyText);
                    nonRetryable = res.status === 401 || res.status === 403 || res.status === 404 || isBlockOrBan;
                    if (!(nonRetryable && integrationId)) return [3 /*break*/, 8];
                    return [4 /*yield*/, (0, openwa_antiban_1.cooldown)({
                            number: numberUsed,
                            credentials: credentials,
                            persist: function (patch) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, repo.set(integrationKey, numberUsed, patch)];
                            }); }); },
                            now: new Date(),
                        })];
                case 7:
                    _a.sent();
                    _a.label = 8;
                case 8: return [2 /*return*/, {
                        ok: false,
                        status: res.status,
                        error: bodyText,
                        latencyMs: res.latencyMs,
                        retryable: nonRetryable ? false : res.retryable,
                    }];
                case 9: return [2 /*return*/, {
                        ok: true,
                        status: res.status,
                        data: { messageId: res.data.messageId, numberUsed: numberUsed },
                        externalId: res.data.messageId,
                        latencyMs: res.latencyMs,
                    }];
            }
        });
    });
}
/**
 * Performs a health check against the configured OpenWA session.
 *
 * Never throws for HTTP failures.
 */
function healthCheck(input) {
    return __awaiter(this, void 0, void 0, function () {
        var credentials, url;
        return __generator(this, function (_a) {
            credentials = input.credentials;
            url = "".concat(credentials.baseUrl, "/api/sessions/").concat(encodeURIComponent(credentials.sessionId));
            return [2 /*return*/, (0, connector_base_1.loggedFetch)(url, {
                    method: 'GET',
                    headers: { 'x-api-key': credentials.apiKey },
                }, { channel: OPENWA_CHANNEL })];
        });
    });
}
/**
 * Webhook signature verification placeholder.
 *
 * HMAC verification is out of scope for this phase; the interface is kept so
 * callers can integrate it later without changing signatures.
 */
function verifyWebhook(_payload, _signature) {
    return { ok: false, reason: 'not_implemented' };
}
function maskPhone(phone) {
    if (phone.length <= 4)
        return '***';
    return "".concat(phone.slice(0, 2), "***").concat(phone.slice(-2));
}
