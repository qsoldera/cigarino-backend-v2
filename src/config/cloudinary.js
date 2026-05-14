const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cigarStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'cigarino', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
});

const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'cigarino/avatars', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
});

const adminStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'cigarino/admin', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
});

const uploadCigar = multer({ storage: cigarStorage });
const uploadAvatar = multer({ storage: avatarStorage });
const uploadAdmin = multer({ storage: adminStorage });

module.exports = { cloudinary, uploadCigar, uploadAvatar, uploadAdmin };
