"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var winston_1 = __importDefault(require("winston"));
var _a = winston_1.default.format, combine = _a.combine, timestamp = _a.timestamp, json = _a.json, colorize = _a.colorize, simple = _a.simple;
var isDev = process.env.NODE_ENV !== 'production';
exports.logger = winston_1.default.createLogger({
    level: isDev ? 'debug' : 'info',
    format: combine(timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), json()),
    transports: [
        new winston_1.default.transports.Console({
            format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()),
        }),
    ],
});
