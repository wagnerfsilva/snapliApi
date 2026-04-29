require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const db = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5174',
    'https://web.snapli.com.br',
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined', {
        stream: {
            write: (message) => logger.info(message.trim())
        }
    }));
}

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: {
        success: false,
        message: 'Muitas requisições deste IP, tente novamente mais tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Apply rate limiting to API routes
app.use('/api/', limiter);

// Mount API routes
app.use('/api', routes);

// Health check endpoint
app.get('/health', (req, res) => {
    const { isConfigured: awsConfigured } = require('./config/aws');
    
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        services: {
            database: {
                configured: db.isConfigured || false,
                status: db.isConfigured ? 'available' : 'not configured'
            },
            aws: {
                configured: awsConfigured || false,
                status: awsConfigured ? 'available' : 'not configured',
                region: process.env.AWS_REGION,
                accessKeyId: process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.slice(0, 8) + '...' : null,
                rekognitionCollection: process.env.REKOGNITION_COLLECTION_ID
            },
            smtp: {
                configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
                status: (process.env.SMTP_HOST && process.env.SMTP_USER) ? 'available' : 'not configured'
            }
        },
        message: db.isConfigured && awsConfigured ? 'All systems operational' : 'Running with limited functionality - check services configuration'
    });
});

// Root route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Snapli API',
        version: '1.0.0',
        healthCheck: '/health'
    });
});

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// Database connection and server start
const startServer = async () => {
    try {
        // Test database connection (non-fatal if fails)
        try {
            await db.sequelize.authenticate();
            logger.info('✅ Conexão com banco de dados estabelecida com sucesso');

            // Sync models (in development only)
            if (process.env.NODE_ENV === 'development') {
                await db.sequelize.sync({ alter: false });
                logger.info('Modelos sincronizados');
            }
        } catch (dbError) {
            if (!db.isConfigured) {
                logger.warn('⚠️  Database not configured - application will run with limited functionality');
            } else {
                logger.error('❌ Erro ao conectar com banco de dados:', dbError.message);
                logger.error('Application will continue but database features will not work');
            }
        }

        // Start server regardless of database status
        app.listen(PORT, () => {
            logger.info(`🚀 Servidor rodando na porta ${PORT}`);
            logger.info(`📦 Ambiente: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
            
            if (!db.isConfigured) {
                logger.warn('⚠️  Configure database environment variables to enable full functionality');
            }
        });
    } catch (error) {
        logger.error('❌ Erro fatal ao iniciar servidor:', error);
        process.exit(1);
    }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Promise Rejection:', err);
    // Close server & exit process
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM recebido. Encerrando gracefully...');
    await db.sequelize.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT recebido. Encerrando gracefully...');
    await db.sequelize.close();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
