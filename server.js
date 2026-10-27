const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state
const requestQueue = [];
const requestHistory = [];
let isProcessing = false;

// Status & History endpoint for the frontend dashboard
app.get('/api/v1/status', (req, res) => {
  res.status(200).json({
    status: 'online',
    queueLength: requestQueue.length,
    isProcessing: isProcessing,
    history: requestHistory.slice(0, 20) // Return last 20 processed items
  });
});

// Endpoint to queue bulk or single STK push requests
app.post('/api/v1/queue-stk', (req, res) => {
  let { phoneNumbers, amount, reference, description } = req.body;

  if (!phoneNumbers || !amount) {
    return res.status(400).json({ error: 'phoneNumbers and amount are required.' });
  }

  // Normalize phoneNumbers: handle strings (comma/newline separated) or arrays
  let numbersArray = [];
  if (Array.isArray(phoneNumbers)) {
    numbersArray = phoneNumbers;
  } else if (typeof phoneNumbers === 'string') {
    numbersArray = phoneNumbers
      .split(/[\n,]+/)
      .map(num => num.trim())
      .filter(num => num.length > 0);
  }

  if (numbersArray.length === 0) {
    return res.status(400).json({ error: 'No valid phone numbers provided.' });
  }

  const addedTasks = [];

  numbersArray.forEach((phoneNumber, index) => {
    const task = {
      id: Math.random().toString(36).substring(2, 9),
      phoneNumber,
      amount: Number(amount),
      reference: reference ? `${reference}-${index + 1}` : `INV-${Math.floor(10000 + Math.random() * 90000)}`,
      description: description || 'Retail Checkout',
      queuedAt: new Date().toISOString()
    };
    requestQueue.push(task);
    addedTasks.push(task);
  });

  console.log(`[Bulk Queued] Added ${addedTasks.length} numbers. Total queue length: ${requestQueue.length}`);

  // Trigger processor loop if not already running
  if (!isProcessing) {
    processQueue();
  }

  return res.status(202).json({
    message: `Successfully queued ${addedTasks.length} STK push requests.`,
    queueLength: requestQueue.length,
    addedTasks
  });
});

// Background Worker processing items 6 seconds apart (6,000 ms)
async function processQueue() {
  if (requestQueue.length === 0) {
    isProcessing = false;
    console.log('[Queue Worker] Queue is empty. Worker resting.');
    return;
  }

  isProcessing = true;
  const currentTask = requestQueue.shift();

  console.log(`[Processing] Sending STK push to ${currentTask.phoneNumber} for Amount: ${currentTask.amount}`);

  try {
    const response = await axios.post(
      'https://api.gravitypayapp.com/api/v1/stk/push',
      {
        phoneNumber: currentTask.phoneNumber,
        amount: currentTask.amount,
        reference: currentTask.reference,
        description: currentTask.description
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GRAVITY_SECRET_KEY}`,
          'x-api-key': process.env.GRAVITY_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const successRecord = {
      ...currentTask,
      status: 'SUCCESS',
      responsePayload: response.data,
      processedAt: new Date().toISOString()
    };

    requestHistory.unshift(successRecord);
    console.log(`[Success] STK sent to ${currentTask.phoneNumber}:`, response.data);
  } catch (error) {
    const errorRecord = {
      ...currentTask,
      status: 'FAILED',
      errorDetails: error.response?.data || error.message,
      processedAt: new Date().toISOString()
    };

    requestHistory.unshift(errorRecord);
    console.error(`[Error] Failed STK push for ${currentTask.phoneNumber}:`, errorRecord.errorDetails);
  }

  // Enforce strict 6-second interval (6,000 ms) before next push
  const SIX_SECONDS = 6 * 1000;
  console.log(`[Cooling Down] Waiting 6 seconds before processing the next request...`);
  
  setTimeout(processQueue, SIX_SECONDS);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`STK Push Bot server running on port ${PORT}`);
});
