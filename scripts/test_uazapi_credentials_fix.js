const axios = require('axios');
const fs = require('fs');

async function test() {
  console.log('=== TEST 1: index.html check ===');
  const html = fs.readFileSync('./public/index.html', 'utf8');
  console.log('Has hidden url:', html.includes('id="uazapi-url" value="https://whatsblin.uazapi.com"'));
  console.log('Has hidden token:', html.includes('id="uazapi-admintoken" value="Wx0bdo99r3VtcDwC8ulQezVLNDY7rcFOzSWgyS7Q9vjWwKKMJp"'));
  console.log('Card web active:', html.includes('class="leona-type-card active" id="card-type-web"'));
  console.log('No visible adminToken input:', !html.includes('id="uazapi-admintoken" placeholder'));

  console.log('\n=== TEST 2: API Login and Init-Connect ===');
  const login = await axios.post('http://localhost:3000/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.data.token;
  
  const connectRes = await axios.post(
    'http://localhost:3000/api/uazapi/init-connect',
    { name: 'NOVA', assignedFlowId: 'fluxo-espiao-foto' },
    { headers: { Authorization: 'Bearer ' + token } }
  );
  console.log('Init-Connect Status:', connectRes.status);
  console.log('QR Code generated successfully:', Boolean(connectRes.data.qrcode && connectRes.data.qrcode.startsWith('data:image')));
  console.log('Instance ID:', connectRes.data.instanceId);

  console.log('\n=== TEST 3: Status Polling ===');
  const statusRes = await axios.get('http://localhost:3000/api/uazapi/status/' + connectRes.data.instanceId, {
    headers: { Authorization: 'Bearer ' + token }
  });
  console.log('Status Polling OK:', statusRes.status, statusRes.data.instance?.status);

  console.log('\n=== ALL TESTS PASSED! ===');
}

test().catch(err => {
  console.error('Test failed:', err.response?.data || err.message);
  process.exit(1);
});
