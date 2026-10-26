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

// In-memory queue and tracking states
const requestQueue = [];
let isProcessing = false;

// Status endpoint to monitor queue health
app.get('/api/v1/status', (req, res) => {
  res.status(200).json({
    status: 'online',
    queueLength: requestQueue.length,
    isProcessing: isProcessing,
    currentQueue: requestQueue
  });
});

// Endpoint to key in / add mobile numbers to the STK push queue
app.post('/api/v1/queue-stk', (req, res) => {
  const { phoneNumber, amount, reference, description } = req.body;

  if (!phoneNumber || !amount) {
    return res.status(400).json({ error: 'phoneNumber and amount are required.' });
  }

  const task = {
    id: Math.random().toString(36).substring(2, 9),
    phoneNumber,
    amount,
    reference: reference || `INV-${Math.floor(10000 + Math.random() * 90000)}`,
    description: description || 'Retail Checkout',
    queuedAt: new Date().toISOString()
  };

  requestQueue.push(task);
  console.log(`[Queue Added] Phone: ${phoneNumber} | Total in queue: ${requestQueue.length}`);

  // Trigger processor loop if not already running
  if (!isProcessing) {
    processQueue();
  }

  return res.status(202).json({
    message: 'STK push queued successfully.',
    position: requestQueue.length,
    task
  });
});

// Background Worker processing items 6 minutes apart (360,000 ms)
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

    console.log(`[Success] STK sent to ${currentTask.phoneNumber}:`, response.data);
  } catch (error) {
    console.error(`[Error] Failed STK push for ${currentTask.phoneNumber}:`, error.response?.data || error.message);
  }

  // Enforce a strict 6-minute delay before processing the next request
  const SIX_MINUTES = 6 * 60 * 1000;
  console.log(`[Cooling Down] Waiting 6 minutes before processing the next request...`);
  
  setTimeout(processQueue, SIX_MINUTES);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`STK Push Bot server running on port ${PORT}`);
});
