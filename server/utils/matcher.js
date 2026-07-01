const prisma = require("./db");

//  Text helpers
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'how', 'can', 'i', 'where', 'what',
  'when', 'should', 'use', 'to', 'do', 'does', 'my', 'in', 'for', 'of',
  'on', 'it', 'this', 'that', 'be', 'check', 'view', 'see', 'please',
  'could', 'would', 'will', 'shall', 'may', 'might', 'must'
]);

const GREETINGS = {
  'hi': '👋 Hello and welcome! How can I assist you today? Please describe your use case in detail so I can help you effectively.',
  'hey': '👋 Hey there! How can I help you with the system?',
  'hello': '👋 Hello and welcome! How can I assist you today?',
  'hii': '👋 Hello and welcome! How can I assist you today?',
  'good morning': getTimeBasedGreeting('morning'),
  'good afternoon': getTimeBasedGreeting('afternoon'),
  'good evening': getTimeBasedGreeting('evening'),
  'good night': '🌙 Good night! Is there anything I can help you with before you go?',
  'gm': '🌅 Good morning! How can I assist you today?',
  'gn': '🌙 Good night! Is there anything I need to help you with?',
  'thanks': 'You\'re welcome! 😊 Is there anything else I can help you with?',
  'thank you': 'You\'re welcome! 😊 Happy to help!',
  'help': 'I\'m here to help! You can ask me about:\n• 📋 Task Management\n• 💰 Billing & Invoices\n• 📊 Reports\n• 🔐 Authentication\n• 👤 User Management\n• 🏢 Client Management\n\nWhat would you like to know?'
};

// Time-based greeting function
function getTimeBasedGreeting(timeOfDay) {
  const greetings = {
    morning: '🌅 Good morning! How can I assist you with your tasks today?',
    afternoon: '☀️ Good afternoon! What can I help you with?',
    evening: '🌆 Good evening! How may I assist you?'
  };
  return greetings[timeOfDay] || '👋 Hello! How can I assist you?';
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function keywordSet(text) {
  return new Set(tokenize(text).filter((w) => !STOP_WORDS.has(w)));
}

// Check if the query is a greeting
function isGreeting(query) {
  const lowerQuery = query.toLowerCase().trim();
  if (GREETINGS[lowerQuery]) return true;
  for (const [key, value] of Object.entries(GREETINGS)) {
    if (lowerQuery.startsWith(key) || lowerQuery.includes(key)) {
      return true;
    }
  }
  return false;
}

// Get greeting response
function getGreetingResponse(query) {
  const lowerQuery = query.toLowerCase().trim();
  if (GREETINGS[lowerQuery]) {
    return GREETINGS[lowerQuery];
  }
  for (const [key, value] of Object.entries(GREETINGS)) {
    if (lowerQuery.startsWith(key) || lowerQuery.includes(key)) {
      if (key === 'good morning' || key === 'good afternoon' || key === 'good evening') {
        const timeOfDay = key.split(' ')[1];
        return getTimeBasedGreeting(timeOfDay);
      }
      return value;
    }
  }
  return GREETINGS['hi'];
}

// Advanced scoring with multiple factors
function scoreEntry(queryWords, entry, userQuery) {
  let overlap = 0;
  const queryWordsArray = Array.from(queryWords);

  queryWordsArray.forEach((w) => {
    if (entry.keywords && entry.keywords.has(w)) overlap += 1;
  });

  if (overlap === 0) return 0;

  const union = new Set([...queryWords, ...(entry.keywords || new Set())]).size;
  let score = overlap / union;

  // Boost score if the query contains important keywords from the section
  const sectionKeywords = entry.section.toLowerCase().split(' ');
  sectionKeywords.forEach(kw => {
    if (userQuery.toLowerCase().includes(kw)) {
      score += 0.1;
    }
  });

  // Boost score for exact phrase matches
  if (userQuery.toLowerCase().includes(entry.question.toLowerCase())) {
    score += 0.2;
  }

  return Math.min(score, 1);
}

// Cache for knowledge base to avoid database hits
let knowledgeBaseCache = null;
let lastCacheUpdate = null;
const CACHE_TTL = 5 * 60 * 1000;

async function loadKnowledgeBase() {
  const now = Date.now();
  if (knowledgeBaseCache && lastCacheUpdate && (now - lastCacheUpdate) < CACHE_TTL) {
    return knowledgeBaseCache;
  }

  try {
    const kb = await prisma.knowledgeBase.findMany({
      select: {
        id: true,
        section: true,
        question: true,
        answer: true,
        keywords: true
      }
    });

    // Index the knowledge base
    knowledgeBaseCache = kb.map(item => ({
      ...item,
      keywords: new Set(item.keywords || keywordSet(item.question))
    }));

    lastCacheUpdate = now;
    return knowledgeBaseCache;
  } catch (error) {
    console.error('Error loading knowledge base:', error);
    return [];
  }
}

async function findAnswer(userQuery) {
  // Check for greetings first
  if (isGreeting(userQuery)) {
    return {
      matched: true,
      confidence: 1.0,
      section: 'Greeting',
      question: userQuery,
      answer: getGreetingResponse(userQuery),
      isGreeting: true
    };
  }

  const queryWords = keywordSet(userQuery);
  if (queryWords.size === 0) {
    return fallbackResponse();
  }

  // Load knowledge base from database
  const kb = await loadKnowledgeBase();

  if (kb.length === 0) {
    return fallbackResponse('No knowledge base available');
  }

  let best = null;
  let bestScore = 0;
  const matches = [];

  // Find all matches with scores
  for (const entry of kb) {
    const score = scoreEntry(queryWords, entry, userQuery);
    if (score > 0) {
      matches.push({ entry, score });
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }

  // Sort matches by score for better context
  matches.sort((a, b) => b.score - a.score);

  // Dynamic threshold based on best score
  const THRESHOLD = bestScore > 0.3 ? 0.15 : 0.2;

  if (best && bestScore >= THRESHOLD) {
    return {
      matched: true,
      confidence: Number(bestScore.toFixed(2)),
      section: best.section,
      question: best.question,
      answer: best.answer,
      matches: matches.slice(0, 3).map(m => ({
        question: m.entry.question,
        score: m.score
      }))
    };
  }

  // Provide similar questions if close match
  if (best && bestScore > 0.05) {
    return {
      matched: false,
      confidence: Number(bestScore.toFixed(2)),
      section: null,
      question: null,
      answer: `📝 I'm not entirely sure about that. Did you mean: "${best.question}"?\n\nYou can also ask about:\n• GST & Tax Compliance\n• TDS Returns\n• Accounting & Bookkeeping\n• ROC & MCA Filings\n• ITR Filing\n• Audit & Compliance\n\nWhat specific information are you looking for?`
    };
  }

  return fallbackResponse();
}

function fallbackResponse(customMessage) {
  return {
    matched: false,
    confidence: 0,
    section: null,
    question: null,
    answer: customMessage || "🤔 I don't have a specific answer for that yet. Try rephrasing your question, or ask about:\n\n• 🔐 Authentication & Login\n• 👤 User Management\n• 🏢 Client Management\n• 📋 Task Management\n• 💰 Billing & Invoices\n• 📊 Reports\n• 🔒 Security\n• 📄 Documents\n\nI'm here to help! What would you like to know?"
  };
}

async function listSections() {
  try {
    const sections = await prisma.knowledgeBase.groupBy({
      by: ['section'],
      _count: {
        section: true
      }
    });

    return sections.reduce((acc, curr) => {
      acc[curr.section] = curr._count.section;
      return acc;
    }, {});
  } catch (error) {
    console.error('Error listing sections:', error);
    return {};
  }
}

async function getQuestionsBySection(section) {
  try {
    return await prisma.knowledgeBase.findMany({
      where: {
        section: {
          equals: section,
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        section: true,
        question: true,
        answer: true
      }
    });
  } catch (error) {
    console.error('Error getting questions by section:', error);
    return [];
  }
}

async function addKnowledgeBaseEntry(section, question, answer, keywords = []) {
  try {
    const entry = await prisma.knowledgeBase.create({
      data: {
        section,
        question,
        answer,
        keywords: keywords.length > 0 ? keywords : Array.from(keywordSet(question))
      }
    });

    // Invalidate cache
    knowledgeBaseCache = null;
    lastCacheUpdate = null;

    return entry;
  } catch (error) {
    console.error('Error adding knowledge base entry:', error);
    throw error;
  }
}

module.exports = {
  findAnswer,
  listSections,
  getQuestionsBySection,
  addKnowledgeBaseEntry,
  loadKnowledgeBase
};