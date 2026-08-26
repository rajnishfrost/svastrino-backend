import mongoose from 'mongoose'

/** Connects to MongoDB using MONGODB_URI. Exits the process on failure. */
export async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('💥 MONGODB_URI is not set. Copy .env.example to .env first.')
    process.exit(1)
  }

  try {
    mongoose.set('strictQuery', true)
    await mongoose.connect(uri)
    console.log('✅ MongoDB connected')
  } catch (err) {
    console.error('💥 MongoDB connection failed:', err.message)
    process.exit(1)
  }
}
