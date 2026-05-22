if (!process.env.JWT_SECRET) {
    throw new Error(
        'JWT_SECRET não está definido. ' +
        'Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor.'
    );
}

module.exports = {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'snapli-api',
    audience: 'snapli-users'
};
