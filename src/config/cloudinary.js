const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer stocke en mémoire — on uploade ensuite via stream cloudinary v2
const memoryStorage = multer.memoryStorage();

/**
 * Upload un buffer vers Cloudinary dans le dossier donné.
 * Retourne l'URL sécurisée.
 */
function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

/**
 * Middleware Express : après multer memoryStorage,
 * uploade req.file.buffer vers Cloudinary et pose req.file.path = secure_url
 */
function cloudinaryUpload(folder) {
  return async (req, res, next) => {
    if (!req.file) return next();
    try {
      req.file.path = await uploadBufferToCloudinary(req.file.buffer, folder);
      next();
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      res.status(500).json({ error: 'Erreur upload image' });
    }
  };
}

// Factories identiques à l'ancienne API — usage : uploadCigar.single('photo')
function makeUploader(folder) {
  const multerMiddleware = memoryStorage;
  return {
    single: (fieldName) => [
      multer({ storage: memoryStorage }).single(fieldName),
      cloudinaryUpload(folder),
    ],
    array: (fieldName, max) => [
      multer({ storage: memoryStorage }).array(fieldName, max),
      cloudinaryUpload(folder),
    ],
  };
}

const uploadCigar  = makeUploader('cigarino');
const uploadAvatar = makeUploader('cigarino/avatars');
const uploadAdmin  = makeUploader('cigarino/admin');

module.exports = { cloudinary, uploadCigar, uploadAvatar, uploadAdmin, uploadBufferToCloudinary };
