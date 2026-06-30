"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
exports.successResponse = successResponse;
function sendSuccess(res, data, statusCode, meta) {
    if (statusCode === void 0) { statusCode = 200; }
    var body = { success: true, data: data };
    if (meta)
        body.meta = meta;
    res.status(statusCode).json(body);
}
function sendError(res, message, statusCode) {
    if (statusCode === void 0) { statusCode = 500; }
    var body = { success: false, error: message };
    res.status(statusCode).json(body);
}
/**
 * Build a success envelope body without sending it. Useful when a controller
 * needs to compose the response object directly (e.g. via `res.json(body)`)
 * instead of using `sendSuccess`, or when the same envelope shape must be
 * produced for non-Express responses (e.g. worker return values).
 */
function successResponse(data, meta) {
    var body = { success: true, data: data };
    if (meta)
        body.meta = meta;
    return body;
}
