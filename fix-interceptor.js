const fs = require('fs');
const file = '/home/sr-user91/Documents/Projects/CRM/frontend/src/api/client.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  'if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {',
  'if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !originalRequest.url?.includes(\'/auth/login\') && !originalRequest.url?.includes(\'/auth/refresh\')) {'
);
fs.writeFileSync(file, code);
