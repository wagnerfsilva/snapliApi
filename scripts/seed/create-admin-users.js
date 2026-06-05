require('dotenv').config();
const { User } = require('../../src/models');

const admins = [
    { name: 'Fernando',  email: 'fernando@snapli.com.br',  password: 'fernando@snapli.com.br'  },
    { name: 'João',      email: 'joao@snapli.com.br',      password: 'joao@snapli.com.br'      },
    { name: 'Tais',      email: 'tais@snapli.com.br',      password: 'tais@snapli.com.br'      },
    { name: 'Sophia',    email: 'sophia@snapli.com.br',    password: 'sophia@snapli.com.br'    },
    { name: 'Guilherme', email: 'guilherme@snapli.com.br', password: 'guilherme@snapli.com.br' },
    { name: 'Lucas',     email: 'lucas@snapli.com.br',     password: 'lucas@snapli.com.br'     },
    { name: 'Felipe',    email: 'felipe@snapli.com.br',    password: 'felipe@snapli.com.br'    },
    { name: 'Cícero',    email: 'cicero@snapli.com.br',    password: 'cicero@snapli.com.br'    },
    { name: 'Jesus',     email: 'jesus@snapli.com.br',     password: 'jesus@snapli.com.br'     },
];

(async () => {
    let created = 0, skipped = 0;

    for (const admin of admins) {
        const [user, wasCreated] = await User.findOrCreate({
            where: { email: admin.email },
            defaults: { ...admin, role: 'fotografo', isActive: true }
        });

        if (wasCreated) {
            console.log(`✅ Criado: ${user.name} <${user.email}>`);
            created++;
        } else {
            console.log(`⚠️  Já existe: ${user.name} <${user.email}> (pulado)`);
            skipped++;
        }
    }

    console.log(`\nResumo: ${created} criado(s), ${skipped} já existia(m).`);
    process.exit(0);
})().catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
});
