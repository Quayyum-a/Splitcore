"use strict";
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
const Sentry = __importStar(require("@sentry/nestjs"));
const profiling_node_1 = require("@sentry/profiling-node");
const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || 'development';
if (SENTRY_DSN) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: NODE_ENV,
        tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
        profilesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
        integrations: [
            (0, profiling_node_1.nodeProfilingIntegration)(),
        ],
        beforeSend(event, hint) {
            if (event.request) {
                if (event.request.headers) {
                    delete event.request.headers['authorization'];
                    delete event.request.headers['Authorization'];
                }
                if (event.request.data) {
                    const data = typeof event.request.data === 'string'
                        ? JSON.parse(event.request.data)
                        : event.request.data;
                    if (data.password)
                        data.password = '[REDACTED]';
                    if (data.passwordHash)
                        data.passwordHash = '[REDACTED]';
                    if (data.token)
                        data.token = '[REDACTED]';
                    event.request.data = data;
                }
            }
            if (event.user) {
                delete event.user.email;
                delete event.user.ip_address;
            }
            return event;
        },
        ignoreErrors: [
            'UnauthorizedException',
            'ForbiddenException',
            'NotFoundException',
        ],
    });
}
//# sourceMappingURL=instrument.js.map