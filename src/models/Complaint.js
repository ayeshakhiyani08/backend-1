import mongoose from 'mongoose';

const generateTicketCode = async () => {
  const lastComplaint = await mongoose.models.Complaint.findOne({}, { ticketNumber: 1 }).sort({ createdAt: -1, _id: -1 }).lean();

  if (!lastComplaint?.ticketNumber) {
    return 'SF-1001';
  }

  const lastNumber = Number(String(lastComplaint.ticketNumber).split('-').pop() || '1000');
  return `SF-${lastNumber + 1}`;
};

const complaintSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true, sparse: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    title: { type: String, default: '' },
    complaint: { type: String, default: '' },
    address: { type: String, default: '' },
    image: { type: String, default: '' },
    category: { type: String, default: 'General Support' },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
    },
    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'In Progress', 'Rejected', 'Cancelled', 'Completed'],
      default: 'Pending',
    },
    aiSuggestion: {
      category: { type: String, default: '' },
      priority: { type: String, default: '' },
      summary: { type: String, default: '' },
    },
    rejectionReason: { type: String, default: '' },
    completionNote: { type: String, default: '' },
    rating: { type: Number, min: 1, max: 5, default: null },
    review: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    customerName: { type: String, default: '' },
    email: { type: String, default: '' },
    subject: { type: String, default: '' },
    channel: { type: String, default: 'Email' },
    decision: { type: String, default: 'Pending' },
    assignedTo: { type: String, default: '' },
    agentName: { type: String, default: '' },
    aiSummary: { type: String, default: '' },
    sentiment: { type: String, default: 'Neutral' },
    slaHours: { type: Number, default: 24 },
    orderId: { type: String, default: '' },
    resolutionNote: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: false, strict: false }
);

complaintSchema.pre('save', async function preSave(next) {
  if (!this.ticketNumber) {
    this.ticketNumber = await generateTicketCode();
  }

  this.updatedAt = new Date();

  if (!this.createdAt) {
    this.createdAt = new Date();
  }

  next();
});

export default mongoose.model('Complaint', complaintSchema);
