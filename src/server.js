import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import complaintRoutes from './routes/complaints.js';
import authRoutes from './routes/auth.js';
import { connectDB, stopDB } from './config/db.js';
import Complaint from './models/Complaint.js';
import User from './models/User.js';
import Message from './models/Message.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  },
});
const PORT = Number(process.env.PORT || 5001);

app.locals.io = io;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api', complaintRoutes);

io.on('connection', (socket) => {
  socket.on('join-ticket', (ticketId) => {
    if (ticketId) {
      socket.join(String(ticketId));
    }
  });
});

const seedComplaints = async () => {
  const existing = await Complaint.countDocuments();

  if (existing > 0) {
    return;
  }

  const customer = await User.findOne({ email: 'customer@supportflow.com', role: 'customer' });
  const agent = await User.findOne({ email: 'agent@supportflow.com', role: 'agent' });

  const ticket = await Complaint.create({
    ticketNumber: 'TK-1001',
    customerId: customer?._id || null,
    agentId: agent?._id || null,
    title: 'Delayed replacement order',
    complaint: 'My replacement order is delayed for 8 days and I need an urgent shipping update before the customer event this weekend.',
    address: 'House 14, Gulshan Avenue, Karachi',
    category: 'Logistics',
    priority: 'High',
    status: 'Accepted',
    aiSuggestion: {
      category: 'Logistics',
      priority: 'High',
      summary: 'Customer reported a delayed replacement order and requested urgent shipping follow-up before an upcoming event.',
    },
    rejectionReason: '',
    completionNote: '',
    rating: null,
    review: '',
    customerName: 'Ali Khan',
    email: 'customer@supportflow.com',
    subject: 'Delayed replacement order',
    assignedTo: 'Shipping Team',
    agentName: 'Nadia Shah',
    aiSummary: 'AI triage: Ali Khan\'s logistics complaint (priority: High) on "Delayed replacement order".',
    sentiment: 'Negative',
    slaHours: 12,
  });

  await Message.create({
    ticketId: ticket._id,
    senderId: customer?._id || ticket.customerId,
    senderRole: 'customer',
    message: 'I need my package to arrive before the event this weekend.',
  });

  await Message.create({
    ticketId: ticket._id,
    senderId: agent?._id || ticket.agentId,
    senderRole: 'agent',
    message: 'We have accepted the ticket and are checking the shipping timeline.',
  });
};

const startServer = async () => {
  await connectDB();
  await User.seedDefaultUsers();
  await seedComplaints();

  server.listen(PORT, () => {
    console.log(`SupportFlow API running on http://localhost:${PORT}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start SupportFlow server:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await stopDB();
  process.exit(0);
});
