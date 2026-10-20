// 生成 portal 访问令牌并写入 portal/.portal_token（权限 600，已被 .gitignore 排除）
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const target = path.join(__dirname, '..', 'portal', '.portal_token');
const token = 'pt_' + crypto.randomBytes(24).toString('base64url');

fs.writeFileSync(target, token + '\n', { mode: 0o600 });
const stat = fs.statSync(target);
console.log('written:', target);
console.log('bytes:', stat.size, '| mode:', (stat.mode & 0o777).toString(8));
console.log('identify:', token.slice(0, 8) + '...' + token.slice(-4), '(仅识别用，不明文)');
