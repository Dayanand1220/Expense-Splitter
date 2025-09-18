const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');

// Add a new expense
router.post('/', async (req, res) => {
  try {
    const expense = new Expense(req.body);
    await expense.save();
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all expenses
router.get('/', async (req, res) => {
  try {
    const expenses = await Expense.find();
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get balances for each person
router.get('/balances', async (req, res) => {
  try {
    const expenses = await Expense.find();

    const balances = {};

    expenses.forEach(exp => {
      const totalPeople = exp.splitWith.length + 1; // payer + splitWith
      const share = exp.amount / totalPeople;

      // initialize balances
      if (!balances[exp.paidBy]) balances[exp.paidBy] = 0;
      balances[exp.paidBy] += exp.amount - share; // payer's net

      exp.splitWith.forEach(person => {
        if (!balances[person]) balances[person] = 0;
        balances[person] -= share; // each owes their share
      });
    });

    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
