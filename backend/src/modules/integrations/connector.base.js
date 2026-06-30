"use strict";
/**
 * Shared connector utilities used by every provider-specific module
 * (WhatsApp / Twilio / SendGrid / Google Ads / Facebook).
 *
 * Conventions enforced here (per AGENTS.md "Observability Rules" + Security Rules):
 *
 *   • Every outbound HTTP call MUST log:
 *       channel, lead_id, campaign_id, status, latency_ms
 *   • Every outbound call MUST go through `loggedFetch`, which:
 *       - records start time
 *       - wraps fetch with AbortSignal timeout (configurable)
 *       - NEVER logs request/response bodies that may contain secrets
 *       - returns a typed `ConnectorResult` so callers do not throw
 *   • `ConnectorResult` is the "Result<T, E>" pattern: services never throw,
 *     callers inspect `.ok` and branch on `.error`.
 *
 * Providers MUST compose these helpers — never call `fetch` directly.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loggedFetch = loggedFetch;
exports.isDispatchable = isDispatchable;
var logger_1 = require("../../shared/utils/logger");
/**
 * Performs a fetch with mandatory observability logging.
 *
 * Returns a `ConnectorResult` — NEVER throws. Network failures, non-2xx
 * responses, and aborts are converted to `ConnectorFailure`. The caller
 * decides whether to retry / enqueue / surface to the user.
 */
function loggedFetch(url, init, opts) {
    return __awaiter(this, void 0, void 0, function () {
        var start, controller, timeoutMs, timer, safeInit, response, err_1, latencyMs_1, message, latencyMs, ok, data, text, externalId, retryable;
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    start = Date.now();
                    controller = new AbortController();
                    timeoutMs = (_a = opts.timeoutMs) !== null && _a !== void 0 ? _a : 10000;
                    timer = setTimeout(function () { return controller.abort(); }, timeoutMs);
                    // Forward caller-provided abort signal, if any.
                    if (init.signal) {
                        init.signal.addEventListener('abort', function () { return controller.abort(); });
                    }
                    safeInit = __assign(__assign({}, init), { signal: controller.signal });
                    _l.label = 1;
                case 1:
                    _l.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, fetch(url, safeInit)];
                case 2:
                    response = _l.sent();
                    return [3 /*break*/, 5];
                case 3:
                    err_1 = _l.sent();
                    latencyMs_1 = Date.now() - start;
                    message = err_1 instanceof Error ? err_1.message : 'network error';
                    logger_1.logger.warn('connector network failure', __assign({ channel: opts.channel, lead_id: (_b = opts.leadId) !== null && _b !== void 0 ? _b : null, campaign_id: (_c = opts.campaignId) !== null && _c !== void 0 ? _c : null, status: 0, latency_ms: latencyMs_1, error: message }, ((_d = opts.context) !== null && _d !== void 0 ? _d : {})));
                    return [2 /*return*/, {
                            ok: false,
                            status: 0,
                            error: message,
                            latencyMs: latencyMs_1,
                            retryable: true,
                        }];
                case 4:
                    clearTimeout(timer);
                    return [7 /*endfinally*/];
                case 5:
                    latencyMs = Date.now() - start;
                    ok = response.ok;
                    data = null;
                    return [4 /*yield*/, response.text()];
                case 6:
                    text = _l.sent();
                    if (text.length > 0) {
                        try {
                            data = JSON.parse(text);
                        }
                        catch (_m) {
                            data = text;
                        }
                    }
                    if (ok) {
                        logger_1.logger.info('connector call ok', __assign({ channel: opts.channel, lead_id: (_e = opts.leadId) !== null && _e !== void 0 ? _e : null, campaign_id: (_f = opts.campaignId) !== null && _f !== void 0 ? _f : null, status: response.status, latency_ms: latencyMs }, ((_g = opts.context) !== null && _g !== void 0 ? _g : {})));
                        externalId = extractExternalId(data, opts.channel);
                        return [2 /*return*/, { ok: true, status: response.status, data: data, externalId: externalId, latencyMs: latencyMs }];
                    }
                    retryable = response.status === 408 || response.status === 429 || response.status >= 500;
                    logger_1.logger.warn('connector call failed', __assign({ channel: opts.channel, lead_id: (_h = opts.leadId) !== null && _h !== void 0 ? _h : null, campaign_id: (_j = opts.campaignId) !== null && _j !== void 0 ? _j : null, status: response.status, latency_ms: latencyMs, retryable: retryable }, ((_k = opts.context) !== null && _k !== void 0 ? _k : {})));
                    return [2 /*return*/, {
                            ok: false,
                            status: response.status,
                            error: "HTTP ".concat(response.status),
                            latencyMs: latencyMs,
                            retryable: retryable,
                        }];
            }
        });
    });
}
/**
 * Extracts a provider-specific identifier from a successful response body.
 * Best-effort — returns undefined if the vendor's schema doesn't match.
 */
function extractExternalId(data, channel) {
    if (!data || typeof data !== 'object')
        return undefined;
    var obj = data;
    switch (channel) {
        case 'whatsapp':
            // Cloud API: messages[0].id
            return pickFirst(obj, ['messages.0.id', 'id']);
        case 'twilio':
            return pickFirst(obj, ['sid']);
        case 'sendgrid':
            return pickFirst(obj, ['message_id', 'x-message-id']);
        case 'google_ads':
            return pickFirst(obj, ['results.0.resourceName', 'resourceName']);
        case 'facebook':
            return pickFirst(obj, ['id']);
        case 'openwa':
            return pickFirst(obj, ['messageId']);
        default:
            return undefined;
    }
}
function pickFirst(obj, dottedPaths) {
    for (var _i = 0, dottedPaths_1 = dottedPaths; _i < dottedPaths_1.length; _i++) {
        var path = dottedPaths_1[_i];
        var segs = path.split('.');
        var cur = obj;
        for (var _a = 0, segs_1 = segs; _a < segs_1.length; _a++) {
            var s = segs_1[_a];
            if (cur && typeof cur === 'object' && s in cur) {
                cur = cur[s];
            }
            else {
                cur = undefined;
                break;
            }
        }
        if (cur !== undefined && cur !== null)
            return cur;
    }
    return undefined;
}
/**
 * Returns whether an outbound dispatch should be attempted.
 * Centralised so providers don't reinvent the same gate.
 */
function isDispatchable(row) {
    return !!row && row.is_enabled;
}
