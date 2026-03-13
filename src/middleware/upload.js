const multer = require('multer');
const path = require('path');

// Memory storage for direct upload to S3
const memoryStorage = multer.memoryStorage();

// File filter for images only
const imageFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Formato de arquivo inválido. Apenas JPEG, PNG e WebP são permitidos.'), false);
    }
};

// Upload configuration
const uploadConfig = {
    storage: memoryStorage,
    fileFilter: imageFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
        files: parseInt(process.env.MAX_FILES_PER_UPLOAD) || 50
    }
};

// Multer instances
const upload = multer(uploadConfig);

// Middleware for single file upload
const uploadSingle = upload.single('photo');

// Middleware for multiple files upload
const uploadMultiple = upload.array('photos', parseInt(process.env.MAX_FILES_PER_UPLOAD) || 50);

// Middleware for search photo (single)
const uploadSearchPhoto = upload.single('searchPhoto');

module.exports = {
    upload,
    uploadSingle,
    uploadMultiple,
    uploadSearchPhoto
};
