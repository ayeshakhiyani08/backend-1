import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { protect, requireRole } from '../middleware/auth.js';

const router = express.Router();

const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'supportflow-dev-secret',
    { expiresIn: '7d' }
  );

router.post('/login', async (req, res) => {
  const { email, password, role = 'customer' } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const normalizedRole = String(role).toLowerCase();
  const user = await User.findOne({ email: String(email).toLowerCase(), role: normalizedRole });

  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials for this role.' });
  }

  const isValidPassword = await user.comparePassword(password);

  if (!isValidPassword) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  const token = signToken(user);

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

router.post('/register', async (req, res) => {
  const { name, email, password, role = 'customer' } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required.' });
  }

  const normalizedRole = String(role).toLowerCase();
  if (!['customer', 'agent'].includes(normalizedRole)) {
    return res.status(400).json({ message: 'Role must be customer or agent.' });
  }

  const existingUser = await User.findOne({ email: String(email).toLowerCase(), role: normalizedRole });

  if (existingUser) {
    return res.status(409).json({ message: 'A user with that email and role already exists.' });
  }

  const user = await User.create({
    name,
    email: String(email).toLowerCase(),
    password,
    role: normalizedRole,
  });

  const token = signToken(user);

  res.status(201).json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

router.get('/me', protect, async (req, res) => {
  res.json({ user: req.user });
});

router.get('/customers', protect, requireRole('agent'), async (req, res) => {
  const users = await User.find({ role: 'customer' }).select('-password').sort({ createdAt: -1 });
  res.json(users);
});

router.get('/agents', protect, requireRole('customer'), async (req, res) => {
  const users = await User.find({ role: 'agent' }).select('-password').sort({ createdAt: -1 });
  res.json(users);
});

export default router;
