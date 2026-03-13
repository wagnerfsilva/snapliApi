const db = require('./src/models');
const { User } = db;

async function test() {
    try {
        await db.sequelize.authenticate();
        console.log('DB connected');

        const user = await User.findOne({ where: { email: 'fotografo@gmail.com' } });
        console.log('User found:', !!user);

        if (user) {
            console.log('User ID:', user.id);
            console.log('User isActive:', user.isActive);

            const isValid = await user.validatePassword('%65434343');
            console.log('Password valid:', isValid);
        }
    } catch (err) {
        console.error('ERROR:', err.message);
        console.error('Name:', err.name);
        console.error('Stack:', err.stack);
    } finally {
        await db.sequelize.close();
    }
}
test();
