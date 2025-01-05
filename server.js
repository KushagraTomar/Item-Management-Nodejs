const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { GetObjectCommand, S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

require('dotenv').config();

const app = express();
// const PORT = 3001;

// Middleware
app.use(bodyParser.json());
app.use(cors());


// MongoDB Connection
mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;

db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log(`Connected to MongoDB, database is ${process.env.DB_NAME}`);
});

// Mongoose Schema
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: Number,
  image: String, // Store the image file path
});

const Item = mongoose.model('Item', itemSchema);

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      cb(null, `uploads/${Date.now()}-${file.originalname}`);
    },
  }),
});

// async function putObjectURL(filename, contentType) {
//   const command = new PutObjectCommand({
//     Bucket: "dev-kushagra-private",
//     Key: `/uploads/${filename}`,
//     ContentType: contentType,
//   });
//   const url = await getSignedUrl(s3Client, command);
//   return url;
// }

async function getObjectURL(key) {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key
  });
  const url = await getSignedUrl(s3Client, command);
  return url;
}

async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key
  });
  const data = await s3Client.send(command);
  return data; 
};

app.get('/', async (req, res) => {
  try {
    res.status(201).json("welcome to Item Management System");
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
})

app.post('/items', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price } = req.body;
    const image = req.file ? req.file.key : null; // S3 URL
    const item = new Item({ name, description, price, image });
    await item.save();

    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/items', async (req, res) => {
  try {
    const items = await Item.find();

    // Generate S3 signed URLs for each item's image
    const itemsWithS3URLs = await Promise.all(
      items.map(async (item) => {
        if (item.image) {
          const s3URL = await getObjectURL(item.image); 
          return { ...item.toObject(), image: s3URL };
        }
        return item;
      })
    );

    res.status(200).json(itemsWithS3URLs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/item/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Generate a pre-signed S3 URL for the image (if exists)
    if (item.image) {
      item.image = await getObjectURL(item.image);
    }

    res.status(200).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/item/:id', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price } = req.body;
    const image = req.file ? req.file.key : null; // S3 key or URL

    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    // Update fields
    const updateData = { name, description, price };
    updateData.image = image || item.image;

    // Optionally delete old image from S3
    if (image && item.image) {
      await deleteObject(item.image); 
    }

    const updatedItem = await Item.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ success: true, updatedItem });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


app.delete('/item/:id', async (req, res) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    // Delete the associated image file from s3
    if (item.image) {
      await deleteObject(item.image); 
    }
    res.status(200).json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
