const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  paidBy: { type: String, required: true },
  splitWith: [String], // array of usernames
  createdAt: { type: Date, default: Date.now }
});

// Use custom collection name
module.exports = mongoose.model('Expense', expenseSchema, 'Splitter');
