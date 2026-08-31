import express from 'express';
import nodemailer from 'nodemailer';
import { protect, requireRole } from '../middleware/auth.js';
import Complaint from '../models/Complaint.js';
import Message from '../models/Message.js';

const router = express.Router();
const FINAL_STATUSES = new Set(['Rejected', 'Cancelled', 'Completed']);
const ALLOWED_STATUS_UPDATES = new Set(['Accepted', 'In Progress', 'Completed']);

const isStatusLocked = (status) => FINAL_STATUSES.has(status);
const AGENT_SHARED_QUEUE = new Set([
  'Support Desk',
  'Support Lead',
  'Billing Team',
  'Finance Ops',
  'Shipping Team',
  'Logistics Desk',
  'Fulfillment Lead',
  'Identity Team',
  'Product Squad',
  'Engineering Desk',
  'Escalation Desk',
  'Support Operations',
  'Unassigned',
]);

const ensureStatusEditable = (complaint) => {
  if (isStatusLocked(complaint.status)) {
    throw new Error('This ticket is in a final status and cannot be updated.');
  }
};

const canAccessTicket = (user, complaint) => {
  if (!user || !complaint) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  if (user.role === 'customer') {
    return complaint.customerId?.toString() === user._id.toString();
  }

  if (user.role === 'agent') {
    return (
      complaint.agentId?.toString() === user._id.toString() ||
      complaint.agentName === user.name ||
      complaint.assignedTo === user.name ||
      AGENT_SHARED_QUEUE.has(complaint.assignedTo)
    );
  }

  return false;
};

const ensureTicketAccess = (req, res, complaint) => {
  if (!canAccessTicket(req.user, complaint)) {
    res.status(403).json({ message: 'You can only access your own tickets or assigned tickets.' });
    return false;
  }

  return true;
};

const AI_ALLOWED_CATEGORIES = ['Plumbing', 'Electrical', 'AC Repair', 'Appliance Repair', 'Cleaning', 'General'];
const AI_ALLOWED_PRIORITIES = ['Low', 'Medium', 'High'];

const emitTicketEvent = (req, eventName, payload) => {
  if (!req.app?.locals?.io) {
    return;
  }

  req.app.locals.io.emit(eventName, payload);
  if (payload?.ticketId) {
    req.app.locals.io.to(String(payload.ticketId)).emit(eventName, payload);
  }
};

const normalizeAiSuggestion = (incoming = {}) => {
  const category = AI_ALLOWED_CATEGORIES.includes(incoming.category) ? incoming.category : 'General';
  const priority = AI_ALLOWED_PRIORITIES.includes(incoming.priority) ? incoming.priority : 'Medium';
  const summary = typeof incoming.summary === 'string' && incoming.summary.trim() ? incoming.summary.trim() : 'AI analysis needs agent review.';

  return {
    category,
    priority,
    summary,
  };
};

const analyzeComplaintWithAI = ({ title = '', complaint = '' }) => {
  const combined = `${title} ${complaint}`.toLowerCase();

  let category = 'General';
  if (combined.includes('leak') || combined.includes('pipe') || combined.includes('water') || combined.includes('drain') || combined.includes('sink')) {
    category = 'Plumbing';
  } else if (combined.includes('light') || combined.includes('switch') || combined.includes('socket') || combined.includes('electric') || combined.includes('circuit')) {
    category = 'Electrical';
  } else if (combined.includes('ac ') || combined.includes('air conditioner') || combined.includes('cooling') || combined.includes('hvac')) {
    category = 'AC Repair';
  } else if (combined.includes('washing machine') || combined.includes('fridge') || combined.includes('refrigerator') || combined.includes('microwave') || combined.includes('appliance')) {
    category = 'Appliance Repair';
  } else if (combined.includes('clean') || combined.includes('mold') || combined.includes('stain') || combined.includes('dust') || combined.includes('dirty')) {
    category = 'Cleaning';
  }

  let priority = 'Medium';
  if (combined.includes('urgent') || combined.includes('emergency') || combined.includes('danger') || combined.includes('major leak') || combined.includes('sparking') || combined.includes('no water')) {
    priority = 'High';
  } else if (combined.includes('minor') || combined.includes('small') || combined.includes('slow')) {
    priority = 'Low';
  }

  const summaryText = `${title || 'Customer'} reports a ${category.toLowerCase()} issue${complaint ? `: ${complaint.slice(0, 120).trim()}` : '.'}`;

  return normalizeAiSuggestion({
    category,
    priority,
    summary: summaryText,
  });
};

const determineCategory = (text = '') => {
  const normalized = text.toLowerCase();

  if (normalized.includes('refund') || normalized.includes('billing') || normalized.includes('charge')) return 'Billing';
  if (normalized.includes('delay') || normalized.includes('shipping') || normalized.includes('logistics')) return 'Logistics';
  if (normalized.includes('login') || normalized.includes('password') || normalized.includes('access')) return 'Account Access';
  if (normalized.includes('app') || normalized.includes('bug') || normalized.includes('error')) return 'Product Bug';
  return 'General Support';
};

const determinePriority = (text = '') => {
  const normalized = text.toLowerCase();

  if (normalized.includes('outage') || normalized.includes('critical') || normalized.includes('refund') || normalized.includes('access') || normalized.includes('urgent')) return 'Critical';
  if (normalized.includes('payment') || normalized.includes('billing') || normalized.includes('delay') || normalized.includes('urgent')) return 'High';
  if (normalized.includes('issue') || normalized.includes('shipping') || normalized.includes('error')) return 'Medium';
  return 'Low';
};

const determineAgent = (category = 'General Support', priority = 'Medium') => {
  const agentMap = {
    Billing: { Critical: 'Finance Ops', High: 'Billing Team', Medium: 'Finance Ops', Low: 'Finance Queue' },
    Logistics: { Critical: 'Fulfillment Lead', High: 'Shipping Team', Medium: 'Logistics Desk', Low: 'Logistics Desk' },
    'Account Access': { Critical: 'Identity Team', High: 'Identity Team', Medium: 'Support Desk', Low: 'Support Desk' },
    'Product Bug': { Critical: 'Engineering Desk', High: 'Product Squad', Medium: 'Engineering Desk', Low: 'Product Squad' },
    'General Support': { Critical: 'Escalation Desk', High: 'Support Lead', Medium: 'Support Desk', Low: 'Support Desk' },
  };

  return agentMap[category]?.[priority] || 'Support Desk';
};

const getAutoAssignment = (subject = '', description = '', requestedPriority = 'Medium') => {
  const text = `${subject} ${description}`.toLowerCase();
  const category = determineCategory(text);
  const priority = ['Low', 'Medium', 'High', 'Critical'].includes(requestedPriority) ? requestedPriority : determinePriority(text);
  const assignedTo = determineAgent(category, priority);

  return { category, priority, assignedTo };
};

const determineSentiment = (text = '') => {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('angry') || lowerText.includes('frustrated') || lowerText.includes('disappointed')) return 'Negative';
  if (lowerText.includes('happy') || lowerText.includes('thankful') || lowerText.includes('great')) return 'Positive';
  return 'Neutral';
};

const buildSummary = ({ subject, description, category, priority, customerName, agent }) => {
  const shortDescription = description.length > 160 ? `${description.slice(0, 157)}...` : description;
  return `AI triage: ${customerName}'s ${category.toLowerCase()} complaint (priority: ${priority}) on "${subject}". Summary: ${shortDescription}. Recommended next step: assign to ${agent} and maintain SLA under ${priority === 'Critical' ? 6 : priority === 'High' ? 12 : 24} hours.`;
};

const sendEmailNotification = async ({ to, subject, text }) => {
  if (!process.env.SMTP_HOST) {
    console.log(`Email notification (not sent): ${subject} -> ${to}\n${text}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'supportflow@noreply.local',
    to,
    subject,
    text,
  });
};

const generateTicketCode = async () => {
  const lastComplaint = await Complaint.findOne({}, { ticketNumber: 1 }).sort({ createdAt: -1, _id: -1 }).lean();

  if (!lastComplaint?.ticketNumber) {
    return 'SF-1001';
  }

  const lastNumber = Number(String(lastComplaint.ticketNumber).split('-').pop() || '1000');
  return `SF-${lastNumber + 1}`;
};

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SupportFlow API', uptime: process.uptime() });
});

router.get('/dashboard', protect, async (req, res) => {
  const complaints = await Complaint.find(req.user.role === 'customer' ? { customerId: req.user._id } : {}).sort({ createdAt: -1 });

  const metrics = {
    total: complaints.length,
    critical: complaints.filter((item) => item.priority === 'Critical').length,
    inProgress: complaints.filter((item) => ['Accepted', 'In Progress', 'Awaiting Customer'].includes(item.status)).length,
    resolved: complaints.filter((item) => item.status === 'Completed').length,
  };

  const queue = complaints.slice(0, 6).map((item) => ({
    id: item._id,
    customer: item.customerName,
    subject: item.subject,
    priority: item.priority,
    status: item.status,
    assignedTo: item.assignedTo,
    updatedAt: item.updatedAt,
  }));

  const recentActivity = complaints.slice(0, 4).map((item) => ({
    id: item._id,
    title: `${item.customerName} • ${item.subject}`,
    description: item.aiSummary || item.description,
    time: new Date(item.updatedAt).toLocaleString(),
  }));

  res.json({ metrics, queue, recentActivity });
});

router.get('/admin/dashboard', protect, requireRole('admin'), async (req, res) => {
  const complaints = await Complaint.find().sort({ createdAt: -1 });
  const metrics = {
    total: complaints.length,
    critical: complaints.filter((item) => item.priority === 'Critical').length,
    pending: complaints.filter((item) => item.status === 'Pending').length,
    inProgress: complaints.filter((item) => ['Accepted', 'In Progress'].includes(item.status)).length,
    resolved: complaints.filter((item) => item.status === 'Completed').length,
  };

  res.json({ metrics, queue: complaints.slice(0, 8).map((item) => ({
    id: item._id,
    customer: item.customerName,
    subject: item.subject,
    priority: item.priority,
    status: item.status,
    assignedTo: item.assignedTo,
    updatedAt: item.updatedAt,
  })), recentActivity: complaints.slice(0, 5).map((item) => ({
    id: item._id,
    title: `${item.customerName} • ${item.subject}`,
    description: item.aiSummary || item.description,
    time: new Date(item.updatedAt).toLocaleString(),
  })) });
});

router.get('/complaints', protect, async (req, res) => {
  const query = req.user.role === 'customer'
    ? { customerId: req.user._id }
    : req.user.role === 'admin'
      ? {}
      : {};

  const complaints = await Complaint.find(query).sort({ createdAt: -1 });
  res.json(complaints.map((item) => ({
    ...item.toObject(),
    statusLabel: item.status,
  })));
});

router.get('/admin/complaints', protect, requireRole('admin'), async (req, res) => {
  const complaints = await Complaint.find().sort({ createdAt: -1 });
  res.json(complaints.map((item) => ({
    ...item.toObject(),
    statusLabel: item.status,
  })));
});

router.get('/customer/tickets', protect, requireRole('customer'), async (req, res) => {
  const complaints = await Complaint.find({ customerId: req.user._id }).sort({ createdAt: -1 });
  res.json(complaints.map((item) => ({
    ...item.toObject(),
    statusLabel: item.status,
  })));
});

router.post('/customer/complaints', protect, requireRole('customer'), async (req, res) => {
  const { title, complaint, address, image, priority = 'Medium' } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: 'Title is required.' });
  }

  if (!complaint || String(complaint).trim().length < 15) {
    return res.status(400).json({ message: 'Complaint must be at least 15 characters long.' });
  }

  const complaintText = String(complaint).trim();
  const autoAssignment = getAutoAssignment(String(title).trim(), complaintText, priority || 'Medium');
  const category = autoAssignment.category;
  const normalizedPriority = autoAssignment.priority;
  const sentiment = determineSentiment(`${title} ${complaintText}`);
  const ticketNumber = await generateTicketCode();
  const assignedAgent = autoAssignment.assignedTo;
  const aiSuggestion = analyzeComplaintWithAI({ title, complaint: complaintText });

  const newComplaint = await Complaint.create({
    ticketNumber,
    customerId: req.user._id,
    customerName: req.user.name,
    email: req.user.email,
    title: String(title).trim(),
    complaint: complaintText,
    address: String(address || '').trim(),
    image: image || '',
    category: aiSuggestion.category || category,
    priority: aiSuggestion.priority || normalizedPriority,
    status: 'Pending',
    decision: 'Pending',
    assignedTo: assignedAgent,
    agentName: assignedAgent,
    aiSuggestion: {
      category: aiSuggestion.category || category,
      priority: aiSuggestion.priority || normalizedPriority,
      summary: aiSuggestion.summary,
    },
    aiSummary: buildSummary({ subject: String(title).trim(), description: complaintText, category: aiSuggestion.category || category, priority: aiSuggestion.priority || normalizedPriority, customerName: req.user.name, agent: assignedAgent }),
    sentiment,
    subject: String(title).trim(),
    slaHours: (aiSuggestion.priority || normalizedPriority) === 'High' ? 12 : (aiSuggestion.priority || normalizedPriority) === 'Medium' ? 24 : 48,
  });

  emitTicketEvent(req, 'new-ticket', {
    ticketId: newComplaint._id,
    ticketNumber: newComplaint.ticketNumber,
    status: newComplaint.status,
    message: 'New ticket received.',
  });

  await sendEmailNotification({
    to: req.user.email,
    subject: `SupportFlow ticket created: ${newComplaint.ticketNumber}`,
    text: `Your ticket ${newComplaint.ticketNumber} has been created successfully.`,
  });

  res.status(201).json(newComplaint);
});

router.get('/agent/tickets', protect, requireRole('agent'), async (req, res) => {
  const complaints = await Complaint.find({}).sort({ createdAt: -1 });
  res.json(complaints.map((item) => ({
    ...item.toObject(),
    statusLabel: item.status,
  })));
});

router.post('/complaints', async (req, res) => {
  const {
    customerName,
    email,
    subject,
    description,
    channel = 'Email',
    priority,
    assignedTo,
    orderId,
    customerId,
  } = req.body;

  if (!customerName || !email || !subject || !description) {
    return res.status(400).json({ message: 'customerName, email, subject, and description are required.' });
  }

  const category = determineCategory(`${subject} ${description}`);
  const normalizedPriority = priority || determinePriority(`${subject} ${description}`);
  const sentiment = determineSentiment(`${subject} ${description}`);
  const agent = assignedTo || determineAgent(category, normalizedPriority);
  const aiSuggestion = analyzeComplaintWithAI({ title: subject, complaint: description });

  const complaint = await Complaint.create({
    customerName,
    email,
    subject,
    description,
    channel,
    priority: aiSuggestion.priority,
    category: aiSuggestion.category,
    assignedTo: agent,
    customerId: customerId || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
    orderId: orderId || `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    status: 'Pending',
    decision: 'Pending',
    sentiment,
    slaHours: aiSuggestion.priority === 'High' ? 12 : aiSuggestion.priority === 'Medium' ? 24 : 48,
    aiSuggestion: {
      category: aiSuggestion.category,
      priority: aiSuggestion.priority,
      summary: aiSuggestion.summary,
    },
    aiSummary: buildSummary({ subject, description, category: aiSuggestion.category, priority: aiSuggestion.priority, customerName, agent }),
  });

  await sendEmailNotification({
    to: email,
    subject: `SupportFlow ticket received: ${subject}`,
    text: `Your complaint was created successfully. Our AI triage has assigned it to ${agent}. Ticket ID: ${complaint._id}`,
  });

  res.status(201).json(complaint);
});

router.patch('/complaints/:id/decision', protect, requireRole('agent'), async (req, res) => {
  const { decision, agentName, rejectionReason, priority } = req.body;
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  if (isStatusLocked(complaint.status)) {
    return res.status(400).json({ message: 'This ticket is in a final status and cannot be updated.' });
  }

  if (complaint.status !== 'Pending') {
    return res.status(400).json({ message: 'Only pending tickets can be accepted or rejected.' });
  }

  if (decision === 'accept') {
    const validPriority = ['Low', 'Medium', 'High'].includes(priority) ? priority : complaint.priority || 'Medium';
    complaint.status = 'Accepted';
    complaint.decision = 'Accepted';
    complaint.priority = validPriority;
    complaint.assignedTo = agentName || req.user.name || complaint.assignedTo;
    complaint.agentName = agentName || req.user.name || complaint.assignedTo;
    complaint.agentId = req.user._id;
    complaint.rejectionReason = '';
  } else if (decision === 'reject') {
    if (!rejectionReason || !String(rejectionReason).trim()) {
      return res.status(400).json({ message: 'Rejection reason is required.' });
    }

    complaint.status = 'Rejected';
    complaint.decision = 'Rejected';
    complaint.assignedTo = 'Unassigned';
    complaint.agentName = '';
    complaint.rejectionReason = String(rejectionReason).trim();
  } else {
    return res.status(400).json({ message: 'Invalid decision. Use accept or reject.' });
  }

  await complaint.save();

  emitTicketEvent(req, decision === 'accept' ? 'ticket-accepted' : 'ticket-rejected', {
    ticketId: complaint._id,
    ticketNumber: complaint.ticketNumber,
    status: complaint.status,
    message: decision === 'accept'
      ? 'Your ticket has been accepted.'
      : 'Your ticket has been rejected.',
  });

  await sendEmailNotification({
    to: complaint.email,
    subject: `Complaint ${decision === 'accept' ? 'accepted' : 'reviewed'}: ${complaint.subject || complaint.title}`,
    text: `Hello ${complaint.customerName}, your complaint has been ${decision === 'accept' ? 'accepted by our agent team' : 'reviewed and returned for follow-up'}. ${complaint.rejectionReason || ''}`,
  });

  res.json(complaint);
});

router.patch('/complaints/:id/cancel', protect, async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  if (req.user.role !== 'customer') {
    return res.status(403).json({ message: 'Only customers can cancel a ticket.' });
  }

  if (complaint.customerId?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'You can only cancel your own ticket.' });
  }

  if (complaint.status !== 'Pending') {
    return res.status(400).json({ message: 'Only pending tickets can be cancelled.' });
  }

  if (isStatusLocked(complaint.status)) {
    return res.status(400).json({ message: 'This ticket is in a final status and cannot be updated.' });
  }

  complaint.status = 'Cancelled';
  complaint.decision = 'Cancelled';
  complaint.assignedTo = 'Unassigned';
  complaint.rejectionReason = 'Customer cancelled this ticket.';

  await complaint.save();

  await sendEmailNotification({
    to: complaint.email,
    subject: `SupportFlow ticket cancelled: ${complaint.subject || complaint.title}`,
    text: `Hello ${complaint.customerName || req.user.name}, your complaint has been cancelled.`,
  });

  res.json(complaint);
});

router.patch('/complaints/:id/status', protect, requireRole('agent'), async (req, res) => {
  const { status, resolutionNote, completionNote } = req.body;
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  const assignedToAgent = complaint.agentId?.toString() === req.user._id.toString() || complaint.agentName === req.user.name || complaint.assignedTo === req.user.name;
  if (!assignedToAgent) {
    return res.status(403).json({ message: 'You can only update tickets assigned to you.' });
  }

  if (isStatusLocked(complaint.status)) {
    return res.status(400).json({ message: 'This ticket is in a final status and cannot be updated.' });
  }

  if (!ALLOWED_STATUS_UPDATES.has(status)) {
    return res.status(400).json({ message: 'Only Accepted, In Progress, and Completed status updates are allowed.' });
  }

  const allowedTransitions = {
    Accepted: ['In Progress'],
    'In Progress': ['Completed'],
  };

  if (!allowedTransitions[complaint.status]?.includes(status)) {
    return res.status(400).json({ message: `Invalid status transition from ${complaint.status} to ${status}.` });
  }

  if (status === 'Completed' && (!completionNote || !String(completionNote).trim())) {
    return res.status(400).json({ message: 'Completion note is required before marking a ticket completed.' });
  }

  if (status === 'Completed') {
    complaint.status = 'Completed';
    complaint.completionNote = String(completionNote || '').trim();
    complaint.resolutionNote = String(resolutionNote || complaint.resolutionNote || completionNote || '').trim();
    complaint.resolvedAt = new Date();
  } else {
    complaint.status = status;
    complaint.resolutionNote = String(resolutionNote || complaint.resolutionNote || '').trim();
  }

  await complaint.save();

  emitTicketEvent(req, 'status-updated', {
    ticketId: complaint._id,
    ticketNumber: complaint.ticketNumber,
    status: complaint.status,
    message: complaint.status === 'Completed'
      ? 'Your task has been completed.'
      : 'Your task is now in progress.',
  });

  if (complaint.status === 'Completed') {
    emitTicketEvent(req, 'ticket-completed', {
      ticketId: complaint._id,
      ticketNumber: complaint.ticketNumber,
      status: 'Completed',
      message: 'Your task has been completed.',
    });
  }

  await sendEmailNotification({
    to: complaint.email,
    subject: `SupportFlow status update: ${complaint.subject || complaint.title}`,
    text: `Hello ${complaint.customerName}, your complaint status is now ${complaint.status}. ${complaint.resolutionNote || complaint.completionNote || 'Please keep checking your workspace page for details.'}`,
  });

  res.json(complaint);
});

router.get('/complaints/:id/messages', protect, async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  if (!ensureTicketAccess(req, res, complaint)) {
    return;
  }

  const messages = await Message.find({ ticketId: complaint._id }).sort({ createdAt: 1 }).lean();
  res.json(messages);
});

router.post('/complaints/:id/messages', protect, async (req, res) => {
  const { message } = req.body;
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  if (!ensureTicketAccess(req, res, complaint)) {
    return;
  }

  if (!message || !String(message).trim()) {
    return res.status(400).json({ message: 'Message is required.' });
  }

  const savedMessage = await Message.create({
    ticketId: complaint._id,
    senderId: req.user._id,
    senderRole: req.user.role,
    message: String(message).trim(),
  });

  emitTicketEvent(req, 'new-message', {
    ticketId: complaint._id,
    ticketNumber: complaint.ticketNumber,
    message: savedMessage,
  });

  res.status(201).json(savedMessage);
});

router.patch('/complaints/:id/review', protect, async (req, res) => {
  const { rating, review } = req.body;
  const complaint = await Complaint.findById(req.params.id);

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' });
  }

  if (req.user.role !== 'customer' || complaint.customerId?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Only the ticket owner can submit a review.' });
  }

  if (complaint.status !== 'Completed') {
    return res.status(400).json({ message: 'Reviews can only be submitted after the complaint is completed.' });
  }

  if (complaint.rating != null || complaint.review) {
    return res.status(409).json({ message: 'This ticket has already been reviewed.' });
  }

  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
  }

  const trimmedReview = String(review || '').trim();
  if (!trimmedReview) {
    return res.status(400).json({ message: 'Review message is required.' });
  }

  complaint.rating = numericRating;
  complaint.review = trimmedReview;
  complaint.resolvedAt = complaint.resolvedAt || new Date();

  await complaint.save();

  emitTicketEvent(req, 'ticket-reviewed', {
    ticketId: complaint._id,
    ticketNumber: complaint.ticketNumber,
    rating: numericRating,
    review: trimmedReview,
  });

  res.json(complaint);
});

router.patch('/complaints/:id', protect, async (req, res) => {
  return res.status(403).json({ message: 'Direct complaint updates are disabled. Use the supported workflow routes.' });
});

export default router;
