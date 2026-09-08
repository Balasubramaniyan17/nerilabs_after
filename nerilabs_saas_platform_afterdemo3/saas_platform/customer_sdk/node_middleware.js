/**
 * Customer-Side Express.js / Node.js Middleware.
 * Validates assignment tokens using the tenant's individual token_signing_secret,
 * applies schema relaxation, flags synthetic backfill fields, and maintains downstream database integrity.
 */

const crypto = require('crypto');

function createExperimentMiddleware(config) {
    const tenantId = config.tenantId;
    const tokenSigningSecret = config.tokenSigningSecret || process.env.EXPERIMENT_TOKEN_SIGNING_SECRET;

    if (!tokenSigningSecret) {
        throw new Error('ExperimentMiddleware requires tokenSigningSecret configured.');
    }

    function verifyJwt(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return { valid: false, error: 'Malformed token' };

            const [headerB64, payloadB64, signatureB64] = parts;
            const signingInput = `${headerB64}.${payloadB64}`;
            const hmac = crypto.createHmac('sha256', tokenSigningSecret);
            hmac.update(signingInput);
            const expectedSig = hmac.digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

            if (expectedSig !== signatureB64) {
                return { valid: false, error: 'Invalid signature (Secret mismatch)' };
            }

            const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
            const payload = JSON.parse(payloadJson);

            if (tenantId && payload.tenant_id !== tenantId) {
                return { valid: false, error: 'Cross-tenant token mismatch rejected.' };
            }

            if (Date.now() / 1000 > payload.expires_at) {
                return { valid: false, error: 'Token expired' };
            }

            return { valid: true, payload };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    return function experimentMiddleware(req, res, next) {
        const token = req.headers['x-experiment-token'] || 
                      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

        if (!token) {
            return next();
        }

        const result = verifyJwt(token);
        if (!result.valid) {
            return res.status(401).json({ error: 'Experimentation token verification failed', details: result.error });
        }

        req.experimentContext = result.payload;

        if (req.body && result.payload.variant_type === 'ONBOARDING_SCHEMA') {
            const syntheticFields = {};
            if (!req.body.company_size) {
                req.body.company_size = '1-10 [synthetic]';
                syntheticFields.company_size = req.body.company_size;
            }
            if (!req.body.phone_number) {
                req.body.phone_number = '+10000000000 [synthetic]';
                syntheticFields.phone_number = req.body.phone_number;
            }

            req.body._experiment_metadata = {
                experiment_id: result.payload.experiment_id,
                opaque_variant_id: result.payload.opaque_variant_id,
                is_synthetic: Object.keys(syntheticFields).length > 0,
                synthetic_fields: syntheticFields
            };
        }

        next();
    };
}

module.exports = { createExperimentMiddleware };
