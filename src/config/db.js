import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer;

export const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (mongoUri) {
    await mongoose.connect(mongoUri);
    console.log(`MongoDB connected: ${mongoUri}`);
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI is required in production. Set your Railway MongoDB Atlas connection string.');
  }

  memoryServer = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
  });

  const uri = memoryServer.getUri();
  await mongoose.connect(uri);
  console.log(`Mongo Memory Server connected: ${uri}`);
};

export const stopDB = async () => {
  await mongoose.disconnect();

  if (memoryServer) {
    await memoryServer.stop();
  }
};
