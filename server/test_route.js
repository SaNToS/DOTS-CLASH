const jwt = require('jsonwebtoken');
const http = require('http');
const JWT_SECRET = 'supersecret_dots_key'; // Default from .env

const token = jwt.sign({ userId: 'some-uid', username: 'testuser' }, JWT_SECRET, { expiresIn: '1h' });
console.log('Test Token:', token);

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/auth/bonuses',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`
  }
};

const req = http.request(options, (res) => {
  console.log('Response Status:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response Body:', data);
  });
});

req.on('error', (e) => {
  console.error('Problem with request:', e.message);
});

req.end();
