"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
var zod_1 = require("zod");
var Sentry = __importStar(require("@sentry/node"));
var logger_1 = require("../utils/logger");
var response_1 = require("../utils/response");
var AppError = /** @class */ (function (_super) {
    __extends(AppError, _super);
    function AppError(message, statusCode) {
        if (statusCode === void 0) { statusCode = 400; }
        var _this = _super.call(this, message) || this;
        _this.isAppError = true;
        _this.statusCode = statusCode;
        Object.setPrototypeOf(_this, AppError.prototype);
        return _this;
    }
    return AppError;
}(Error));
exports.AppError = AppError;
function notFoundHandler(req, res) {
    (0, response_1.sendError)(res, "Route not found: ".concat(req.method, " ").concat(req.originalUrl), 404);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err, req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        logger_1.logger.warn('Validation error', { errors: err.errors, path: req.originalUrl });
        (0, response_1.sendError)(res, err.errors.map(function (e) { return e.message; }).join(', '), 422);
        return;
    }
    // Also check isAppError to survive ts-node-dev module reloads
    if (err instanceof AppError || (err && typeof err === 'object' && 'isAppError' in err)) {
        var appErr = err;
        if (appErr.statusCode >= 500)
            Sentry.captureException(appErr);
        (0, response_1.sendError)(res, appErr.message, appErr.statusCode);
        return;
    }
    // Handle PostgreSQL constraints
    var pgError = err;
    if (pgError.code === '23P01') {
        logger_1.logger.warn('Exclusion constraint violation', { error: err });
        (0, response_1.sendError)(res, 'Conflict: Only one stage can be marked as Won/Lost per pipeline.', 409);
        return;
    }
    if (pgError.code === '23505') {
        logger_1.logger.warn('Unique constraint violation', { error: err });
        (0, response_1.sendError)(res, 'Conflict: Resource already exists or violates a unique constraint.', 409);
        return;
    }
    var message = err instanceof Error ? err.message : 'Unknown error';
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    logger_1.logger.error('Unhandled error', {
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
    });
    (0, response_1.sendError)(res, 'Internal server error', 500);
}
