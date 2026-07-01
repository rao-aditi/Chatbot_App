require('dotenv').config();
const path = require('path');
const fs = require('fs');
const prisma = require('./db');

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'how', 'can', 'i', 'where', 'what',
  'when', 'should', 'use', 'to', 'do', 'does', 'my', 'in', 'for', 'of',
  'on', 'it', 'this', 'that', 'be', 'check', 'view', 'see', 'please',
  'could', 'would', 'will', 'shall', 'may', 'might', 'must'
]);

function keywordsFromText(text) {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w))
  )];
}

async function seed() {
  const filePath = path.join(__dirname, '../data/knowledgeBase.json');

  if (!fs.existsSync(filePath)) {
    console.error(' knowledgeBase.json not found at:', filePath);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(` Found ${data.length} entries in knowledgeBase.json`);

  let inserted = 0;
  let skipped = 0;

  for (const item of data) {
    // Check for duplicate question
    const existing = await prisma.knowledgeBase.findFirst({
      where: { question: item.question }
    });

    if (existing) {
      console.log(`  ⏭  Skipped (already exists): "${item.question}"`);
      skipped++;
      continue;
    }

    const keywords = item.keywords?.length
      ? item.keywords
      : keywordsFromText(item.question);

    await prisma.knowledgeBase.create({
      data: {
        section: item.section,
        question: item.question,
        answer: item.answer,
        keywords,
      }
    });

    console.log(`Inserted: "${item.question}"`);
    inserted++;
  }

  console.log(`\n Done! Inserted: ${inserted}, Skipped: ${skipped}`);
  await prisma.$disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
