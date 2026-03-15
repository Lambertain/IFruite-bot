require('dotenv').config();
const { runScan } = require('./scheduler/index');

runScan().then(() => {
  console.log('Scan complete');
  process.exit(0);
}).catch(err => {
  console.error('Scan failed:', err);
  process.exit(1);
});
