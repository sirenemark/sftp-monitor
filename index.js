const SftpClient = require('ssh2-sftp-client');
const nodemailer = require('nodemailer');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const sftp = new SftpClient();

const CONFIG = {
  host: 'bekadrive.synology.me',
  port: 22221,
  username: process.env.SFTP_USER,
  password: process.env.SFTP_PASS,
  remoteDir: '/home'
};

async function run() {

  console.log('Connecting to SFTP...');

  await sftp.connect({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    password: CONFIG.password,
    readyTimeout: 20000
  });

  console.log('Connected to SFTP');

  const files = (await sftp.list(CONFIG.remoteDir))
    .sort((a, b) => b.modifyTime - a.modifyTime);

  console.log(`Found ${files.length} files`);

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const recentFiles = files.filter(file => {

    const modified =
      file.modifyTime > 9999999999
        ? file.modifyTime
        : file.modifyTime * 1000;

    return modified >= (now - DAY_MS);
  });

  console.log('Authenticating Google Sheets...');

  const { JWT } = require('google-auth-library');

  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(
    process.env.SHEET_ID,
    serviceAccountAuth
  );

  console.log('Google Sheets authenticated');
  
  await doc.loadInfo();

  const sheet = doc.sheetsByIndex[0];

  const rows = await sheet.getRows();
  const existing = rows.map(r => r.filename);

  const newFiles = recentFiles.filter(f => !existing.includes(f.name));

  for (const file of newFiles) {

    await sheet.addRow({
      filename: file.name,
      modified: new Date(file.modifyTime).toISOString(),
      detected: new Date().toISOString()
    });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  let subject = '';
  let body = '';

  if (recentFiles.length === 0) {

    subject = 'ALERT: No SFTP Uploads';

    body = 'No new files were uploaded to /home in the last 24 hours.';

  } else {

    subject = `SFTP Upload Report (${newFiles.length} files)`;

    body = 'New uploads:\n\n';

    newFiles.forEach(f => {
      body += `- ${f.name}\n`;
    });
  }

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.ALERT_EMAIL,
    subject,
    text: body
  });

  await sftp.end();
}

run().catch(console.error);
