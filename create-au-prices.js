#!/usr/bin/env node
/**
 * Creates missing AU Stripe prices for tallow/honey balm and gift box.
 * Run: STRIPE_AU_KEY=sk_live_xxxx node create-au-prices.js
 */

const Stripe = require('stripe');

const AU_KEY = process.env.STRIPE_AU_KEY;
if (!AU_KEY) {
  console.error('Set STRIPE_AU_KEY env var first.\nUsage: STRIPE_AU_KEY=sk_live_xxx node create-au-prices.js');
  process.exit(1);
}

const stripe = Stripe(AU_KEY);

// Reference existing AU prices to look up product IDs
const REFS = {
  balmProductRef:    'price_1T7QqsJzNO9WRf4JI3YiIGvC', // lavender 60ml AU (tallow balm)
  honeyProductRef:   'price_1T7Qq6JzNO9WRf4JGNn1BvID', // honey balm vanilla 60ml AU
  giftboxProductRef: 'price_1T7QkgJzNO9WRf4JX1lIuVWv', // gift box half AU
};

// Prices to create: [nickname, amountAUD_cents, productRefKey]
const TO_CREATE = [
  // Tallow Balm
  { nickname: 'Balm-N120',     amount: 2995, productRef: 'balmProductRef' },
  { nickname: 'Balm-VR250',    amount: 4495, productRef: 'balmProductRef' },
  { nickname: 'Balm-L250',     amount: 4495, productRef: 'balmProductRef' },
  { nickname: 'Balm-F250',     amount: 4495, productRef: 'balmProductRef' },
  { nickname: 'Balm-N250',     amount: 4495, productRef: 'balmProductRef' },
  // Honey Balm
  { nickname: 'Balm-MV250',    amount: 5495, productRef: 'honeyProductRef' },
  { nickname: 'Balm-MBT250',   amount: 5495, productRef: 'honeyProductRef' },
  { nickname: 'Balm-MV60-3pk', amount: 5768, productRef: 'honeyProductRef' },
  // Gift Box
  { nickname: 'Gift-box-full', amount: 11995, productRef: 'giftboxProductRef' },
];

async function main() {
  // Look up product IDs from reference prices
  console.log('Looking up product IDs from reference prices...');
  const productIds = {};
  for (const [key, priceId] of Object.entries(REFS)) {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    productIds[key] = price.product.id;
    console.log(`  ${key}: ${price.product.id} (${price.product.name})`);
  }

  // Create each price
  console.log('\nCreating prices...');
  const results = [];
  for (const item of TO_CREATE) {
    const created = await stripe.prices.create({
      currency: 'aud',
      unit_amount: item.amount,
      product: productIds[item.productRef],
      nickname: item.nickname,
    });
    results.push({ nickname: item.nickname, priceId: created.id, amount: item.amount });
    console.log(`  ✓ ${item.nickname}: ${created.id}  (A$${(item.amount / 100).toFixed(2)})`);
  }

  // Print YAML snippet to paste into pricing.yaml
  console.log('\n--- Copy this into pricing.yaml ---');

  const balmResults = results.filter(r => r.nickname.startsWith('Balm-') && !r.nickname.startsWith('Balm-M'));
  const honeyResults = results.filter(r => r.nickname.startsWith('Balm-M'));
  const giftResults = results.filter(r => r.nickname.startsWith('Gift-'));

  console.log('\n# Tallow Balm single/neutral 120ml:');
  balmResults.forEach(r => console.log(`  # ${r.nickname}\n  AU: "${r.priceId}"`));

  console.log('\n# Honey Balm:');
  honeyResults.forEach(r => console.log(`  # ${r.nickname}\n  AU: "${r.priceId}"`));

  console.log('\n# Gift Box:');
  giftResults.forEach(r => console.log(`  # ${r.nickname}\n  AU: "${r.priceId}"`));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
