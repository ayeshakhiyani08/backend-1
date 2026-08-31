import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, unique: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['customer', 'agent'],
      required: true,
      default: 'customer',
    },
    phone: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true, strict: false }
);

userSchema.pre('save', async function preSave(next) {
  if (this.isModified('password') && this.password && !this.password.startsWith('$2')) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  next();
});

userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  if (this.password && this.password.startsWith('$2')) {
    return bcrypt.compare(candidatePassword, this.password);
  }

  return candidatePassword === this.password;
};

userSchema.statics.seedDefaultUsers = async function seedDefaultUsers() {
  const users = [
    {
      name: 'Ali Khan',
      email: 'customer@supportflow.com',
      password: 'Customer123!',
      role: 'customer',
      phone: '+923001112233',
    },
    {
      name: 'Nadia Shah',
      email: 'agent@supportflow.com',
      password: 'Agent123!',
      role: 'agent',
      phone: '+923004445566',
    },
  ];

  for (const user of users) {
    const existingUser = await this.findOne({ email: user.email.toLowerCase(), role: user.role });

    if (!existingUser) {
      await this.create({
        name: user.name,
        email: user.email.toLowerCase(),
        password: user.password,
        phone: user.phone,
        role: user.role,
      });
    }
  }
};

export default mongoose.model('User', userSchema);
