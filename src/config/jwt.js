module.exports = {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'snapli-api',
    audience: 'snapli-users'
};
