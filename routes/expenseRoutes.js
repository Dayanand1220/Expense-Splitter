const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.LLM_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Helper function to calculate balances
function calculateBalances(expenses) {
  const balances = {};
  
  console.log(`Calculating balances for ${expenses.length} expenses`);
  
  expenses.forEach(exp => {
    // Check if the expense is a settlement
    const isSettlement = exp.description.toLowerCase().includes('settlement');
    
    if (isSettlement) {
      // **CORRECTED LOGIC**
      // The person who paid back (paidBy) is now settled up (their debt decreases).
      // The person who received the payment (splitWith[0]) now has less to be paid back (their credit decreases).
      const personPaying = exp.paidBy;
      const personReceiving = exp.splitWith[0];

      if (!balances[personPaying]) balances[personPaying] = 0;
      if (!balances[personReceiving]) balances[personReceiving] = 0;
      
      balances[personPaying] += exp.amount;
      balances[personReceiving] -= exp.amount;
    } else {
      // Normal expense calculation logic
      const totalPeople = exp.splitWith.length + 1; // +1 for the person who paid
      const share = exp.amount / totalPeople;
      
      if (!balances[exp.paidBy]) balances[exp.paidBy] = 0;
      balances[exp.paidBy] += exp.amount - share;
      
      exp.splitWith.forEach(person => {
        if (!balances[person]) balances[person] = 0;
        balances[person] -= share;
      });
    }
  });
  
  // Clean up settled balances to show zero
  for (const person in balances) {
    if (Math.abs(balances[person]) < 0.01) { // Use a small epsilon for floating-point comparison
      balances[person] = 0;
    }
  }

  console.log('Final balances:', balances);
  return balances;
}

// Simple rule-based intent detection (more reliable than LLM for this case)
function detectIntent(message) {
  const lowerMessage = message.toLowerCase().trim();
  const nameMatch = message.match(/\b([A-Z][a-z]+)\b/);
  const personName = nameMatch ? nameMatch[1] : null;

  console.log(`Processing message: "${message}"`);
  console.log(`Extracted name: ${personName}`);
  
  // Prioritize general intents before looking for specific names
  if (lowerMessage.includes('balance') && !personName) {
    console.log('Detected intent: GET_BALANCES');
    return { intent: 'GET_BALANCES', entities: {} };
  }
  
  if (lowerMessage.includes('expense') || lowerMessage.includes('show') || lowerMessage.includes('list')) {
    console.log('Detected intent: GET_EXPENSES');
    return { intent: 'GET_EXPENSES', entities: {} };
  }
  
  if ((lowerMessage.includes('owe') || lowerMessage.includes('balance') || lowerMessage.includes('debt')) && personName) {
    console.log('Detected intent: GET_BALANCE_BY_PERSON');
    return {
      intent: 'GET_BALANCE_BY_PERSON',
      entities: { person_name: personName }
    };
  }
  
  if ((lowerMessage.includes('paid') || lowerMessage.includes('pay')) && personName && !lowerMessage.includes('owe')) {
    console.log('Detected intent: GET_PAID_BY_PERSON');
    return {
      intent: 'GET_PAID_BY_PERSON',
      entities: { person_name: personName }
    };
  }
  
  console.log('Detected intent: UNKNOWN');
  return { intent: 'UNKNOWN', entities: {} };
}

// New settlement endpoint to record a payment
router.post('/settle', async (req, res) => {
  try {
    const { personOwes, personReceives, amount } = req.body;
    
    // Create a new expense record to represent the settlement
    const settlementExpense = new Expense({
      description: `Settlement from ${personOwes} to ${personReceives}`,
      amount: amount, // The amount is the settlement value
      paidBy: personOwes, // The person who pays is the one who owes
      splitWith: [personReceives], // The person who receives is the one who is owed
    });
    
    await settlementExpense.save();
    res.status(200).json({ message: 'Settlement recorded successfully.', settlementExpense });
  } catch (err) {
    console.error("Settlement API error:", err);
    res.status(500).json({ error: 'Sorry, I am having trouble processing your settlement request.' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const { intent, entities } = detectIntent(message);
    let botResponse = "";

    switch (intent) {
      case "GET_BALANCES": {
        const expenses = await Expense.find();
        const balances = calculateBalances(expenses);

        if (Object.keys(balances).length === 0) {
          botResponse = "There are no balances yet. Please add some expenses.";
        } else {
          botResponse = "Current Balances:\n";
          for (const [person, balance] of Object.entries(balances)) {
            if (balance > 0) {
              botResponse += `- ${person} should receive ₹${balance.toFixed(2)}\n`;
            } else if (balance < 0) {
              botResponse += `- ${person} owes ₹${Math.abs(balance).toFixed(2)}\n`;
            } else {
              botResponse += `- ${person} is settled up\n`;
            }
          }
        }
        break;
      }

      case "GET_BALANCE_BY_PERSON": {
        const personName = entities.person_name;
        console.log(`Looking up balance for: ${personName}`);
        
        const expenses = await Expense.find();
        console.log(`Found ${expenses.length} expenses in database`);
        
        const balances = calculateBalances(expenses);
        
        const personKey = Object.keys(balances).find(
          key => key.toLowerCase() === personName.toLowerCase()
        );

        if (personKey) {
          const balance = balances[personKey];
          console.log(`Balance for ${personKey}: ${balance}`);
          
          if (balance > 0) {
            botResponse = `${personKey} should receive ₹${balance.toFixed(2)}.`;
          } else if (balance < 0) {
            botResponse = `${personKey} owes ₹${Math.abs(balance).toFixed(2)}.`;
          } else {
            botResponse = `${personKey} is all settled up! No money owed or to receive.`;
          }
        } else {
          botResponse = `I couldn't find any balance for ${personName}. They might not be involved in any expenses yet.`;
        }
        break;
      }

      case "GET_EXPENSES": {
        const expenses = await Expense.find();
        if (expenses.length === 0) {
          botResponse = "You haven't added any expenses yet.";
        } else {
          botResponse = "Here are all the expenses:\n";
          expenses.forEach(exp => {
            botResponse += `- ${exp.description} (₹${exp.amount}) paid by ${exp.paidBy}, split with ${exp.splitWith.length > 0 ? exp.splitWith.join(", ") : "N/A"}\n`;
          });
        }
        break;
      }

      case "GET_PAID_BY_PERSON": {
        const personName = entities.person_name;
        if (personName) {
          const totalPaid = await Expense.aggregate([
            { $match: { paidBy: { $regex: new RegExp(`^${personName}$`, 'i') } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
          ]);
          const totalAmount = totalPaid.length > 0 ? totalPaid[0].total : 0;
          botResponse = `${personName} has paid a total of ₹${totalAmount.toFixed(2)} across all expenses.`;
        } else {
          botResponse = "I need a name to tell you how much a person has paid. Try asking, 'How much did John pay?'";
        }
        break;
      }

      default:
        botResponse = "I didn't quite get that 🤔. Try asking:\n- 'What are the balances?'\n- 'Show me all expenses.'\n- 'How much did <name> pay?'\n- 'How much does <name> owe?'";
        break;
    }

    console.log(`Bot response: ${botResponse}`);
    res.json({ response: botResponse });
  } catch (err) {
    console.error("Chatbot API error:", err);
    res.status(500).json({ error: 'Sorry, I am having trouble processing your request.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const expense = new Expense(req.body);
    await expense.save();
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const expenses = await Expense.find();
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/balances', async (req, res) => {
  try {
    const expenses = await Expense.find();
    const balances = calculateBalances(expenses);
    res.json(balances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/paidby/:person', async (req, res) => {
  try {
    const person = req.params.person;
    const expenses = await Expense.find({ paidBy: { $regex: new RegExp(`^${person}$`, 'i') } });
    const totalAmount = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    res.json({ person, totalAmount, expenses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const recentExpenses = await Expense.find().sort({ createdAt: -1 }).limit(5);
    res.json(recentExpenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;