const express = require('express');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../prisma/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_dots_key';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const PACKS = {
  small:  { bonuses: 5,  price: 99,   label: '5 Bonuses' },
  medium: { bonuses: 20, price: 299,  label: '20 Bonuses' },
  large:  { bonuses: 50, price: 499,  label: '50 Bonuses' },
};

// POST /api/payment/create-checkout
// Body: { pack: 'small'|'medium'|'large' }
// Header: Authorization: Bearer <token>
router.post('/create-checkout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const payload = jwt.verify(token, JWT_SECRET);
    const pack = req.body.pack;
    if (!PACKS[pack]) return res.status(400).json({ error: 'Invalid pack' });

    const { bonuses, price, label } = PACKS[pack];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: price, // in cents
            product_data: {
              name: `Dots Clash — ${label}`,
              description: `${bonuses} bonus${bonuses > 1 ? 'es' : ''} for undoing moves`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: payload.userId,
        pack,
        bonuses: String(bonuses),
      },
      success_url: `${CLIENT_URL}/lobby?payment=success&pack=${pack}`,
      cancel_url:  `${CLIENT_URL}/lobby?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/webhook
// Called by Stripe after successful payment — raw body required
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, bonuses } = session.metadata;

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { bonuses: { increment: Number(bonuses) } },
      });
      console.log(`Credited ${bonuses} bonuses to user ${userId}`);
    } catch (err) {
      console.error('Failed to credit bonuses:', err);
    }
  }

  res.json({ received: true });
});

module.exports = router;
