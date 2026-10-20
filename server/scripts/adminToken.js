// Prints a short-lived admin token for the chat AdminDashboard:
//   npm run admin-token [hours]
require('dotenv').config();
const { signToken } = require('../ai/auth');
const secret = process.env.CHAT_AUTH_SECRET;
if (!secret) {
  console.error('CHAT_AUTH_SECRET is not set; admin sockets need no token in this mode.');
  process.exit(1);
}
const hours = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 8;
console.log(signToken({ id: 'admin', name: 'Admin', role: 'admin', aud: 'dashboard', exp: Math.floor(Date.now() / 1000) + hours * 3600 }, secret));
